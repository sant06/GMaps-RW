/**
 * Type-safe messaging contract across all execution environments:
 * 1. MAIN World (Injected script) <-> ISOLATED World (Content script) via window.postMessage
 * 2. ISOLATED World (Content script) <-> Background Service Worker via chrome.runtime.Port ('GMAPS_PIPELINE')
 * 3. Side Panel UI <-> Background Service Worker via chrome.runtime.Port ('GMAPS_SIDEPANEL')
 */

import type { ScrapedPlaceRecord, GoogleMapsListSummary, MutationItemPayload, MutationResult } from './places';
import type { AmbientAuthContext, BatchexecuteReplayRequest, BatchexecuteReplayResponse } from './rpc';

// ============================================================================
// 1. MAIN <-> ISOLATED CROSS-WORLD BRIDGE MESSAGES (window.postMessage)
// ============================================================================

export const BRIDGE_SOURCE_MAIN = 'GMAPS_INTERCEPTOR_MAIN' as const;
export const BRIDGE_SOURCE_ISOLATED = 'GMAPS_BRIDGE_ISOLATED' as const;

export type BridgeSource = typeof BRIDGE_SOURCE_MAIN | typeof BRIDGE_SOURCE_ISOLATED;

export interface BaseCrossWorldMessage<TType extends string, TPayload> {
  source: BridgeSource;
  nonce: string;
  type: TType;
  payload: TPayload;
  timestamp: number;
}

// MAIN -> ISOLATED
export interface MainToIsolatedRpcCaptured {
  endpoint: string;
  method: string;
  rawBody: string;
  parsedPayload?: unknown[];
  rpcId?: string;
}

export interface MainToIsolatedAuthCaptured {
  authContext: AmbientAuthContext;
}

export interface MainToIsolatedReplayResult {
  correlationId: string;
  response: BatchexecuteReplayResponse;
}

export type MainToIsolatedMessage =
  | BaseCrossWorldMessage<'RPC_INTERCEPTED', MainToIsolatedRpcCaptured>
  | BaseCrossWorldMessage<'AUTH_CONTEXT_CAPTURED', MainToIsolatedAuthCaptured>
  | BaseCrossWorldMessage<'INTERCEPTOR_READY', { version: string }>
  | BaseCrossWorldMessage<'MUTATION_REPLAY_RESPONSE', MainToIsolatedReplayResult>;

// ISOLATED -> MAIN
export interface IsolatedToMainExecuteRpc {
  correlationId: string;
  request: BatchexecuteReplayRequest;
}

export interface IsolatedToMainQueryAuth {
  reason: string;
}

export type IsolatedToMainMessage =
  | BaseCrossWorldMessage<'EXECUTE_RPC_MUTATION', IsolatedToMainExecuteRpc>
  | BaseCrossWorldMessage<'QUERY_AUTH_CONTEXT', IsolatedToMainQueryAuth>
  | BaseCrossWorldMessage<'HANDSHAKE_ACK', { status: 'acknowledged' }>;

export type CrossWorldBridgeMessage = MainToIsolatedMessage | IsolatedToMainMessage;

// Type Guard for Cross-World Bridge
export function isMainWorldMessage(eventData: unknown, expectedNonce: string): eventData is MainToIsolatedMessage {
  if (typeof eventData !== 'object' || eventData === null) return false;
  const msg = eventData as Partial<MainToIsolatedMessage>;
  return (
    msg.source === BRIDGE_SOURCE_MAIN &&
    msg.nonce === expectedNonce &&
    typeof msg.type === 'string' &&
    typeof msg.timestamp === 'number'
  );
}

export function isIsolatedWorldMessage(eventData: unknown, expectedNonce: string): eventData is IsolatedToMainMessage {
  if (typeof eventData !== 'object' || eventData === null) return false;
  const msg = eventData as Partial<IsolatedToMainMessage>;
  return (
    msg.source === BRIDGE_SOURCE_ISOLATED &&
    msg.nonce === expectedNonce &&
    typeof msg.type === 'string' &&
    typeof msg.timestamp === 'number'
  );
}

// ============================================================================
// 2. RUNTIME PIPELINE MESSAGES (Content Script <-> Service Worker via Port)
// ============================================================================

export const PIPELINE_PORT_NAME = 'GMAPS_PIPELINE' as const;
export const SIDEPANEL_PORT_NAME = 'GMAPS_SIDEPANEL' as const;

export type ExtractionMode = 'hybrid' | 'rpc_only' | 'dom_only';
export type MutationMode = 'rpc_first_with_dom_fallback' | 'rpc_only' | 'dom_only';

export interface ExtractionOptions {
  mode: ExtractionMode;
  listId?: string;
  listName?: string;
  maxItems?: number;
  enableNotesExtraction?: boolean;
  coolingIntervalSeconds?: number;
}

export interface MutationOptions {
  mode: MutationMode;
  targetListId: string;
  targetListName?: string;
  createNewListIfNeeded?: boolean;
  adaptiveDelayMinMs?: number;
  adaptiveDelayMaxMs?: number;
  maxConsecutiveFailures?: number;
}

// Extraction Progress Stats
export interface ExtractionProgressStats {
  totalHarvested: number;
  uniqueCoordinatesCount: number;
  velocityItemsPerSec: number;
  etaSeconds: number | null;
  currentScrollOffset: number;
  stagnationCycles: number;
  mode: ExtractionMode;
  activeListName?: string;
}

