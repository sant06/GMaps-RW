/**
 * Virtualized DOM Harvester for Google Maps scrollable containers.
 * Traverses virtualized feeds (div[role="feed"]), handles recycled DOM elements,
 * synthesizes programmatic hover events on cards to force coordinate population,
 * and executes multi-modal active scrolling with zero manual nudges required.
 */

import type { ScrapedPlaceRecord } from '../types/places';
import { GoogleMapsUrlParser } from './parser';
import { RateLimiter } from '../utils/rate-limiter';
import { generateSyntheticPlaceId } from '../utils/crypto';
import { isLegitimatePlaceTitle, isPlausibleGeoCoordinate } from '../utils/validation';
import { mergePlaceRecords } from '../injected/rpc-unpacker';

export interface SavedListDirectoryEntry {
  title: string;
  itemCount: number;
  element: HTMLElement;
}

export class MapsVirtualScroller {
  private container: HTMLElement | null = null;
  private harvestedMap: Map<string, ScrapedPlaceRecord> = new Map();
  private coordIndex: Map<string, string> = new Map();
  private isPaused = false;
  private isAborted = false;
  private rateLimiter: RateLimiter;
  private currentListTitle: string | null = null;

  /**
   * Spatially deduplicates and merges place records using 5-decimal coordinate keys (~1 meter precision).
   */
  private addOrUpdatePlace(record: ScrapedPlaceRecord): boolean {
    const coordKey = `${record.latitude.toFixed(5)},${record.longitude.toFixed(5)}`;
    const existingId = this.coordIndex.get(coordKey);

    if (existingId && this.harvestedMap.has(existingId)) {
      const existing = this.harvestedMap.get(existingId)!;
      const merged = mergePlaceRecords(existing, record);
      this.harvestedMap.set(existingId, merged);
      return false; // Merged with existing record
    }

    if (this.harvestedMap.has(record.id)) {
      const existing = this.harvestedMap.get(record.id)!;
      const merged = mergePlaceRecords(existing, record);
      this.harvestedMap.set(record.id, merged);
      this.coordIndex.set(coordKey, record.id);
      return false; // Merged with existing record
    }

    this.harvestedMap.set(record.id, record);
    this.coordIndex.set(coordKey, record.id);
    return true; // Newly added
  }

  constructor(containerElement?: HTMLElement, rateLimiter?: RateLimiter) {
    this.container = containerElement || this.findPrimaryContainer();
    // Fast, responsive extraction delay (300ms - 600ms) for high-speed local DOM harvesting
    this.rateLimiter =
      rateLimiter ||
      new RateLimiter({
        minDelayMs: 300,
        maxDelayMs: 600,
        coolingIntervalCycles: 70,
        coolingDurationMs: 1500,
      });
  }

  /**
   * Locates Google Maps virtualized container using multi-level heuristic detection.
   */
  public findPrimaryContainer(): HTMLElement | null {
    // If Google Maps is currently displaying the Saved Lists Directory Hub,
    // do not treat the directory container as a place list!
    if (this.isSavedListsHub()) {
      return null;
    }

    const placeSelectors = [
      '.fontHeadlineSmall',
      '.qBF1Pd',
      'span.OSrXXb',
      'a[href*="/maps/place/"]',
      'a[href*="/place/"]',
      'a.hfpxzc',
      'div[role="listitem"]',
      'div[data-item-id]',
      'div[jsaction*="place" i]',
      'div[jsaction*="item" i]',
      'div[jsaction*="entity" i]',
      'button[aria-label*="nota" i]',
      'button[aria-label*="note" i]',
      'div[role="article"]',
      'div.Nv2PK',
    ];

    // 1. Primary: If place items or titles exist, find their container in the left panel
    const sample = document.querySelector<HTMLElement>(placeSelectors.join(', '));
    if (sample) {
      let parent = sample.parentElement;
      let fallbackPanel: HTMLElement | null = null;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const rect = parent.getBoundingClientRect();
        if (rect.left < window.innerWidth * 0.65 && rect.width > 200) {
          if (parent.scrollHeight > parent.clientHeight && parent.clientHeight > 100) {
            return parent;
          }
          if (parent.clientHeight > 200 && !fallbackPanel) {
            fallbackPanel = parent;
          }
        }
        parent = parent.parentElement;
      }
      if (fallbackPanel) {
        return fallbackPanel;
      }
    }

    // 2. Try known Google Maps container selectors
    const candidates = [
      'div[role="feed"]',
      'div.m6QErb[aria-label]',
      'div.m6QErb.DxyBCb',
      'div.m6QErb',
      'div[role="main"] div[tabindex="-1"]',
      'div[role="main"]',
      'div[role="region"][aria-label]',
      'div[role="region"]',
      'div#pane div[tabindex="-1"]',
      'div#pane',
      'div.widget-pane-content',
      'div.section-layout',
    ];

