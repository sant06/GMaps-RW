/**
 * State persistence coordinator for Service Worker ephemeral lifecycle.
 * Manages chrome.storage.session (in-memory, survives worker suspension)
 * and chrome.storage.local (permanent user preferences & history).
 */

import type { StorageSessionState, StorageLocalState, UserExtensionSettings } from '../types/storage';
import { DEFAULT_SETTINGS } from '../types/storage';
import type { AmbientAuthContext } from '../types/rpc';
import type { ScrapedPlaceRecord, GoogleMapsListSummary } from '../types/places';
import type { ExtractionProgressStats, MutationProgressStats, PipelineEngineStatus } from '../types/messages';
import { isLegitimatePlaceTitle, isPlausibleGeoCoordinate } from '../utils/validation';

export class StateManager {
  private static readonly SESSION_KEY = 'GMAPS_SESSION_STATE';
  private static readonly LOCAL_KEY = 'GMAPS_LOCAL_STATE';

  /**
   * Retrieves or initializes the transient session state from chrome.storage.session.
   */
  public static async getSessionState(): Promise<StorageSessionState> {
    try {
      const data = await chrome.storage.session.get(this.SESSION_KEY);
      if (data && data[this.SESSION_KEY]) {
        return data[this.SESSION_KEY] as StorageSessionState;
      }
    } catch {
      // Fallback if session storage not supported or threw
    }

    const defaultSession: StorageSessionState = {
      pipelineStatus: 'idle',
      harvestedBuffer: [],
      lastKeepAliveTimestamp: Date.now(),
    };
    await this.saveSessionState(defaultSession);
    return defaultSession;
  }

  public static async saveSessionState(state: StorageSessionState): Promise<void> {
    try {
      await chrome.storage.session.set({ [this.SESSION_KEY]: state });
    } catch (err) {
      console.warn('[StateManager] Failed to save session state:', err);
    }
  }

  public static async updateAuthContext(auth: AmbientAuthContext): Promise<void> {
    const session = await this.getSessionState();
    session.authContext = auth;
    await this.saveSessionState(session);
  }

  public static async updatePipelineStatus(status: PipelineEngineStatus): Promise<void> {
    const session = await this.getSessionState();
    session.pipelineStatus = status;
    await this.saveSessionState(session);
  }

  public static async appendHarvestedPlaces(items: ScrapedPlaceRecord[]): Promise<number> {
    const session = await this.getSessionState();
    const map = new Map<string, ScrapedPlaceRecord>();
    session.harvestedBuffer.forEach((p) => map.set(p.id, p));
    items
      .filter((p) => isLegitimatePlaceTitle(p.title) && isPlausibleGeoCoordinate(p.latitude, p.longitude))
      .forEach((p) => map.set(p.id, p));
    session.harvestedBuffer = Array.from(map.values());
    await this.saveSessionState(session);
    return session.harvestedBuffer.length;
  }

  public static async getHarvestedPlaces(): Promise<ScrapedPlaceRecord[]> {
    const session = await this.getSessionState();
    return session.harvestedBuffer;
  }

  public static async clearHarvestedPlaces(): Promise<void> {
    const session = await this.getSessionState();
    session.harvestedBuffer = [];
    await this.saveSessionState(session);
  }

  public static async updateExtractionStats(stats: ExtractionProgressStats): Promise<void> {
    const session = await this.getSessionState();
    session.extractionProgress = stats;
    await this.saveSessionState(session);
  }

  public static async updateMutationStats(stats: MutationProgressStats): Promise<void> {
    const session = await this.getSessionState();
    session.mutationProgress = stats;
    await this.saveSessionState(session);
  }

  /**
   * Retrieves persistent user configuration from chrome.storage.local.
   */
  public static async getLocalState(): Promise<StorageLocalState> {
    try {
      const data = await chrome.storage.local.get(this.LOCAL_KEY);
      if (data && data[this.LOCAL_KEY]) {
        return data[this.LOCAL_KEY] as StorageLocalState;
      }
    } catch {
      // Ignore
    }

    const defaultLocal: StorageLocalState = {
      settings: DEFAULT_SETTINGS,
      cachedLists: [],
      savedExportsHistory: [],
    };
    await chrome.storage.local.set({ [this.LOCAL_KEY]: defaultLocal });
    return defaultLocal;
  }

  public static async saveSettings(settings: Partial<UserExtensionSettings>): Promise<void> {
    const local = await this.getLocalState();
    local.settings = { ...local.settings, ...settings };
    await chrome.storage.local.set({ [this.LOCAL_KEY]: local });
  }

  public static async saveCachedLists(lists: GoogleMapsListSummary[]): Promise<void> {
    const local = await this.getLocalState();
    local.cachedLists = lists;
    await chrome.storage.local.set({ [this.LOCAL_KEY]: local });
  }
}