// Mutation Progress Stats
export interface MutationProgressStats {
  totalItems: number;
  processedCount: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  currentItemTitle?: string;
  etaSeconds: number | null;
  activeMode: MutationMode;
}

// Pipeline Port Message Payloads
export interface HeartbeatPayload {
  sequence: number;
  timestamp: number;
}

export interface ExtractionStreamPayload {
  items: ScrapedPlaceRecord[];
  isTerminalBatch: boolean;
  totalHarvestedSoFar: number;
}

export interface PipelineErrorMessage {
  phase: 'extraction' | 'mutation' | 'auth' | 'bridge';
  code: string;
  message: string;
  recoverable: boolean;
  stack?: string;
}

// Typed Messages through Port
export type ContentToWorkerMessage =
  | { type: 'HEARTBEAT_PING'; payload: HeartbeatPayload }
  | { type: 'TAB_STATUS_READY'; payload: { url: string; hasFeedContainer: boolean; listTitle?: string } }
  | { type: 'AUTH_CONTEXT_AVAILABLE'; payload: AmbientAuthContext }
  | { type: 'EXTRACTION_PROGRESS'; payload: ExtractionProgressStats }
  | { type: 'EXTRACTION_STREAM_BATCH'; payload: ExtractionStreamPayload }
  | { type: 'EXTRACTION_COMPLETED'; payload: { totalItems: number; items: ScrapedPlaceRecord[] } }
  | { type: 'EXTRACTION_ERROR'; payload: PipelineErrorMessage }
  | { type: 'MUTATION_PROGRESS'; payload: MutationProgressStats }
  | { type: 'MUTATION_ITEM_RESULT'; payload: { item: MutationItemPayload; result: MutationResult } }
  | { type: 'MUTATION_COMPLETED'; payload: { summary: MutationProgressStats } }
  | { type: 'MUTATION_ERROR'; payload: PipelineErrorMessage };

export type WorkerToContentMessage =
  | { type: 'HEARTBEAT_PONG'; payload: HeartbeatPayload }
  | { type: 'CMD_START_EXTRACTION'; payload: ExtractionOptions }
  | { type: 'CMD_PAUSE_EXTRACTION' }
  | { type: 'CMD_RESUME_EXTRACTION' }
  | { type: 'CMD_ABORT_EXTRACTION' }
  | { type: 'CMD_START_MUTATION'; payload: { items: MutationItemPayload[]; options: MutationOptions } }
  | { type: 'CMD_PAUSE_MUTATION' }
  | { type: 'CMD_RESUME_MUTATION' }
  | { type: 'CMD_ABORT_MUTATION' }
  | { type: 'CMD_INSPECT_DOM_STATE' };

// ============================================================================
// 3. SIDEPANEL <-> SERVICE WORKER CONTRACT
// ============================================================================

export type SidePanelToWorkerMessage =
  | { type: 'UI_READY' }
  | { type: 'GET_PIPELINE_STATE' }
  | { type: 'REQUEST_START_EXTRACTION'; payload: ExtractionOptions }
  | { type: 'REQUEST_PAUSE_EXTRACTION' }
  | { type: 'REQUEST_RESUME_EXTRACTION' }
  | { type: 'REQUEST_ABORT_EXTRACTION' }
  | { type: 'REQUEST_START_MUTATION'; payload: { items: MutationItemPayload[]; options: MutationOptions } }
  | { type: 'REQUEST_PAUSE_MUTATION' }
  | { type: 'REQUEST_RESUME_MUTATION' }
  | { type: 'REQUEST_ABORT_MUTATION' }
  | { type: 'CLEAR_ACTIVE_SESSION' }
  | { type: 'FETCH_KNOWN_LISTS' };

export type WorkerToSidePanelMessage =
  | { type: 'STATE_SNAPSHOT'; payload: PipelineStateSnapshot }
  | { type: 'TAB_CONNECTION_CHANGED'; payload: { connected: boolean; tabId?: number; url?: string } }
  | { type: 'LIVE_EXTRACTION_PROGRESS'; payload: ExtractionProgressStats }
  | { type: 'LIVE_MUTATION_PROGRESS'; payload: MutationProgressStats }
  | { type: 'ITEMS_HARVESTED_UPDATE'; payload: { newlyAdded: ScrapedPlaceRecord[]; totalCount: number } }
  | { type: 'MUTATION_ITEM_UPDATE'; payload: { item: MutationItemPayload; result: MutationResult } }
  | { type: 'OPERATION_FINISHED'; payload: { operation: 'extraction' | 'mutation'; success: boolean; message: string } }
  | { type: 'LOG_ENTRY'; payload: LogEntryMessage }
  | { type: 'KNOWN_LISTS_UPDATE'; payload: GoogleMapsListSummary[] };

export interface LogEntryMessage {
  level: 'info' | 'warn' | 'error' | 'debug';
  timestamp: number;
  tag: string;
  message: string;
  details?: unknown;
}

export type PipelineEngineStatus = 'idle' | 'initializing' | 'extracting' | 'mutating' | 'paused' | 'completed' | 'error';

export interface PipelineStateSnapshot {
  status: PipelineEngineStatus;
  activeTabConnected: boolean;
  activeTabUrl?: string;
  currentOperation?: 'extraction' | 'mutation';
  extractionStats?: ExtractionProgressStats;
  mutationStats?: MutationProgressStats;
  harvestedItemsCount: number;
  authCaptured: boolean;
  lastError?: PipelineErrorMessage;
}
