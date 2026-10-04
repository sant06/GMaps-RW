/**
 * Content Script entry point (ISOLATED World).
 * Bridges MAIN world network interception with the Service Worker GMAPS_PIPELINE port,
 * and orchestrates both the virtual DOM scroller and the write/mutation engine.
 */

import { PIPELINE_PORT_NAME } from '../types/messages';
import type {
  ContentToWorkerMessage,
  WorkerToContentMessage,
  ExtractionOptions,
  MutationOptions,
  MutationProgressStats,
} from '../types/messages';
import type { MutationItemPayload } from '../types/places';
import { CrossWorldBridge } from './bridge';
import { BatchexecuteUnpacker } from '../injected/rpc-unpacker';
import { MapsVirtualScroller } from './scroller';
import { RpcMutationBuilder } from '../injected/rpc-mutations';
import { GoogleMapsUiMutator } from './ui-mutator';
import { RateLimiter } from '../utils/rate-limiter';

console.log('[Content Script] Initializing Google Maps bidirectional bridge...');

export const bridge = new CrossWorldBridge();
const uiMutator = new GoogleMapsUiMutator();
const mutationRateLimiter = new RateLimiter({ minDelayMs: 1200, maxDelayMs: 2500 });

let pipelinePort: chrome.runtime.Port | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatSeq = 0;
let activeScroller: MapsVirtualScroller | null = null;

// Mutation state
let isMutationPaused = false;
let isMutationAborted = false;
let pendingFallbackApprovalResolve: ((approved: boolean) => void) | null = null;

// Track extraction stats
let extractionStartTime = 0;
let isExtractionActive = false;

// Inject MAIN world interceptor immediately
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => bridge.injectInterceptor());
} else {
  bridge.injectInterceptor();
}

function startClientHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  // Pinging the Service Worker from active DOM context every 15s keeps the MV3 SW alive indefinitely
  heartbeatTimer = setInterval(() => {
    if (pipelinePort) {
      try {
        pipelinePort.postMessage({
          type: 'HEARTBEAT_PING',
          payload: { sequence: ++heartbeatSeq, timestamp: Date.now() },
        } as ContentToWorkerMessage);
      } catch (err) {
        console.warn('[Content Script] Heartbeat ping failed:', err);
      }
    }
  }, 15000);
}

function stopClientHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function connectToBackground(): void {
  try {
    if (!chrome.runtime?.id) {
      console.info('[Content Script] Extension context invalidated. Tab reload required.');
      return;
    }

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    pipelinePort = chrome.runtime.connect({ name: PIPELINE_PORT_NAME });
    console.log('[Content Script] Connected to Background SW port.');

    startClientHeartbeat();

    const feed = document.querySelector('div[role="feed"]');
    const titleEl = document.querySelector('h1, div[role="heading"]');
    pipelinePort.postMessage({
      type: 'TAB_STATUS_READY',
      payload: {
        url: window.location.href,
        hasFeedContainer: feed !== null,
        listTitle: titleEl?.textContent?.trim(),
      },
    } as ContentToWorkerMessage);

    pipelinePort.postMessage({
      type: 'EXTRACTION_ACTION_LOG',
      payload: {
        level: 'info',
        tag: 'CONNECT',
        message: `Pestaña de Google Maps vinculada (${window.location.pathname}).`,
      },
    } as ContentToWorkerMessage);

    bridge.queryAuthContext();

    pipelinePort.onMessage.addListener(handleWorkerMessage);

    pipelinePort.onDisconnect.addListener(() => {
      console.warn('[Content Script] Pipeline port disconnected.');
      stopClientHeartbeat();
      pipelinePort = null;
      if (chrome.runtime?.id) {
        reconnectTimer = setTimeout(connectToBackground, 2500);
      }
    });
  } catch (err) {
    const isInvalidated = err instanceof Error && err.message.includes('Extension context invalidated');
    if (!isInvalidated) {
      console.error('[Content Script] Failed to connect to background pipeline:', err);
      stopClientHeartbeat();
      if (chrome.runtime?.id) {
        reconnectTimer = setTimeout(connectToBackground, 4000);
      }
    } else {
      console.info('[Content Script] Extension was reloaded. Please refresh (F5) the Google Maps tab.');
    }
  }
}

connectToBackground();

// Forward captured auth context to Service Worker
bridge.onAuth((payload) => {
  if (pipelinePort && payload.authContext.atToken) {
    pipelinePort.postMessage({
      type: 'AUTH_CONTEXT_AVAILABLE',
      payload: payload.authContext,
    } as ContentToWorkerMessage);
  }
});

