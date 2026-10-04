/**
 * UI Automation Fallback for Google Maps.
 * Executes programmatic workflows via synthetic browser events
 * when Batchexecute RPC signatures are rejected or session tokens are invalid.
 */

import type { MutationItemPayload, MutationResult } from '../types/places';
import { RateLimiter } from '../utils/rate-limiter';

export class GoogleMapsUiMutator {
  private rateLimiter: RateLimiter;

  constructor(rateLimiter?: RateLimiter) {
    this.rateLimiter = rateLimiter || new RateLimiter({ minDelayMs: 600, maxDelayMs: 1200 });
  }

  /**
   * Executes programmatic click workflow to save a place to a list in the rendered DOM.
   */
  public async executeSaveWorkflow(item: MutationItemPayload): Promise<MutationResult> {
    const startTime = Date.now();

    try {
      console.log(`[UiMutator] Starting programmatic DOM save for "${item.title}"...`);

      // 1. Locate the Save button on the currently visible place card
      const saveBtn = await this.locateSaveButton();
      if (!saveBtn) {
        throw new Error('Save button not found on current place card.');
      }

      // 2. Click the Save button to open the list selector modal
      this.dispatchSyntheticClick(saveBtn);
      await this.rateLimiter.sleep(800);

      // 3. Locate the target list item in the opened menu
      const listOption = await this.locateListOption(item.targetListName || item.targetListId);
      if (!listOption) {
        this.closeOpenMenu();
        throw new Error(`Target list option "${item.targetListName || item.targetListId}" not found in Save menu.`);
      }

      // 4. Check if already selected, click to toggle if not
      const isChecked =
        listOption.getAttribute('aria-checked') === 'true' ||
        listOption.querySelector('input[type="checkbox"]:checked') !== null;

      if (!isChecked) {
        this.dispatchSyntheticClick(listOption);
        await this.rateLimiter.sleep(600);
      }

      // 5. If user note is present, attempt to inject note
      if (item.userNote) {
        await this.injectUserNote(item.userNote);
      }

      // 6. Dismiss the modal / menu
      this.closeOpenMenu();
      await this.rateLimiter.sleep(500);

      return {
        success: true,
        itemTitle: item.title,
        targetListId: item.targetListId,
        methodUsed: 'dom_fallback',
        rpcExecutionTimeMs: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (err) {
      console.error('[UiMutator] DOM save workflow failed:', err);
      this.closeOpenMenu();
      return {
        success: false,
        itemTitle: item.title,
        targetListId: item.targetListId,
        methodUsed: 'dom_fallback',
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Searches for the primary Save / Guardar button using multi-lingual and aria selectors.
   */
  private async locateSaveButton(timeoutMs = 4000): Promise<HTMLElement | null> {
    const selectors = [
      'button[data-value="Save"]',
      'button[data-value="Guardar"]',
      'button[data-item-id="save"]',
      'button[aria-label*="Save" i]',
      'button[aria-label*="Guardar" i]',
      'button[aria-label*="Sauvegarder" i]',
      'button[aria-label*="Salva" i]',
      'div[role="main"] button:has([data-value="Save"])',
    ];

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const sel of selectors) {
        const btn = document.querySelector<HTMLElement>(sel);
        if (btn && this.isElementVisible(btn)) {
          return btn;
        }
      }
      await this.rateLimiter.sleep(200);
    }

    return null;
  }

  /**
   * Searches for the target list checkbox in the opened list selection popup.
   */
  private async locateListOption(listName: string, timeoutMs = 3000): Promise<HTMLElement | null> {
    const start = Date.now();
    const cleanTarget = listName.toLowerCase().trim();

    while (Date.now() - start < timeoutMs) {
      const candidates = document.querySelectorAll<HTMLElement>(
        'div[role="menuitemcheckbox"], button[role="menuitemcheckbox"], div[role="dialog"] div[data-item-id], div[role="dialog"] li'
      );

      for (const candidate of candidates) {
        const text = candidate.textContent?.toLowerCase() || '';
        const label = candidate.getAttribute('aria-label')?.toLowerCase() || '';

        if (text.includes(cleanTarget) || label.includes(cleanTarget)) {
          return candidate;
        }
      }

      await this.rateLimiter.sleep(200);
    }

    return null;
  }

  /**
   * Injects a note into the place card note input if mounted.
   */
  private async injectUserNote(noteText: string): Promise<void> {
    const noteInput = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
      'textarea[aria-label*="note" i], input[aria-label*="note" i], textarea[aria-label*="nota" i], input[aria-label*="nota" i]'
    );

    if (noteInput) {
      noteInput.focus();
      noteInput.value = noteText;
      noteInput.dispatchEvent(new Event('input', { bubbles: true }));
      noteInput.dispatchEvent(new Event('change', { bubbles: true }));
      await this.rateLimiter.sleep(300);
    }
  }

  private closeOpenMenu(): void {
    // Attempt to press Escape
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
    );

    // Or click close button
    const closeBtn = document.querySelector<HTMLElement>(
      'div[role="dialog"] button[aria-label*="Close" i], div[role="dialog"] button[aria-label*="Cerrar" i]'
    );
    if (closeBtn) {
      this.dispatchSyntheticClick(closeBtn);
    }
  }

  /**
   * Dispatches realistic synthetic MouseEvent sequence to trigger host jsaction handlers.
   */
  private dispatchSyntheticClick(element: HTMLElement): void {
    const opts = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new MouseEvent('pointerdown', opts));
    element.dispatchEvent(new MouseEvent('mousedown', opts));
    element.dispatchEvent(new MouseEvent('pointerup', opts));
    element.dispatchEvent(new MouseEvent('mouseup', opts));
    element.dispatchEvent(new MouseEvent('click', opts));
  }

  private isElementVisible(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
  }
}
