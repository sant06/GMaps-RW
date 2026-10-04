/**
 * Content Script entry point (ISOLATED World).
 * Bridges MAIN world network interception with the Service Worker GMAPS_PIPELINE port,
 * and orchestrates the virtual DOM scroller during hybrid/DOM extractions.
 */

import { PIPELINE_PORT_NAME } from '../types/messages';
import type {
  ContentToWorkerMessage,
  WorkerToContentMessage,
  ExtractionOptions,
} from '../types/messages';
import { CrossWorldBridge } from './bridge';
import { BatchexecuteUnpacker } from '../injected/rpc-unpacker';
import { MapsVirtualScroller } from './scroller';

console.log('[Content Script] Initializing Google Maps bidirectional bridge...');

export const bridge = new CrossWorldBridge();
let pipelinePort: chrome.runtime.Port | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let activeScroller: MapsVirtualScroller | null = null;

// Track extraction stats
let extractionStartTime = 0;

// Inject MAIN world interceptor immediately
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => bridge.injectInterceptor());
} else {
  bridge.injectInterceptor();
}

function connectToBackground(): void {
  try {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    pipelinePort = chrome.runtime.connect({ name: PIPELINE_PORT_NAME });
    console.log('[Content Script] Connected to Background SW port.');

    // Report active tab status
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

    bridge.queryAuthContext();

    pipelinePort.onMessage.addListener(handleWorkerMessage);

    pipelinePort.onDisconnect.addListener(() => {
      console.warn('[Content Script] Pipeline port disconnected. Scheduling reconnect in 2.5s...');
      pipelinePort = null;
      reconnectTimer = setTimeout(connectToBackground, 2500);
    });
  } catch (err) {
    console.error('[Content Script] Failed to connect to background pipeline:', err);
    reconnectTimer = setTimeout(connectToBackground, 4000);
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

// Forward intercepted Batchexecute RPC payloads to Service Worker
bridge.onRpc((payload) => {
  if (!pipelinePort) return;

  const places = BatchexecuteUnpacker.deepExtractPlaces(payload.parsedPayload || []);
  if (places.length > 0) {
    console.log(`[Content Script] Intercepted ${places.length} places from RPC (${payload.rpcId || 'preview'}).`);

    // Feed to active scroller so it doesn't duplicate
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

async function startExtractionFlow(options: ExtractionOptions): Promise<void> {
  extractionStartTime = Date.now();

  if (options.mode === 'rpc_only') {
    console.log('[Content Script] RPC-only mode active: Listening passively to network streams.');
    return;
  }

  // Hybrid or DOM-only: instantiate virtual scroller
  activeScroller = new MapsVirtualScroller();

  try {
    const finalItems = await activeScroller.runExtraction((stats) => {
      if (!pipelinePort) return;

      const elapsedSec = (Date.now() - extractionStartTime) / 1000;
      const velocity = elapsedSec > 0 ? stats.count / elapsedSec : 0;

      // Stream newly harvested items
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

      // Stream progress stats
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
    });

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
    activeScroller = null;
  }
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
      activeScroller?.abort();
      activeScroller = null;
      break;

    case 'CMD_START_MUTATION':
      console.log(`[Content Script] Received mutation command for ${msg.payload.items.length} items.`);
      break;

    case 'CMD_APPROVE_DOM_FALLBACK':
      console.log('[Content Script] User approved DOM fallback:', msg.payload.approved);
      break;
  }
}