// Forward intercepted Batchexecute RPC payloads to Service Worker ONLY during active extraction
bridge.onRpc((payload) => {
  if (!pipelinePort || !isExtractionActive) return;

  const places = BatchexecuteUnpacker.deepExtractPlaces(payload.parsedPayload || []);
  if (places.length > 0) {
    console.log(`[Content Script] Intercepted ${places.length} places from RPC (${payload.rpcId || 'preview'}).`);

    if (activeScroller) {
      activeScroller.addPreHarvested(places);
    }

    pipelinePort.postMessage({
      type: 'EXTRACTION_STREAM_BATCH',
      payload: {
        items: places,
        isTerminalBatch: false,
        totalHarvestedSoFar: places.length,
      },
    } as ContentToWorkerMessage);
  }
});

// ============================================================================
// READ ENGINE: EXTRACTION FLOW
// ============================================================================
async function startExtractionFlow(options: ExtractionOptions): Promise<void> {
  extractionStartTime = Date.now();
  isExtractionActive = true;

  if (options.mode === 'rpc_only') {
    console.log('[Content Script] RPC-only mode active: Listening passively to network streams.');
    return;
  }

  activeScroller = new MapsVirtualScroller();

  try {
    const finalItems = await activeScroller.runExtraction(
      (stats) => {
        if (!pipelinePort) return;

        const elapsedSec = (Date.now() - extractionStartTime) / 1000;
        const velocity = elapsedSec > 0 ? stats.count / elapsedSec : 0;

        if (stats.newlyAdded.length > 0) {
          pipelinePort.postMessage({
            type: 'EXTRACTION_STREAM_BATCH',
            payload: {
              items: stats.newlyAdded,
              isTerminalBatch: false,
              totalHarvestedSoFar: stats.count,
            },
          } as ContentToWorkerMessage);
        }

        pipelinePort.postMessage({
          type: 'EXTRACTION_PROGRESS',
          payload: {
            totalHarvested: stats.count,
            uniqueCoordinatesCount: stats.count,
            velocityItemsPerSec: velocity,
            etaSeconds: null,
            currentScrollOffset: 0,
            stagnationCycles: stats.isStagnant ? 1 : 0,
            mode: options.mode,
          },
        } as ContentToWorkerMessage);
      },
      (level, tag, message) => {
        if (!pipelinePort) return;
        pipelinePort.postMessage({
          type: 'EXTRACTION_ACTION_LOG',
          payload: { level, tag, message },
        } as ContentToWorkerMessage);
      }
    );

    pipelinePort?.postMessage({
      type: 'EXTRACTION_COMPLETED',
      payload: {
        totalItems: finalItems.length,
        items: finalItems,
      },
    } as ContentToWorkerMessage);
  } catch (err) {
    pipelinePort?.postMessage({
      type: 'EXTRACTION_ERROR',
      payload: {
        phase: 'extraction',
        code: 'SCROLLER_FAILURE',
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      },
    } as ContentToWorkerMessage);
  } finally {
    isExtractionActive = false;
    activeScroller = null;
  }
}

