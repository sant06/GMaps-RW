/**
 * Type-safe storage definitions for chrome.storage.session and chrome.storage.local.
 */

import type { ExtractionProgressStats, MutationProgressStats, PipelineEngineStatus } from './messages';
import type { GoogleMapsListSummary, ScrapedPlaceRecord } from './places';
import type { AmbientAuthContext } from './rpc';

export interface StorageSessionState {
  pipelineStatus: PipelineEngineStatus;
  activeJobId?: string;
  activeTabId?: number;
  extractionProgress?: ExtractionProgressStats;
  mutationProgress?: MutationProgressStats;
  harvestedBuffer: ScrapedPlaceRecord[];
  authContext?: AmbientAuthContext;
  lastKeepAliveTimestamp: number;
}

export interface UserExtensionSettings {
  minDelayMs: number;
  maxDelayMs: number;
  coolingIntervalSeconds: number;
  autoDomFallback: boolean;
  exportFormatDefault: 'geojson' | 'kml' | 'csv';
  preserveNotes: boolean;
  concurrencyLimit: number;
}

export interface StorageLocalState {
  settings: UserExtensionSettings;
  cachedLists: GoogleMapsListSummary[];
  savedExportsHistory: {
    exportId: string;
    listTitle: string;
    itemCount: number;
    format: 'geojson' | 'kml' | 'csv';
    timestamp: string;
  }[];
}

export const DEFAULT_SETTINGS: UserExtensionSettings = {
  minDelayMs: 1200,
  maxDelayMs: 2500,
  coolingIntervalSeconds: 40,
  autoDomFallback: true,
  exportFormatDefault: 'geojson',
  preserveNotes: true,
  concurrencyLimit: 1,
};
