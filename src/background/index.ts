/**
 * Service Worker background entry point.
 * Coordinates ephemeral lifecycle management, Port keep-alives,
 * and message routing between Content Script and Side Panel.
 */

import { PIPELINE_PORT_NAME, SIDEPANEL_PORT_NAME } from '../types/messages';
import type { ContentToWorkerMessage, WorkerToContentMessage, SidePanelToWorkerMessage, WorkerToSidePanelMessage } from '../types/messages';

console.log('[Background SW] Service worker initializing...');

// Active runtime ports
let contentPort: chrome.runtime.Port | null = null;
let sidePanelPort: chrome.runtime.Port | null = null;
let heartbeatSequence = 0;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

// Connect listener for long-lived ports
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PIPELINE_PORT_NAME) {
    console.log('[Background SW] Connected to Content Script pipeline port.');
    contentPort = port;
    setupKeepAlive();

    port.onMessage.addListener((message: ContentToWorkerMessage) => {
      handleContentMessage(message);
    });

    port.onDisconnect.addListener(() => {
      console.warn('[Background SW] Content Script port disconnected.');
      contentPort = null;
      notifySidePanelTabStatus(false);
    });

    notifySidePanelTabStatus(true);
  } else if (port.name === SIDEPANEL_PORT_NAME) {
    console.log('[Background SW] Connected to Side Panel port.');
    sidePanelPort = port;

    port.onMessage.addListener((message: SidePanelToWorkerMessage) => {
      handleSidePanelMessage(message);
    });

    port.onDisconnect.addListener(() => {
      console.log('[Background SW] Side Panel disconnected.');
      sidePanelPort = null;
    });
  }
});

function setupKeepAlive(): void {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  // Send heartbeat every 20s to prevent MV3 30-second worker termination
  keepAliveTimer = setInterval(() => {
    if (contentPort) {
      try {
        contentPort.postMessage({
          type: 'HEARTBEAT_PONG',
          payload: { sequence: ++heartbeatSequence, timestamp: Date.now() },
        } as WorkerToContentMessage);
      } catch (err) {
        console.warn('[Background SW] Keep-alive ping failed:', err);
      }
    }
  }, 20000);
}

function handleContentMessage(msg: ContentToWorkerMessage): void {
  // Relay relevant progress and data to the active Side Panel
  if (!sidePanelPort) return;

  switch (msg.type) {
    case 'EXTRACTION_PROGRESS':
      sidePanelPort.postMessage({ type: 'LIVE_EXTRACTION_PROGRESS', payload: msg.payload } as WorkerToSidePanelMessage);
      break;
    case 'EXTRACTION_STREAM_BATCH':
      sidePanelPort.postMessage({
        type: 'ITEMS_HARVESTED_UPDATE',
        payload: { newlyAdded: msg.payload.items, totalCount: msg.payload.totalHarvestedSoFar },
      } as WorkerToSidePanelMessage);
      break;
    case 'MUTATION_PROGRESS':
      sidePanelPort.postMessage({ type: 'LIVE_MUTATION_PROGRESS', payload: msg.payload } as WorkerToSidePanelMessage);
      break;
    case 'MUTATION_ITEM_RESULT':
      sidePanelPort.postMessage({ type: 'MUTATION_ITEM_UPDATE', payload: msg.payload } as WorkerToSidePanelMessage);
      break;
    default:
      break;
  }
}

function handleSidePanelMessage(msg: SidePanelToWorkerMessage): void {
  // Relay commands to the Content Script
  if (!contentPort) {
    console.warn('[Background SW] Cannot relay command: No active content script connected.');
    return;
  }

  switch (msg.type) {
    case 'REQUEST_START_EXTRACTION':
      contentPort.postMessage({ type: 'CMD_START_EXTRACTION', payload: msg.payload } as WorkerToContentMessage);
      break;
    case 'REQUEST_PAUSE_EXTRACTION':
      contentPort.postMessage({ type: 'CMD_PAUSE_EXTRACTION' } as WorkerToContentMessage);
      break;
    case 'REQUEST_RESUME_EXTRACTION':
      contentPort.postMessage({ type: 'CMD_RESUME_EXTRACTION' } as WorkerToContentMessage);
      break;
    case 'REQUEST_ABORT_EXTRACTION':
      contentPort.postMessage({ type: 'CMD_ABORT_EXTRACTION' } as WorkerToContentMessage);
      break;
    case 'REQUEST_START_MUTATION':
      contentPort.postMessage({ type: 'CMD_START_MUTATION', payload: msg.payload } as WorkerToContentMessage);
      break;
    case 'REQUEST_PAUSE_MUTATION':
      contentPort.postMessage({ type: 'CMD_PAUSE_MUTATION' } as WorkerToContentMessage);
      break;
    case 'REQUEST_RESUME_MUTATION':
      contentPort.postMessage({ type: 'CMD_RESUME_MUTATION' } as WorkerToContentMessage);
      break;
    case 'REQUEST_ABORT_MUTATION':
      contentPort.postMessage({ type: 'CMD_ABORT_MUTATION' } as WorkerToContentMessage);
      break;
  }
}

function notifySidePanelTabStatus(connected: boolean): void {
  if (sidePanelPort) {
    sidePanelPort.postMessage({
      type: 'TAB_CONNECTION_CHANGED',
      payload: { connected },
    } as WorkerToSidePanelMessage);
  }
}

// Enable sidePanel behavior on action icon click
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch((err) => {
  console.warn('[Background SW] setPanelBehavior error:', err);
});
