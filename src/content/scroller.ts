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
   * Locates Google Maps virtualized container using semantic ARIA attributes.
   */
  public findPrimaryContainer(): HTMLElement | null {
    const candidates = [
      'div[role="feed"]',
      'div[role="main"] div[tabindex="-1"]',
      'div[aria-label][role="region"]',
      'div.m6QErb.DxyBCb', // Secondary legacy fallback
    ];

    for (const selector of candidates) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && el.scrollHeight > el.clientHeight) {
        return el;
      }
    }

    return document.querySelector<HTMLElement>('div[role="feed"]');
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
      if (!this.container) {
        throw new Error('Google Maps scrolling container (role="feed") not found in active document.');
      }
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
   * Scans currently mounted DOM nodes within the virtualized feed.
   */
  public harvestVisibleElements(): ScrapedPlaceRecord[] {
    if (!this.container) return [];

    const newlyAdded: ScrapedPlaceRecord[] = [];
    const anchors = this.container.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/place/"]');

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
        // Extract note if present in adjacent or sibling container
        const cardParent = anchor.closest('div[jsaction], div[role="article"]') || anchor.parentElement;
        const noteEl = cardParent?.querySelector('div[data-note], [aria-label*="note" i], span[class*="note" i]');
        const userNote = noteEl?.textContent?.trim() || undefined;

        // Check if closed
        const isClosed = cardParent?.textContent?.includes('Permanently closed') ||
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
          userNote,
          isClosed,
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