    for (const selector of candidates) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      for (const el of elements) {
        const isFeed = el.getAttribute('role') === 'feed';
        const hasPlaces = el.querySelector(placeSelectors.join(', ')) !== null;
        const hasHeader = el.querySelector('h1, div[role="heading"]') !== null;
        if ((isFeed || hasPlaces || hasHeader) && el.clientHeight > 150) {
          return el;
        }
      }
    }

    // 3. Direct parent of sample item if found
    if (sample?.parentElement) {
      return sample.parentElement;
    }

    // 4. Fallback: Google Maps main left pane (#pane, div[role="main"])
    const leftPane = document.querySelector<HTMLElement>('#pane, div[role="main"], div.widget-pane');
    if (leftPane && leftPane.clientHeight > 150) {
      return leftPane;
    }

    return null;
  }

  public setContainer(el: HTMLElement): void {
    this.container = el;
  }

  public setCurrentListTitle(title: string): void {
    this.currentListTitle = title;
  }

  public addPreHarvested(items: ScrapedPlaceRecord[]): void {
    for (const item of items) {
      if (this.currentListTitle && !item.listTitle) {
        item.listTitle = this.currentListTitle;
      }
      this.addOrUpdatePlace(item);
    }
  }

  public getHarvestedCount(): number {
    return this.harvestedMap.size;
  }

  /**
   * Executes multi-modal active scrolling to guarantee that Google Maps virtual
   * observers, wheel listeners, and layout recyclers fire deterministically.
   */
  private performActiveScroll(deltaPixels: number): void {
    if (!this.container) return;

    const initialScrollTop = this.container.scrollTop;

    // 1. Direct scrollTop advancement (instantaneous, no smooth scroll animation latency)
    this.container.scrollTop += deltaPixels;

    // 2. If container scrollTop did not advance, attempt on inner scrollable child
    if (this.container.scrollTop === initialScrollTop) {
      const childScroll = this.container.querySelector<HTMLElement>('div.m6QErb, div[tabindex="-1"], div[role="feed"]');
      if (childScroll && childScroll.scrollHeight > childScroll.clientHeight) {
        childScroll.scrollTop += deltaPixels;
        childScroll.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    }

    // 3. Dispatch synthetic scroll and wheel events on the container
    this.container.dispatchEvent(new Event('scroll', { bubbles: true }));
    this.container.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: deltaPixels,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
      })
    );

    // 3. Also dispatch keyboard PageDown / ArrowDown event
    this.container.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: deltaPixels > 0 ? 'PageDown' : 'PageUp',
        code: deltaPixels > 0 ? 'PageDown' : 'PageUp',
        bubbles: true,
      })
    );

    // 4. Check scrollable parent/ancestor fallback
    let parent = this.container.parentElement;
    while (parent && parent !== document.body) {
      if (parent.scrollHeight > parent.clientHeight) {
        parent.scrollTop += deltaPixels;
        parent.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      parent = parent.parentElement;
    }
  }

  /**
   * Executes the full scrolling harvesting loop with automatic synthetic hover nudges.
   */
  public async runExtraction(
    progressCallback: (stats: { count: number; newlyAdded: ScrapedPlaceRecord[]; isStagnant: boolean }) => void,
    logCallback?: (level: 'info' | 'warn' | 'error', tag: string, message: string) => void
  ): Promise<ScrapedPlaceRecord[]> {
    logCallback?.('info', 'ACTION', 'Iniciando escaneo del DOM en busca de la lista de lugares...');

    // 0. Auto-Navigation: If currently on the Saved Lists Directory Hub, iterate and extract each list with places
    if (this.isSavedListsHub()) {
      const allLists = this.scanSavedListsInHub();
      const targets = allLists.filter((l) => l.itemCount > 0);

      if (targets.length > 0) {
        logCallback?.(
          'info',
          'NAV',
          `Directorio de listas guardadas detectado (${targets.length} listas con contenido encontradas: ${targets.map((t) => `"${t.title}" [${t.itemCount} sitios]`).join(', ')}).`
        );

        for (let i = 0; i < targets.length; i++) {
          if (this.isAborted) break;
          const target = targets[i];
          this.currentListTitle = target.title;
          logCallback?.('info', 'NAV', `[Lista ${i + 1}/${targets.length}] Abriendo automáticamente "${target.title}" (${target.itemCount} sitios)...`);
          const opened = await this.openSavedListFromHub(target);
          if (!opened) {
            logCallback?.('warn', 'NAV', `No se pudo abrir la lista "${target.title}". Continuando...`);
            continue;
          }

          // Wait for items container to mount
          this.container = null;
          for (let attempt = 0; attempt < 10; attempt++) {
            this.container = this.findPrimaryContainer();
            if (this.container) break;
            await this.rateLimiter.sleep(350);
          }

          if (this.container) {
            const containerDesc = `<${this.container.tagName.toLowerCase()}${this.container.className ? '.' + this.container.className.split(' ').slice(0, 2).join('.') : ''}>`;
            logCallback?.('info', 'DOM', `Contenedor de lista "${target.title}" localizado: ${containerDesc}.`);
            await this.executeScrollHarvestLoop(progressCallback, logCallback, target.itemCount);
            logCallback?.('info', 'EXTRACT', `Lista "${target.title}": Procesada. Total acumulado: ${this.harvestedMap.size} lugares.`);
          }

          if (i < targets.length - 1) {
            logCallback?.('info', 'NAV', 'Volviendo al directorio de listas guardadas para la siguiente lista...');
            await this.clickBackButton();
            this.container = null;
            await this.rateLimiter.sleep(1200);
          }
        }

        if (this.harvestedMap.size > 0) {
          logCallback?.('info', 'SUCCESS', `¡Recorrido autónomo completado! ${this.harvestedMap.size} lugares listos para exportar a Excel, GeoJSON, KML o CSV.`);
          return Array.from(this.harvestedMap.values());
        }
      } else if (allLists.length > 0) {
        logCallback?.(
          'warn',
          'EMPTY',
          'Todas las listas guardadas en la cuenta están vacías (0 sitios). Por favor guarda lugares en Google Maps y vuelve a intentar.'
        );
        throw new Error(
          'Todas las listas guardadas en tu cuenta de Google Maps están vacías (0 sitios). Guarda lugares en tus listas y vuelve a intentar.'
        );
      }
    }

    if (!this.container) {
      this.container = this.findPrimaryContainer();
    }

    // If still not found, attempt to open the Saved panel automatically
    if (!this.container) {
      logCallback?.('warn', 'NAV', 'Lista no visible en el viewport actual. Intentando abrir panel "Guardados / Saved" automáticamente...');
      const opened = await this.tryAutoOpenSavedPanel();
      if (opened) {
        logCallback?.('info', 'NAV', 'Botón de "Guardados" presionado. Esperando montaje del panel...');
        await this.rateLimiter.sleep(1500);

        // Check if hub opened after clicking Guardados
        if (this.isSavedListsHub()) {
          return this.runExtraction(progressCallback, logCallback);
        }

        this.container = this.findPrimaryContainer();
      }
    }

    if (!this.container) {
      logCallback?.('error', 'DOM', 'No se detectó ninguna lista abierta. Por favor abre tu lista en Google Maps (ej. Guardados -> Favoritos / Quiero ir) y presiona Iniciar de nuevo.');
      throw new Error(
        'No active list panel found in Google Maps. Please open your Saved List (in Google Maps: click Menu ☰ -> Saved / Guardados -> select your list) and try again.'
      );
    }

    const headerInfo = this.getExpectedItemCount();
    if (headerInfo.listTitle && !this.currentListTitle) {
      this.currentListTitle = headerInfo.listTitle;
    }

    const containerDesc = `<${this.container.tagName.toLowerCase()}${this.container.className ? '.' + this.container.className.split(' ').slice(0, 2).join('.') : ''}>`;
    logCallback?.('info', 'DOM', `Contenedor de lista localizado: ${containerDesc} (ScrollHeight: ${this.container.scrollHeight}px).`);

    if (this.harvestedMap.size > 0) {
      logCallback?.(
        'info',
        'CACHE',
        `Cargados ${this.harvestedMap.size} lugares verificados desde la sesión activa de Google Maps.`
      );
      progressCallback({
        count: this.harvestedMap.size,
        newlyAdded: Array.from(this.harvestedMap.values()),
        isStagnant: false,
      });
    }

    await this.executeScrollHarvestLoop(progressCallback, logCallback);

    if (this.harvestedMap.size === 0) {
      logCallback?.(
        'warn',
        'EMPTY',
        'Extracción finalizada sin lugares. Por favor abre tu lista (ej. Guardados -> Favoritos / Sitios destacados) en Google Maps para que la lista sea visible y vuelve a intentar.'
      );
      throw new Error(
        'No se detectaron lugares en la vista actual. Por favor abre tu lista de lugares guardados en Google Maps (ej. Menú ☰ -> Guardados 🔖 -> selecciona tu lista).'
      );
    }

    if (this.currentListTitle) {
      for (const place of this.harvestedMap.values()) {
        if (!place.listTitle) {
          place.listTitle = this.currentListTitle;
        }
      }
    }

    logCallback?.('info', 'SUCCESS', `Extracción completada. ${this.harvestedMap.size} lugares listos para exportar a Excel, GeoJSON, KML o CSV.`);
    return Array.from(this.harvestedMap.values());
  }

  /**
   * Scans the active list header for total item count (e.g. "Santiago Montoya · Compartida · 10 sitios", "Más de 200 sitios").
   */
  public getExpectedItemCount(): { count: number | null; isApproximate: boolean; listTitle?: string } {
    const titleEl = document.querySelector<HTMLElement>(
      'h1, div[role="heading"], .fontHeadlineLarge, div.m6QErb h1, div.widget-pane-content h1'
    );
    const listTitle = titleEl?.textContent?.trim() || undefined;

    const countRegex = /\b(?:(más de|more than|plus de|über)\s+)?(\d+)\s*(?:sitios?|places?|lugares?|locais|local|lieux?|orte?|luoghi?|items?|elementos?)\b/i;

    const headerContainers = [
      '#pane',
      'div[role="main"]',
      'div.m6QErb',
      'div.widget-pane-content',
      'div.section-layout',
    ];

    for (const sel of headerContainers) {
      const container = document.querySelector<HTMLElement>(sel);
      if (!container) continue;

      const candidates = container.querySelectorAll<HTMLElement>(
        '.fontBodyMedium, .W4Efsd, .headlineMedium, span, div[aria-label]'
      );

      for (const el of candidates) {
        if (el.closest('div[role="listitem"], div[role="article"], div.Nv2PK')) {
          continue; // Skip individual place row items
        }

        const text = el.textContent || '';
        const match = text.match(countRegex);
        if (match) {
          const isApproximate = Boolean(match[1]);
          const count = parseInt(match[2], 10);
          if (count > 0 && count < 100000) {
            return { count, isApproximate, listTitle };
          }
        }
      }
    }

    return { count: null, isApproximate: false, listTitle };
  }

  /**
   * Executes the scrolling harvesting loop on the currently active container.
   */
  private async executeScrollHarvestLoop(
    progressCallback: (stats: { count: number; newlyAdded: ScrapedPlaceRecord[]; isStagnant: boolean }) => void,
    logCallback?: (level: 'info' | 'warn' | 'error', tag: string, message: string) => void,
    hintExpectedCount?: number
  ): Promise<void> {
    if (!this.container) return;

    // Detect expected count and list title
    const headerInfo = this.getExpectedItemCount();
    const expectedCount = hintExpectedCount !== undefined ? hintExpectedCount : headerInfo.count;
    const isApproximate = hintExpectedCount !== undefined ? false : headerInfo.isApproximate;
    if (headerInfo.listTitle && !this.currentListTitle) {
      this.currentListTitle = headerInfo.listTitle;
    }

    if (expectedCount !== null && expectedCount !== undefined) {
      logCallback?.(
        'info',
        'NAV',
        `Lista "${this.currentListTitle || 'actual'}" detectada con ${isApproximate ? 'más de ' : ''}${expectedCount} sitios esperados.`
      );
    }

    // 0. Rewind container to top (0px) so virtual recycler mounts from item #1
    if (this.container.scrollTop > 50) {
      logCallback?.('info', 'NAV', `Reposicionando al inicio de la lista (scrollTop: ${Math.round(this.container.scrollTop)}px -> 0px)...`);
      this.container.scrollTop = 0;
      this.container.dispatchEvent(new Event('scroll', { bubbles: true }));
      await this.rateLimiter.sleep(700);
    }

    // If already pre-harvested and reaches expected count, complete immediately!
    if (expectedCount !== null && expectedCount !== undefined && !isApproximate && this.harvestedMap.size >= expectedCount) {
      logCallback?.(
        'info',
        'COMPLETE',
        `¡Cosecha completa! Todos los ${this.harvestedMap.size} lugares esperados (${expectedCount} sitios) ya están en memoria.`
      );
      return;
    }

    let lastScrollHeight = this.container.scrollHeight;
    let stagnationCycles = 0;
    const MAX_STAGNATION_LIMIT = 6;
    let cycle = 0;

    while (!this.isAborted) {
      if (this.isPaused) {
        await this.rateLimiter.sleep(400);
        continue;
      }
      cycle++;

      // Check if Google Maps dynamically loaded more items (scrollHeight expanded)
      if (this.container.scrollHeight > lastScrollHeight + 50) {
        logCallback?.(
          'info',
          'LOAD',
          `Google Maps cargó nuevos elementos en la lista (ScrollHeight: ${this.container.scrollHeight}px). Continuando...`
        );
        lastScrollHeight = this.container.scrollHeight;
        stagnationCycles = 0;
      }

      // 1. Synthesize hover on cards and harvest newly populated anchors
      const newlyAdded = await this.harvestVisibleElements();

      const progressLabel = expectedCount !== null && expectedCount !== undefined
        ? `${this.harvestedMap.size}/${expectedCount}`
        : `${this.harvestedMap.size}`;

      if (newlyAdded.length > 0) {
        stagnationCycles = 0;
        const sampleTitles = newlyAdded.slice(0, 2).map((p) => `"${p.title}"`).join(', ');
        logCallback?.('info', 'EXTRACT', `Ciclo #${cycle}: Extraídos +${newlyAdded.length} lugares (${sampleTitles}). Total: ${progressLabel}`);
      } else {
        stagnationCycles++;
      }

      progressCallback({
        count: this.harvestedMap.size,
        newlyAdded,
        isStagnant: stagnationCycles > 0,
      });

      // Early completion gate: If we have reached the expected count, terminate immediately!
      if (expectedCount !== null && expectedCount !== undefined && !isApproximate && this.harvestedMap.size >= expectedCount) {
        logCallback?.(
          'info',
          'COMPLETE',
          `¡Todos los ${this.harvestedMap.size} lugares esperados (${expectedCount} sitios) fueron cosechados exitosamente!`
        );
        break;
      }

      // If the list is short and already fully displayed in the viewport (e.g. 5-15 items),
      // terminate immediately once items are harvested without unnecessary scroll spinning.
      const isShortList = this.container.scrollHeight <= this.container.clientHeight + 40;
      if (isShortList && this.harvestedMap.size > 0) {
        logCallback?.(
          'info',
          'COMPLETE',
          `Lista completa en pantalla detectada (${this.harvestedMap.size} lugares). Extracción finalizada con éxito.`
        );
        break;
      }

      const isAtBottom = this.container.scrollTop + this.container.clientHeight >= this.container.scrollHeight - 60;
      const maxStagnation = expectedCount && this.harvestedMap.size < expectedCount ? 10 : MAX_STAGNATION_LIMIT;

      // Sentinel or stagnation termination evaluation
      if (this.detectTerminalSentinel() || (isAtBottom && stagnationCycles >= 2)) {
        if (expectedCount !== null && expectedCount !== undefined && !isApproximate && this.harvestedMap.size >= expectedCount) {
          logCallback?.(
            'info',
            'COMPLETE',
            `Final alcanzado con ${this.harvestedMap.size}/${expectedCount} lugares cosechados. Finalizando.`
          );
          break;
        }

        logCallback?.(
          'warn',
          'RECOVERY',
          `Ciclo #${cycle}: Extremo visible alcanzado (${this.harvestedMap.size}${expectedCount ? '/' + expectedCount : ''} lugares). Ejecutando micro-scroll para disparar carga de más elementos...`
        );
        // Recovery routine: scroll backward slightly then forward to trigger Google intersection observers
        this.performActiveScroll(-350);
        await this.rateLimiter.sleep(500);
        this.performActiveScroll(450);
        await this.rateLimiter.sleep(1000);

        const recoveryAdded = await this.harvestVisibleElements();
        if (recoveryAdded.length > 0 || this.container.scrollHeight > lastScrollHeight + 50) {
          stagnationCycles = 0;
          lastScrollHeight = this.container.scrollHeight;
          if (recoveryAdded.length > 0) {
            const sample = recoveryAdded.slice(0, 2).map((p) => `"${p.title}"`).join(', ');
            logCallback?.('info', 'EXTRACT', `Recuperación exitosa: +${recoveryAdded.length} lugares (${sample}). Total: ${this.harvestedMap.size}`);
          }
          if (expectedCount !== null && expectedCount !== undefined && !isApproximate && this.harvestedMap.size >= expectedCount) {
            logCallback?.('info', 'COMPLETE', `¡Todos los ${this.harvestedMap.size} lugares esperados fueron cosechados!`);
            break;
          }
          continue;
        }

        if (this.detectTerminalSentinel() || stagnationCycles >= maxStagnation) {
          logCallback?.('info', 'COMPLETE', `Ciclo #${cycle}: Final de la lista alcanzado (${this.harvestedMap.size} lugares extraídos tras ${cycle} ciclos).`);
          break;
        }
      }

      // Variable downward scroll increment (350px - 520px)
      const variableStep = Math.floor(Math.random() * (520 - 350 + 1)) + 350;
      this.performActiveScroll(variableStep);
      logCallback?.('info', 'SCROLL', `Ciclo #${cycle}: Scroll +${variableStep}px (Posición: ${Math.round(this.container.scrollTop)}px). Lugares: ${progressLabel}.`);

      // Fast, responsive delay (300ms - 550ms)
      await this.rateLimiter.applyAdaptiveDelay();
    }
  }

  /**
   * Identifies whether Google Maps is currently displaying the Saved Lists Directory Hub.
   */
  public isSavedListsHub(): boolean {
    // If a list is already opened, there is a Back button or "Añadir un sitio" button
    const hasBackBtn = document.querySelector<HTMLElement>(
      'button[aria-label*="Atrás" i], button[aria-label*="Back" i], button[aria-label*="Volver" i]'
    );
    if (hasBackBtn && hasBackBtn.offsetParent !== null) {
      return false;
    }

    const hasAddPlaceBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).some((b) =>
      /añadir un sitio|add a place|agregar un sitio/i.test(b.getAttribute('aria-label') || b.textContent || '')
    );
    if (hasAddPlaceBtn) {
      return false;
    }

    // 1. Check for "+ Nueva lista" / "+ New list" button
    const hasNewListBtn = Array.from(document.querySelectorAll('button, div[role="button"]')).some((b) =>
      /nueva lista|new list|create list/i.test(b.getAttribute('aria-label') || b.textContent || '')
    );

    // 2. Check for URL matching data=!4m2!10m1!1e1 or containing 10m1!1e1
    const isHubUrl = window.location.href.includes('10m1!1e1');

    // 3. Check for presence of list count cards (e.g. "sitios", "places", "lugares") in left panel
    const countRegex = /\b\d+\s*(?:sitios?|places?|lugares?|locais|local|lieux?|orte?|luoghi?|luogo|items?|elementos?)\b/i;
    const hasCountLabels = Array.from(document.querySelectorAll('div.m6QErb, #pane, div[role="main"]')).some((el) =>
      countRegex.test(el.textContent || '')
    );

    return hasNewListBtn || (isHubUrl && hasCountLabels);
  }

  /**
   * Scans all custom and predefined saved lists present in the Saved Lists Directory.
   */
  public scanSavedListsInHub(): SavedListDirectoryEntry[] {
    const entries: SavedListDirectoryEntry[] = [];
    const countRegex = /\b(\d+)\s*(?:sitios?|places?|lugares?|locais|local|lieux?|orte?|luoghi?|luogo|items?|elementos?)\b/i;

    const countAllOccurrences = (str: string): number => {
      const matches = str.match(new RegExp(countRegex.source, 'gi'));
      return matches ? matches.length : 0;
    };

    const container = document.querySelector<HTMLElement>('div.m6QErb, #pane, div[role="main"]') || document.body;
    const candidates = Array.from(
      container.querySelectorAll<HTMLElement>(
        'div.m6QErb > div, div[role="button"], div[jsaction*="click"], a[href*="placelist"], div.fontHeadlineSmall, div.qBF1Pd'
      )
    );

    for (const el of candidates) {
      const text = el.innerText || el.textContent || '';
      const countMatch = text.match(countRegex);
      if (!countMatch) continue;

      // Ensure this element represents a single card row (not the container containing multiple lists)
      const totalCountsInEl = countAllOccurrences(text);
      if (totalCountsInEl > 1) continue;

      const parentText = el.parentElement ? el.parentElement.innerText || el.parentElement.textContent || '' : '';
      const totalCountsInParent = countAllOccurrences(parentText);
      // The individual row's parent container typically has multiple counts (or is the pane)
      if (totalCountsInParent === 1 && el.clientHeight > 180) {
        continue; // Skip tall parent wrapper
      }

      const count = parseInt(countMatch[1], 10);
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

      const titleCandidate = lines.find((line) => {
        if (countRegex.test(line)) return false;
        if (/^(?:compartida|privada|shared|private|pública|public)\b/i.test(line)) return false;
        if (line.startsWith('+')) return false;
        if (line.length < 2) return false;
        return true;
      });

      const title = titleCandidate || el.getAttribute('aria-label') || 'Lista';

      if (!entries.some((e) => e.title.toLowerCase() === title.toLowerCase())) {
        entries.push({
          title,
          itemCount: count,
          element: el,
        });
      }
    }

    return entries;
  }

  /**
   * Programmatically opens a specific saved list from the directory.
   */
  public async openSavedListFromHub(target: SavedListDirectoryEntry): Promise<boolean> {
    let card = target.element;
    if (!document.body.contains(card)) {
      const freshLists = this.scanSavedListsInHub();
      const fresh = freshLists.find((l) => l.title.toLowerCase() === target.title.toLowerCase());
      if (fresh) {
        card = fresh.element;
      }
    }

    const isMenuButton = (el: Element | null): boolean => {
      if (!el) return false;
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const hasPopup = el.getAttribute('aria-haspopup');
      return (
        hasPopup === 'true' ||
        hasPopup === 'menu' ||
        /más acciones|acciones|more actions|options|opciones|menú|menu/i.test(ariaLabel)
      );
    };

    const allDescendants = Array.from(card.querySelectorAll<HTMLElement>('*'));
    const titleEl = allDescendants.find(
      (child) => child.children.length === 0 && child.textContent?.trim() === target.title
    );

    const clickCandidates: HTMLElement[] = [];
    if (titleEl) {
      clickCandidates.push(titleEl);
      let p = titleEl.parentElement;
      while (p && p !== card) {
        if (!isMenuButton(p)) {
          clickCandidates.push(p);
        }
        p = p.parentElement;
      }
    }

    const anchor = card.querySelector<HTMLElement>('a[href]');
    if (anchor && !isMenuButton(anchor)) {
      clickCandidates.push(anchor);
    }

    const buttonEl = card.querySelector<HTMLElement>('div[role="button"]');
    if (buttonEl && !isMenuButton(buttonEl)) {
      clickCandidates.push(buttonEl);
    }

    if (!isMenuButton(card)) {
      clickCandidates.push(card);
    }

    for (const clickTarget of clickCandidates) {
      clickTarget.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const rect = clickTarget.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const opts: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
      };

      clickTarget.dispatchEvent(new PointerEvent('pointerdown', opts));
      clickTarget.dispatchEvent(new MouseEvent('mousedown', opts));
      clickTarget.dispatchEvent(new PointerEvent('pointerup', opts));
      clickTarget.dispatchEvent(new MouseEvent('mouseup', opts));
      clickTarget.dispatchEvent(new MouseEvent('click', opts));
      if (typeof clickTarget.click === 'function') {
        clickTarget.click();
      }

      // Poll up to 2 seconds per candidate to see if navigation triggered
      for (let poll = 0; poll < 6; poll++) {
        await this.rateLimiter.sleep(300);
        const hasAddPlace = Array.from(document.querySelectorAll('button, div[role="button"]')).some((b) =>
          /añadir un sitio|add a place|agregar un sitio/i.test(b.getAttribute('aria-label') || b.textContent || '')
        );
        const hasBack = document.querySelector<HTMLElement>(
          'button[aria-label*="Atrás" i], button[aria-label*="Back" i], button[aria-label*="Volver" i]'
        );
        const hasNotes = document.querySelectorAll('button[aria-label*="nota" i], [aria-label*="note" i]').length > 0;
        if (hasAddPlace || hasBack || hasNotes || !this.isSavedListsHub()) {
          await this.rateLimiter.sleep(600);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Clicks the back navigation button to return from a placelist view to the Saved Lists directory.
   */
  public async clickBackButton(): Promise<boolean> {
    const backSelectors = [
      'button[aria-label*="Atrás" i]',
      'button[aria-label*="Volver" i]',
      'button[aria-label*="Back" i]',
      'button[data-tooltip*="Atrás" i]',
      'button[data-tooltip*="Back" i]',
      'button[jsaction*="back" i]',
    ];

    for (const sel of backSelectors) {
      const btn = document.querySelector<HTMLElement>(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        // Wait until hub is visible again
        for (let poll = 0; poll < 10; poll++) {
          await this.rateLimiter.sleep(300);
          if (this.isSavedListsHub()) {
            return true;
          }
        }
        return true;
      }
    }
    return false;
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
  }

  public abort(): void {
    this.isAborted = true;
  }

  /**
   * Attempts to locate and click the 'Saved' / 'Guardados' tab button in Google Maps navigation.
   */
  private async tryAutoOpenSavedPanel(): Promise<boolean> {
    const savedSelectors = [
      'button[aria-label*="Saved" i]',
      'button[aria-label*="Guardados" i]',
      'button[data-tooltip*="Saved" i]',
      'button[data-tooltip*="Guardados" i]',
      'button[data-item-id="YOUR_PLACES"]',
      'button[data-item-id*="saved" i]',
    ];

    for (const sel of savedSelectors) {
      const btn = document.querySelector<HTMLElement>(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Dispatches synthetic hover/pointer events on all visible place cards,
   * forcing Google Maps to mount and populate high-precision URLs (!3d/!4d)
   * without requiring any physical manual hover or mouse movements from the user.
   */
  private async triggerSyntheticHovers(root: HTMLElement | Document): Promise<void> {
    const cardSelectors = [
      'div[role="article"]',
      'div.Nv2PK',
      'div[role="listitem"]',
      'div[data-item-id]',
      'div[jsaction*="place" i]',
      'div[jsaction*="entity" i]',
      'div[jsaction*="item" i]',
      'div[jsaction*="hover" i]',
      'div[jsaction*="mouseover" i]',
      'div.m6QErb > div',
      '.fontHeadlineSmall',
      '.qBF1Pd',
      'a.hfpxzc',
      'button[aria-label*="nota" i]',
      'button[aria-label*="note" i]',
      'button[aria-label][jsaction*="pin" i]',
      'div[role="button"][aria-label]',
    ];

    const cards = root.querySelectorAll<HTMLElement>(cardSelectors.join(', '));
    if (cards.length === 0) return;

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const clientX = Math.max(10, Math.floor(rect.left + Math.min(rect.width / 2, 50)));
      const clientY = Math.max(10, Math.floor(rect.top + Math.min(rect.height / 2, 50)));

      const pointerProps = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX,
        clientY,
      };

      card.dispatchEvent(new PointerEvent('pointerover', pointerProps));
      card.dispatchEvent(new PointerEvent('pointerenter', pointerProps));
      card.dispatchEvent(new MouseEvent('mouseover', pointerProps));
      card.dispatchEvent(new MouseEvent('mouseenter', pointerProps));
      card.dispatchEvent(new MouseEvent('mousemove', pointerProps));

      // Also trigger on child action targets
      const childAction = card.querySelector<HTMLElement>('a, button, [jsaction*="click"]');
      if (childAction && childAction !== card) {
        childAction.dispatchEvent(new MouseEvent('mouseover', pointerProps));
        childAction.dispatchEvent(new MouseEvent('mouseenter', pointerProps));
      }

      // Trigger focus and focusin on the place anchor or card (activates Google Maps a11y URL hydration without mouse)
      const anchor = card.tagName === 'A' ? (card as HTMLAnchorElement) : card.querySelector<HTMLAnchorElement>('a');
      if (anchor) {
        try {
          anchor.focus();
          anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        } catch {
          // Ignore focus errors
        }
      } else {
        try {
          card.focus();
          card.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        } catch {
          // Ignore focus errors
        }
      }
    });

    // Critical: Yield execution to allow Google Maps event handlers to run and mutate DOM attributes
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  /**
   * Scans currently mounted DOM nodes within the container.
   */
  public async harvestVisibleElements(): Promise<ScrapedPlaceRecord[]> {
    const root = this.container || document;

    // 1. Synthesize hover on visible cards to populate unattached coordinate links
    await this.triggerSyntheticHovers(root);

    const newlyAdded: ScrapedPlaceRecord[] = [];

    // 2. Strategy A: Query all candidate anchors restricted to place links
    const anchorSelectors = [
      'a[href*="/maps/place/"]',
      'a[href*="/place/"]',
      'a[href*="/maps/@"]',
      'a[href*="/maps/search/"]',
      'a[href*="google.com/maps"]',
      'a[data-href*="/maps/place/"]',
      'a[data-href*="/place/"]',
      'a[data-href*="/maps/"]',
      'a.hfpxzc',
      'a[data-item-id]',
      'div[role="listitem"] a',
      'div[data-item-id] a',
      'div.m6QErb a',
      'a[jsaction*="place" i]',
    ];

    const anchors = new Set<HTMLAnchorElement>();
    root.querySelectorAll<HTMLAnchorElement>(anchorSelectors.join(', ')).forEach((a) => anchors.add(a));

    // Also check global tooltips/previews if they contain place links
    document.querySelectorAll<HTMLAnchorElement>('div[role="tooltip"] a[href*="/place/"], div[role="dialog"] a[href*="/place/"]').forEach((a) => anchors.add(a));

    anchors.forEach((anchor) => {
      const url = anchor.href || anchor.getAttribute('data-href') || '';
      const parsedCoords = GoogleMapsUrlParser.parse(url);
      if (!parsedCoords) return;

      const rawTitle =
        anchor.getAttribute('aria-label') ||
        anchor.querySelector('[role="heading"], .fontHeadlineSmall, .qBF1Pd')?.textContent?.trim() ||
        anchor.closest('div[role="listitem"], div[data-item-id], div[role="article"], div.Nv2PK, div[jsaction*="place" i], div.m6QErb > div')?.querySelector('.fontHeadlineSmall, .qBF1Pd, [role="heading"], span.OSrXXb')?.textContent?.trim() ||
        anchor.textContent?.trim() ||
        '';

      const title = rawTitle.replace(/\s*\+\s*nota\b/i, '').replace(/\s*\+\s*note\b/i, '').trim();

      if (!title || !isLegitimatePlaceTitle(title)) return;
      if (!isPlausibleGeoCoordinate(parsedCoords.latitude, parsedCoords.longitude)) return;

      const id =
        parsedCoords.placeId ||
        parsedCoords.featureId ||
        generateSyntheticPlaceId(title, parsedCoords.latitude, parsedCoords.longitude);

      const cardParent = anchor.closest('div[role="listitem"], div[data-item-id], div[jsaction*="place" i], div[role="article"], div.Nv2PK, div.m6QErb > div') || anchor.parentElement;
      const noteEl = cardParent?.querySelector('div[data-note], [aria-label*="nota" i], [aria-label*="note" i], span[class*="note" i]');
      let userNote = noteEl?.textContent?.trim() || undefined;
      if (userNote && (userNote.toLowerCase().startsWith('+ not') || userNote.toLowerCase().startsWith('agregar not'))) {
        userNote = undefined;
      }

      const address = cardParent?.querySelector('.fontBodyMedium, .W4Efsd, .headlineMedium')?.textContent?.trim() || undefined;

      const cardText = cardParent?.textContent || '';
      const isClosed =
        cardText.includes('Permanently closed') ||
        cardText.includes('Temporarily closed') ||
        cardText.includes('Cerrado permanentemente') ||
        cardText.includes('Cerrado temporalmente') ||
        false;

      const record: ScrapedPlaceRecord = {
        id,
        title,
        url,
        latitude: parsedCoords.latitude,
        longitude: parsedCoords.longitude,
        isHighPrecision: parsedCoords.isHighPrecision,
        placeId: parsedCoords.placeId,
        featureId: parsedCoords.featureId,
        cid: parsedCoords.cid,
        listTitle: this.currentListTitle || undefined,
        address,
        userNote,
        isClosed,
        operationalStatus: isClosed ? 'Permanently closed' : 'Operational',
        extractedAt: new Date().toISOString(),
      };

      if (this.addOrUpdatePlace(record)) {
        newlyAdded.push(record);
      }
    });

    // 3. Strategy B: Scan visible cards in custom Placelists and enrich / correlate
    const cardElements = root.querySelectorAll<HTMLElement>(
      'div[role="listitem"], div[data-item-id], div.m6QErb > div, div[jsaction*="place" i]'
    );

    cardElements.forEach((card) => {
      const titleEl = card.querySelector<HTMLElement>('.fontHeadlineSmall, .qBF1Pd, [role="heading"], span.OSrXXb');
      const rawTitle = titleEl?.textContent?.trim() || card.getAttribute('aria-label') || '';
      const title = rawTitle.replace(/\s*\+\s*nota\b/i, '').replace(/\s*\+\s*note\b/i, '').trim();

      if (!title || !isLegitimatePlaceTitle(title)) return;

      const address = card.querySelector('.fontBodyMedium, .W4Efsd, .headlineMedium')?.textContent?.trim() || undefined;
      const noteEl = card.querySelector('div[data-note], [aria-label*="nota" i], [aria-label*="note" i], span[class*="note" i]');
      let userNote = noteEl?.textContent?.trim() || undefined;
      if (userNote && (userNote.toLowerCase().startsWith('+ not') || userNote.toLowerCase().startsWith('agregar not'))) {
        userNote = undefined;
      }

      // Strategy B.1: Check if title itself contains coordinates, e.g. "(-36.495170, -56.691744)"
      const coordTitleMatch = title.match(/^\(?(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)\)?$/);
      if (coordTitleMatch) {
        const titleLat = parseFloat(coordTitleMatch[1]);
        const titleLng = parseFloat(coordTitleMatch[2]);
        if (isPlausibleGeoCoordinate(titleLat, titleLng)) {
          const id = generateSyntheticPlaceId(title, titleLat, titleLng);
          const record: ScrapedPlaceRecord = {
            id,
            title,
            url: `https://www.google.com/maps/place/?q=${titleLat.toFixed(6)},${titleLng.toFixed(6)}`,
            latitude: titleLat,
            longitude: titleLng,
            isHighPrecision: true,
            listTitle: this.currentListTitle || undefined,
            address,
            userNote,
            isClosed: false,
            operationalStatus: 'Operational',
            extractedAt: new Date().toISOString(),
          };
          if (this.addOrUpdatePlace(record)) {
            newlyAdded.push(record);
          }
          return;
        }
      }

      // Check if child anchor has coordinates
      const childAnchor = card.querySelector<HTMLAnchorElement>('a[href], a[data-href]');
      if (childAnchor) {
        const url = childAnchor.href || childAnchor.getAttribute('data-href') || '';
        const parsed = GoogleMapsUrlParser.parse(url);
        if (parsed && isPlausibleGeoCoordinate(parsed.latitude, parsed.longitude)) {
          const id = parsed.placeId || parsed.featureId || generateSyntheticPlaceId(title, parsed.latitude, parsed.longitude);
          const record: ScrapedPlaceRecord = {
            id,
            title,
            url,
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            isHighPrecision: parsed.isHighPrecision,
            placeId: parsed.placeId,
            featureId: parsed.featureId,
            listTitle: this.currentListTitle || undefined,
            address,
            userNote,
            extractedAt: new Date().toISOString(),
          };
          if (this.addOrUpdatePlace(record)) {
            newlyAdded.push(record);
          }
          return;
        }
      }

      // If already in harvestedMap (e.g. from RPC pre-harvest), enrich with live DOM note/address
      for (const record of this.harvestedMap.values()) {
        if (record.title.toLowerCase() === title.toLowerCase()) {
          if (userNote && !record.userNote) record.userNote = userNote;
          if (address && !record.address) record.address = address;
          if (this.currentListTitle && !record.listTitle) record.listTitle = this.currentListTitle;
          break;
        }
      }
    });

    return newlyAdded;
  }

  /**
   * Identifies end-of-feed indicator in the document.
   */
  private detectTerminalSentinel(): boolean {
    if (!this.container) return false;
    const text = (this.container.innerText || '').toLowerCase();
    const sentinels = [
      "you've reached the end",
      'no more results',
      'end of results',
      'has llegado al final',
      'fin de los resultados',
      'no hay más resultados',
      'vous avez atteint la fin',
      'plus aucun résultat',
      'sie haben das ende erreicht',
      'keine weiteren ergebnisse',
      'você chegou ao fim',
      'não há mais resultados',
      'hai raggiunto la fine',
    ];
    return sentinels.some((s) => text.includes(s));
  }
}
