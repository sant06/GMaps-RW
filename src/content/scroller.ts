/**
 * Virtualized DOM Harvester for Google Maps scrollable containers.
 * Traverses virtualized feeds (div[role="feed"]), handles recycled DOM elements,
 * decodes high-precision URL parameters (!3d/!4d), and applies anti-throttling jitter.
 */

import type { ScrapedPlaceRecord } from '../types/places';
import { GoogleMapsUrlParser } from './parser';
import { RateLimiter } from '../utils/rate-limiter';
import { generateSyntheticPlaceId } from '../utils/crypto';

export class MapsVirtualScroller {
  private container: HTMLElement | null = null;
  private harvestedMap: Map<string, ScrapedPlaceRecord> = new Map();
  private isPaused = false;
  private isAborted = false;
  private rateLimiter: RateLimiter;

  constructor(containerElement?: HTMLElement, rateLimiter?: RateLimiter) {
    this.container = containerElement || this.findPrimaryContainer();
    this.rateLimiter = rateLimiter || new RateLimiter();
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
        // Check if placed in the left-hand panel area (where list items live)
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
   * Executes the full scrolling harvesting loop with recovery checks and terminal sentinel detection.
   */
  public async runExtraction(
    progressCallback: (stats: { count: number; newlyAdded: ScrapedPlaceRecord[]; isStagnant: boolean }) => void
  ): Promise<ScrapedPlaceRecord[]> {
    if (!this.container) {
      this.container = this.findPrimaryContainer();
    }

    // If still not found, attempt to open the Saved panel automatically
    if (!this.container) {
      const opened = await this.tryAutoOpenSavedPanel();
      if (opened) {
        await this.rateLimiter.sleep(1200);
        this.container = this.findPrimaryContainer();
      }
    }

    if (!this.container) {
      throw new Error(
        'No active list panel found in Google Maps. Please open your Saved List (in Google Maps: click Menu ☰ -> Saved / Guardados -> select your list) and try again.'
      );
    }

    let stagnationCycles = 0;
    const MAX_STAGNATION_LIMIT = 5;

    while (!this.isAborted) {
      if (this.isPaused) {
        await this.rateLimiter.sleep(500);
        continue;
      }

      const initialCount = this.harvestedMap.size;
      const newlyAdded = this.harvestVisibleElements();

      if (newlyAdded.length === 0) {
        stagnationCycles++;
      } else {
        stagnationCycles = 0;
      }

      progressCallback({
        count: this.harvestedMap.size,
        newlyAdded,
        isStagnant: stagnationCycles > 0,
      });

      // Sentinel or stagnation termination evaluation
      if (this.detectTerminalSentinel() || stagnationCycles >= MAX_STAGNATION_LIMIT) {
        // Recovery routine: scroll backward slightly to re-trigger Google intersection observers
        this.container.scrollBy({ top: -350, behavior: 'smooth' });
        await this.rateLimiter.sleep(800);
        this.container.scrollTo({ top: this.container.scrollHeight, behavior: 'smooth' });
        await this.rateLimiter.sleep(1200);

        const recoveryAdded = this.harvestVisibleElements();
        if (recoveryAdded.length > 0) {
          stagnationCycles = 0;
          continue;
        }

        if (this.harvestedMap.size === initialCount && stagnationCycles >= MAX_STAGNATION_LIMIT) {
          console.log('[VirtualScroller] Termination criteria satisfied. Stagnation threshold reached.');
          break;
        }
      }

      // Smooth, variable downward scroll step (280px - 450px)
      const variableStep = Math.floor(Math.random() * (450 - 280 + 1)) + 280;
      this.container.scrollBy({ top: variableStep, behavior: 'smooth' });

      // Apply anti-throttling delay
      await this.rateLimiter.applyAdaptiveDelay();
    }

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
   * Scans currently mounted DOM nodes within the container.
   */
  public harvestVisibleElements(): ScrapedPlaceRecord[] {
    const root = this.container || document;
    const newlyAdded: ScrapedPlaceRecord[] = [];
    const anchors = root.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/place/"], a[href*="/place/"]');

    anchors.forEach((anchor) => {
      const url = anchor.href;
      const parsedCoords = GoogleMapsUrlParser.parse(url);
      if (!parsedCoords) return;

      const title =
        anchor.getAttribute('aria-label') ||
        anchor.querySelector('[role="heading"]')?.textContent?.trim() ||
        '';

      if (!title) return;

      const id =
        parsedCoords.placeId ||
        parsedCoords.featureId ||
        generateSyntheticPlaceId(title, parsedCoords.latitude, parsedCoords.longitude);

      if (!this.harvestedMap.has(id)) {
        const cardParent = anchor.closest('div[jsaction], div[role="article"]') || anchor.parentElement;
        const noteEl = cardParent?.querySelector('div[data-note], [aria-label*="note" i], span[class*="note" i]');
        const userNote = noteEl?.textContent?.trim() || undefined;

        const isClosed =
          cardParent?.textContent?.includes('Permanently closed') ||
          cardParent?.textContent?.includes('Temporarily closed') ||
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
    const text = this.container.innerText || '';
    return (
      text.includes("You've reached the end of the list") ||
      text.includes('No more results') ||
      text.includes('End of results') ||
      text.includes('Fin de los resultados') ||
      text.includes('Has llegado al final')
    );
  }
}
