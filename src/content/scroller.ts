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

export class MapsVirtualScroller {
  private container: HTMLElement | null = null;
  private harvestedMap: Map<string, ScrapedPlaceRecord> = new Map();
  private isPaused = false;
  private isAborted = false;
  private rateLimiter: RateLimiter;

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
    // 1. If any place links exist in the DOM, find their scrollable ancestor
    const sampleLink = document.querySelector<HTMLElement>('a[href*="/maps/place/"], a[href*="/place/"]');
    if (sampleLink) {
      let parent = sampleLink.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const isScrollable = parent.scrollHeight > parent.clientHeight && parent.clientHeight > 100;
        if (isScrollable) {
          return parent;
        }
        parent = parent.parentElement;
      }
    }

    // 2. Try known Google Maps container selectors
    const candidates = [
      'div[role="feed"]',
      'div.m6QErb[aria-label]',
      'div.m6QErb.DxyBCb',
      'div.m6QErb',
      'div[role="main"] div[tabindex="-1"]',
      'div[role="region"][aria-label]',
      'div[role="region"]',
      'div#pane div[tabindex="-1"]',
      'div.widget-pane-content',
      'div.section-layout',
    ];

    for (const selector of candidates) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      for (const el of elements) {
        if (el.scrollHeight > el.clientHeight && el.clientHeight > 150) {
          return el;
        }
      }
    }

    // 3. Fallback: Search all scrollable elements in the left panel / side drawer
    const allDivs = document.querySelectorAll<HTMLElement>('div');
    for (const div of allDivs) {
      if (div.clientHeight > 200 && div.scrollHeight > div.clientHeight + 80) {
        const rect = div.getBoundingClientRect();
        if (rect.left < window.innerWidth * 0.6 && rect.width > 200) {
          return div;
        }
      }
    }

    // 4. If elements with place links exist anywhere, use their direct container
    if (sampleLink?.parentElement) {
      return sampleLink.parentElement;
    }

    return null;
  }

  public setContainer(el: HTMLElement): void {
    this.container = el;
  }

  public addPreHarvested(items: ScrapedPlaceRecord[]): void {
    for (const item of items) {
      if (!this.harvestedMap.has(item.id)) {
        this.harvestedMap.set(item.id, item);
      }
    }
  }

  /**
   * Executes multi-modal active scrolling to guarantee that Google Maps virtual
   * observers, wheel listeners, and layout recyclers fire deterministically.
   */
  private performActiveScroll(deltaPixels: number): void {
    if (!this.container) return;

    // 1. Direct scrollTop advancement (instantaneous, no smooth scroll animation latency)
    this.container.scrollTop += deltaPixels;

    // 2. Dispatch synthetic scroll and wheel events on the container
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

    if (!this.container) {
      this.container = this.findPrimaryContainer();
    }

    // If still not found, attempt to open the Saved panel automatically
    if (!this.container) {
      logCallback?.('warn', 'NAV', 'Lista no visible en el viewport actual. Intentando abrir panel "Guardados / Saved" automáticamente...');
      const opened = await this.tryAutoOpenSavedPanel();
      if (opened) {
        logCallback?.('info', 'NAV', 'Botón de "Guardados" presionado. Esperando montaje del panel...');
        await this.rateLimiter.sleep(1200);
        this.container = this.findPrimaryContainer();
      }
    }

    if (!this.container) {
      logCallback?.('error', 'DOM', 'No se detectó ninguna lista abierta. Por favor abre tu lista en Google Maps (ej. Guardados -> Favoritos / Quiero ir) y presiona Iniciar de nuevo.');
      throw new Error(
        'No active list panel found in Google Maps. Please open your Saved List (in Google Maps: click Menu ☰ -> Saved / Guardados -> select your list) and try again.'
      );
    }

    const containerDesc = `<${this.container.tagName.toLowerCase()}${this.container.className ? '.' + this.container.className.split(' ').slice(0, 2).join('.') : ''}>`;
    logCallback?.('info', 'DOM', `Contenedor de lista localizado: ${containerDesc} (ScrollHeight: ${this.container.scrollHeight}px).`);

    let stagnationCycles = 0;
    const MAX_STAGNATION_LIMIT = 6;
    let cycle = 0;

    while (!this.isAborted) {
      if (this.isPaused) {
        await this.rateLimiter.sleep(400);
        continue;
      }
      cycle++;
      const initialCount = this.harvestedMap.size;

      // 1. Synthesize hover on cards and harvest newly populated anchors
      const newlyAdded = await this.harvestVisibleElements();

      if (newlyAdded.length > 0) {
        stagnationCycles = 0;
        const sampleTitles = newlyAdded.slice(0, 2).map((p) => `"${p.title}"`).join(', ');
        logCallback?.('info', 'EXTRACT', `Ciclo #${cycle}: Extraídos +${newlyAdded.length} lugares (${sampleTitles}). Total: ${this.harvestedMap.size}`);
      } else {
        stagnationCycles++;
      }

      progressCallback({
        count: this.harvestedMap.size,
        newlyAdded,
        isStagnant: stagnationCycles > 0,
      });

      // Sentinel or stagnation termination evaluation
      if (this.detectTerminalSentinel() || stagnationCycles >= MAX_STAGNATION_LIMIT) {
        logCallback?.('warn', 'RECOVERY', `Ciclo #${cycle}: Sin nuevos elementos visibles. Ejecutando micro-scroll para re-activar reciclador virtual de Google...`);
        // Recovery routine: scroll backward slightly to re-trigger Google intersection observers
        this.performActiveScroll(-350);
        await this.rateLimiter.sleep(500);
        this.performActiveScroll(450);
        await this.rateLimiter.sleep(600);

        const recoveryAdded = await this.harvestVisibleElements();
        if (recoveryAdded.length > 0) {
          stagnationCycles = 0;
          const sample = recoveryAdded.slice(0, 2).map((p) => `"${p.title}"`).join(', ');
          logCallback?.('info', 'EXTRACT', `Recuperación exitosa: +${recoveryAdded.length} lugares (${sample}). Total: ${this.harvestedMap.size}`);
          continue;
        }

        if (this.harvestedMap.size === initialCount && stagnationCycles >= MAX_STAGNATION_LIMIT) {
          logCallback?.('info', 'COMPLETE', `Ciclo #${cycle}: Final de la lista alcanzado tras ${cycle} ciclos. Extracción finalizada con éxito.`);
          break;
        }
      }

      // Variable downward scroll increment (350px - 520px)
      const variableStep = Math.floor(Math.random() * (520 - 350 + 1)) + 350;
      this.performActiveScroll(variableStep);
      logCallback?.('info', 'SCROLL', `Ciclo #${cycle}: Scroll +${variableStep}px (Posición: ${Math.round(this.container.scrollTop)}px). Lugares: ${this.harvestedMap.size}.`);

      // Fast, responsive delay (300ms - 550ms)
      await this.rateLimiter.applyAdaptiveDelay();
    }

    logCallback?.('info', 'SUCCESS', `Extracción completada. ${this.harvestedMap.size} lugares listos para exportar a Excel, GeoJSON, KML o CSV.`);
    return Array.from(this.harvestedMap.values());
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
      'div[jsaction*="place"]',
      'div[jsaction*="entity"]',
      'div[jsaction*="hover"]',
      'div[jsaction*="mouseover"]',
      'div[data-item-id]',
      'div.m6QErb > div',
      'a.hfpxzc',
      'button[aria-label][jsaction*="pin"]',
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

    // 2. Query all candidate anchors restricted to place links
    const anchorSelectors = [
      'a[href*="/maps/place/"]',
      'a[href*="/place/"]',
      'a[data-href*="/maps/place/"]',
      'a[data-href*="/place/"]',
      'a.hfpxzc',
    ];

    const anchors = new Set<HTMLAnchorElement>();
    root.querySelectorAll<HTMLAnchorElement>(anchorSelectors.join(', ')).forEach((a) => anchors.add(a));

    // Also check global tooltips/previews if they contain place links
    document.querySelectorAll<HTMLAnchorElement>('div[role="tooltip"] a[href*="/place/"], div[role="dialog"] a[href*="/place/"]').forEach((a) => anchors.add(a));

    anchors.forEach((anchor) => {
      const url = anchor.href || anchor.getAttribute('data-href') || '';
      const parsedCoords = GoogleMapsUrlParser.parse(url);
      if (!parsedCoords) return;

      const title =
        anchor.getAttribute('aria-label') ||
        anchor.querySelector('[role="heading"]')?.textContent?.trim() ||
        anchor.closest('div[role="article"], div.Nv2PK')?.querySelector('.fontHeadlineSmall, .qBF1Pd, [role="heading"], span.OSrXXb')?.textContent?.trim() ||
        '';

      if (!title || !isLegitimatePlaceTitle(title)) return;
      if (!isPlausibleGeoCoordinate(parsedCoords.latitude, parsedCoords.longitude)) return;

      const id =
        parsedCoords.placeId ||
        parsedCoords.featureId ||
        generateSyntheticPlaceId(title, parsedCoords.latitude, parsedCoords.longitude);

      if (!this.harvestedMap.has(id)) {
        const cardParent = anchor.closest('div[jsaction], div[role="article"], div.Nv2PK') || anchor.parentElement;
        const noteEl = cardParent?.querySelector('div[data-note], [aria-label*="note" i], span[class*="note" i]');
        const userNote = noteEl?.textContent?.trim() || undefined;

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
          userNote,
          isClosed,
          operationalStatus: isClosed ? 'Permanently closed' : 'Operational',
          extractedAt: new Date().toISOString(),
        };

        this.harvestedMap.set(id, record);
        newlyAdded.push(record);
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