// ============================================================================
// WRITE ENGINE: MUTATION & INGESTION QUEUE
// ============================================================================
async function startMutationFlow(
  items: MutationItemPayload[],
  options: MutationOptions
): Promise<void> {
  isMutationPaused = false;
  isMutationAborted = false;

  const stats: MutationProgressStats = {
    totalItems: items.length,
    processedCount: 0,
    successCount: 0,
    failureCount: 0,
    fallbackCount: 0,
    etaSeconds: null,
    activeMode: options.mode,
  };

  const startTime = Date.now();

  for (let i = 0; i < items.length; i++) {
    if (isMutationAborted) {
      console.log('[Content Script] Mutation aborted by user.');
      break;
    }

    while (isMutationPaused && !isMutationAborted) {
      await mutationRateLimiter.sleep(500);
    }

    const item = items[i];
    stats.currentItemTitle = item.title;

    // Report progress
    pipelinePort?.postMessage({
      type: 'MUTATION_PROGRESS',
      payload: { ...stats },
    } as ContentToWorkerMessage);

    let succeeded = false;

    // Strategy 1: Attempt Batchexecute RPC mutation
    if (options.mode === 'rpc_first_with_dom_fallback' || options.mode === 'rpc_only') {
      try {
        const payloadObj = RpcMutationBuilder.buildSavePlacePayload(item);
        const rpcRes = await bridge.executeRpcMutation({
          endpointUrl: `${window.location.origin}/_/common/batchexecute`,
          rpcId: payloadObj.rpcId,
          innerPayload: payloadObj.innerPayload,
        });

        if (rpcRes.success) {
          succeeded = true;
          stats.successCount++;
          pipelinePort?.postMessage({
            type: 'MUTATION_ITEM_RESULT',
            payload: {
              item,
              result: {
                success: true,
                itemTitle: item.title,
                targetListId: item.targetListId,
                methodUsed: 'rpc',
                timestamp: Date.now(),
              },
            },
          } as ContentToWorkerMessage);
        } else {
          throw new Error(rpcRes.error || `RPC rejected with status ${rpcRes.httpStatus}`);
        }
      } catch (rpcErr) {
        const errMsg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
        console.warn(`[Content Script] RPC mutation failed for "${item.title}":`, errMsg);

        if (options.mode === 'rpc_first_with_dom_fallback') {
          // Architectural decision: Prompt user in Side Panel before DOM fallback
          pipelinePort?.postMessage({
            type: 'MUTATION_FALLBACK_PROMPT_REQUIRED',
            payload: { item, rpcError: errMsg },
          } as ContentToWorkerMessage);

          const approved = await waitForUserFallbackApproval();

          if (approved) {
            const fallbackRes = await uiMutator.executeSaveWorkflow(item);
            if (fallbackRes.success) {
              succeeded = true;
              stats.successCount++;
              stats.fallbackCount++;
            } else {
              stats.failureCount++;
            }

            pipelinePort?.postMessage({
              type: 'MUTATION_ITEM_RESULT',
              payload: { item, result: fallbackRes },
            } as ContentToWorkerMessage);
          } else {
            stats.failureCount++;
            pipelinePort?.postMessage({
              type: 'MUTATION_ITEM_RESULT',
              payload: {
                item,
                result: {
                  success: false,
                  itemTitle: item.title,
                  targetListId: item.targetListId,
                  methodUsed: 'rpc',
                  error: 'Fallback declined by user.',
                  timestamp: Date.now(),
                },
              },
            } as ContentToWorkerMessage);
          }
        } else {
          // rpc_only mode failed
          stats.failureCount++;
          pipelinePort?.postMessage({
            type: 'MUTATION_ITEM_RESULT',
            payload: {
              item,
              result: {
                success: false,
                itemTitle: item.title,
                targetListId: item.targetListId,
                methodUsed: 'rpc',
                error: errMsg,
                timestamp: Date.now(),
              },
            },
          } as ContentToWorkerMessage);
        }
      }
    } else if (options.mode === 'dom_only') {
      const fallbackRes = await uiMutator.executeSaveWorkflow(item);
      if (fallbackRes.success) {
        succeeded = true;
        stats.successCount++;
        stats.fallbackCount++;
      } else {
        stats.failureCount++;
      }

      pipelinePort?.postMessage({
        type: 'MUTATION_ITEM_RESULT',
        payload: { item, result: fallbackRes },
      } as ContentToWorkerMessage);
    }

    stats.processedCount++;

    // Calculate velocity & ETA
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = stats.processedCount / elapsed;
    const remaining = items.length - stats.processedCount;
    stats.etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;

    // Apply adaptive jitter delay between mutations
    if (i < items.length - 1 && succeeded) {
      await mutationRateLimiter.applyAdaptiveDelay();
    }
  }

  pipelinePort?.postMessage({
    type: 'MUTATION_COMPLETED',
    payload: { summary: stats },
  } as ContentToWorkerMessage);
}

function waitForUserFallbackApproval(): Promise<boolean> {
  return new Promise((resolve) => {
    pendingFallbackApprovalResolve = resolve;
  });
}

function handleWorkerMessage(msg: WorkerToContentMessage): void {
  switch (msg.type) {
    case 'HEARTBEAT_PONG':
      break;

    case 'CMD_START_EXTRACTION':
      startExtractionFlow(msg.payload);
      break;

    case 'CMD_PAUSE_EXTRACTION':
      activeScroller?.pause();
      break;

    case 'CMD_RESUME_EXTRACTION':
      activeScroller?.resume();
      break;

    case 'CMD_ABORT_EXTRACTION':
      isExtractionActive = false;
      activeScroller?.abort();
      activeScroller = null;
      break;

    case 'CMD_START_MUTATION':
      startMutationFlow(msg.payload.items, msg.payload.options);
      break;

    case 'CMD_APPROVE_DOM_FALLBACK':
      if (pendingFallbackApprovalResolve) {
        pendingFallbackApprovalResolve(msg.payload.approved);
        pendingFallbackApprovalResolve = null;
      }
      break;

    case 'CMD_PAUSE_MUTATION':
      isMutationPaused = true;
      break;

    case 'CMD_RESUME_MUTATION':
      isMutationPaused = false;
      break;

    case 'CMD_ABORT_MUTATION':
      isMutationAborted = true;
      if (pendingFallbackApprovalResolve) {
        pendingFallbackApprovalResolve(false);
        pendingFallbackApprovalResolve = null;
      }
      break;
  }
}
