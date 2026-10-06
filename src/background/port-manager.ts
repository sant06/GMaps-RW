/**
 * Port manager and multiplexer for Background Service Worker.
 * Handles GMAPS_PIPELINE (content script) and GMAPS_SIDEPANEL (UI),
 * implements keep-alive heartbeats, and routes bidirectional commands.
 */

import { PIPELINE_PORT_NAME, SIDEPANEL_PORT_NAME } from '../types/messages';
import type {
  ContentToWorkerMessage,
  WorkerToContentMessage,
  SidePanelToWorkerMessage,
  WorkerToSidePanelMessage,
  PipelineStateSnapshot,
} from '../types/messages';
import { StateManager } from './state-manager';

export class PortManager {
  private contentPort: chrome.runtime.Port | null = null;
  private sidePanelPort: chrome.runtime.Port | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatSeq = 0;
  private activeTabId: number | undefined;

  constructor() {
    this.initPortListeners();
  }

  private initPortListeners(): void {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === PIPELINE_PORT_NAME) {
        this.handleContentConnect(port);
      } else if (port.name === SIDEPANEL_PORT_NAME) {
        this.handleSidePanelConnect(port);
      }
    });
  }

  private handleContentConnect(port: chrome.runtime.Port): void {
    console.log('[PortManager] Content pipeline connected.');
    this.contentPort = port;
    this.activeTabId = port.sender?.tab?.id;

    this.startKeepAlive();
    this.notifySidePanelConnection(true, port.sender?.tab?.url);

    port.onMessage.addListener(async (msg: ContentToWorkerMessage) => {
      await this.processContentMessage(msg);
    });

    port.onDisconnect.addListener(() => {
      console.warn('[PortManager] Content pipeline disconnected.');
      this.contentPort = null;
      this.stopKeepAlive();
      this.notifySidePanelConnection(false);
    });
  }

  private handleSidePanelConnect(port: chrome.runtime.Port): void {
    console.log('[PortManager] Side Panel connected.');
    this.sidePanelPort = port;

    // Send immediate snapshot upon mounting
    this.broadcastStateSnapshot();

    port.onMessage.addListener(async (msg: SidePanelToWorkerMessage) => {
      await this.processSidePanelMessage(msg);
    });

    port.onDisconnect.addListener(() => {
      console.log('[PortManager] Side Panel disconnected.');
      this.sidePanelPort = null;
    });
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    // Exchanging heartbeats every 20s resets the Chrome MV3 30-second idle timer
    this.keepAliveInterval = setInterval(() => {
      if (this.contentPort) {
        try {
          this.contentPort.postMessage({
            type: 'HEARTBEAT_PONG',
            payload: { sequence: ++this.heartbeatSeq, timestamp: Date.now() },
          } as WorkerToContentMessage);
        } catch (err) {
          console.warn('[PortManager] Keep-alive ping failed:', err);
        }
      }
    }, 20000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  private async processContentMessage(msg: ContentToWorkerMessage): Promise<void> {
    switch (msg.type) {
      case 'HEARTBEAT_PING':
        // Acknowledge ping
        if (this.contentPort) {
          this.contentPort.postMessage({
            type: 'HEARTBEAT_PONG',
            payload: { sequence: msg.payload.sequence, timestamp: Date.now() },
          } as WorkerToContentMessage);
        }
        break;

      case 'AUTH_CONTEXT_AVAILABLE':
        await StateManager.updateAuthContext(msg.payload);
        this.sendToSidePanel({
          type: 'LOG_ENTRY',
          payload: {
            level: 'info',
            timestamp: Date.now(),
            tag: 'AUTH',
            message: `Ambient CSRF token captured (${msg.payload.atToken ? 'Valid' : 'Partial'}).`,
          },
        });
        await this.broadcastStateSnapshot();
        break;

      case 'EXTRACTION_PROGRESS':
        await StateManager.updateExtractionStats(msg.payload);
        this.sendToSidePanel({ type: 'LIVE_EXTRACTION_PROGRESS', payload: msg.payload });
        break;

      case 'EXTRACTION_STREAM_BATCH': {
        const total = await StateManager.appendHarvestedPlaces(msg.payload.items);
        this.sendToSidePanel({
          type: 'ITEMS_HARVESTED_UPDATE',
          payload: { newlyAdded: msg.payload.items, totalCount: total },
        });
        break;
      }

      case 'EXTRACTION_ACTION_LOG':
        this.sendToSidePanel({
          type: 'LOG_ENTRY',
          payload: {
            level: msg.payload.level,
            timestamp: Date.now(),
            tag: msg.payload.tag,
            message: msg.payload.message,
          },
        });
        break;

      case 'EXTRACTION_COMPLETED': {
        await StateManager.updatePipelineStatus('completed');
        if (msg.payload.items && msg.payload.items.length > 0) {
          const total = await StateManager.appendHarvestedPlaces(msg.payload.items);
          this.sendToSidePanel({
            type: 'ITEMS_HARVESTED_UPDATE',
            payload: { newlyAdded: msg.payload.items, totalCount: total },
          });
        }
        this.sendToSidePanel({
          type: 'OPERATION_FINISHED',
          payload: {
            operation: 'extraction',
            success: true,
            message: `Harvested ${msg.payload.totalItems} locations successfully.`,
          },
        });
        await this.broadcastStateSnapshot();
        break;
      }

      case 'EXTRACTION_ERROR':
        await StateManager.updatePipelineStatus('error');
        this.sendToSidePanel({
          type: 'LOG_ENTRY',
          payload: {
            level: 'error',
            timestamp: Date.now(),
            tag: 'EXTRACTION',
            message: msg.payload.message,
          },
        });
        await this.broadcastStateSnapshot();
        break;

      case 'MUTATION_PROGRESS':
        await StateManager.updateMutationStats(msg.payload);
        this.sendToSidePanel({ type: 'LIVE_MUTATION_PROGRESS', payload: msg.payload });
        break;

      case 'MUTATION_ITEM_RESULT':
        this.sendToSidePanel({ type: 'MUTATION_ITEM_UPDATE', payload: msg.payload });
        break;

      case 'MUTATION_FALLBACK_PROMPT_REQUIRED':
        this.sendToSidePanel({
          type: 'MUTATION_FALLBACK_REQUESTED',
          payload: { item: msg.payload.item, reason: msg.payload.rpcError },
        });
        break;

      case 'MUTATION_COMPLETED':
        await StateManager.updatePipelineStatus('completed');
        this.sendToSidePanel({
          type: 'OPERATION_FINISHED',
          payload: {
            operation: 'mutation',
            success: true,
            message: `Mutation completed: ${msg.payload.summary.successCount} saved, ${msg.payload.summary.failureCount} failed.`,
          },
        });
        await this.broadcastStateSnapshot();
        break;
    }
  }

  private async processSidePanelMessage(msg: SidePanelToWorkerMessage): Promise<void> {
    switch (msg.type) {
      case 'GET_PIPELINE_STATE':
      case 'HEARTBEAT_PING':
        await this.broadcastStateSnapshot();
        break;

      case 'REQUEST_START_EXTRACTION':
        if (!this.contentPort) {
          this.sendToSidePanel({
            type: 'LOG_ENTRY',
            payload: {
              level: 'warn',
              timestamp: Date.now(),
              tag: 'CONNECT',
              message: 'Google Maps no está conectado aún. Buscando pestaña e inyectando pipeline...',
            },
          });

          const injected = await this.tryAutoInjectMapsTab();
          if (!injected) {
            this.sendToSidePanel({
              type: 'LOG_ENTRY',
              payload: {
                level: 'error',
                timestamp: Date.now(),
                tag: 'RELOAD_REQUIRED',
                message: 'No hay conexión con Google Maps. Si acabas de recargar la extensión, por favor presiona F5 en la pestaña de Google Maps para reactivar la conexión.',
              },
            });
            await StateManager.updatePipelineStatus('idle');
            await this.broadcastStateSnapshot();
            this.sendToSidePanel({
              type: 'OPERATION_FINISHED',
              payload: {
                operation: 'extraction',
                success: false,
                message: 'Por favor recarga (F5) la pestaña de Google Maps.',
              },
            });
            return;
          }
        }
        await StateManager.clearHarvestedPlaces();
        await StateManager.updatePipelineStatus('extracting');
        this.sendToContent({ type: 'CMD_START_EXTRACTION', payload: msg.payload });
        break;

      case 'REQUEST_PAUSE_EXTRACTION':
        await StateManager.updatePipelineStatus('paused');
        this.sendToContent({ type: 'CMD_PAUSE_EXTRACTION' });
        break;

      case 'REQUEST_RESUME_EXTRACTION':
        await StateManager.updatePipelineStatus('extracting');
        this.sendToContent({ type: 'CMD_RESUME_EXTRACTION' });
        break;

      case 'REQUEST_ABORT_EXTRACTION':
        await StateManager.updatePipelineStatus('idle');
        this.sendToContent({ type: 'CMD_ABORT_EXTRACTION' });
        break;

      case 'REQUEST_START_MUTATION':
        await StateManager.updatePipelineStatus('mutating');
        this.sendToContent({ type: 'CMD_START_MUTATION', payload: msg.payload });
        break;

      case 'RESPOND_FALLBACK_APPROVAL':
        this.sendToContent({ type: 'CMD_APPROVE_DOM_FALLBACK', payload: msg.payload });
        break;

      case 'REQUEST_PAUSE_MUTATION':
        await StateManager.updatePipelineStatus('paused');
        this.sendToContent({ type: 'CMD_PAUSE_MUTATION' });
        break;

      case 'REQUEST_RESUME_MUTATION':
        await StateManager.updatePipelineStatus('mutating');
        this.sendToContent({ type: 'CMD_RESUME_MUTATION' });
        break;

      case 'REQUEST_ABORT_MUTATION':
        await StateManager.updatePipelineStatus('idle');
        this.sendToContent({ type: 'CMD_ABORT_MUTATION' });
        break;

      case 'CLEAR_ACTIVE_SESSION':
        await StateManager.clearHarvestedPlaces();
        await StateManager.updatePipelineStatus('idle');
        await this.broadcastStateSnapshot();
        break;
    }
  }

  public sendToContent(msg: WorkerToContentMessage): void {
    if (this.contentPort) {
      this.contentPort.postMessage(msg);
    } else {
      console.warn('[PortManager] No active content script connected to relay message.');
    }
  }

  public sendToSidePanel(msg: WorkerToSidePanelMessage): void {
    if (this.sidePanelPort) {
      this.sidePanelPort.postMessage(msg);
    }
  }

  public async broadcastStateSnapshot(): Promise<void> {
    const session = await StateManager.getSessionState();
    const snapshot: PipelineStateSnapshot = {
      status: session.pipelineStatus,
      activeTabConnected: this.contentPort !== null,
      currentOperation: session.pipelineStatus === 'extracting' ? 'extraction' : session.pipelineStatus === 'mutating' ? 'mutation' : undefined,
      extractionStats: session.extractionProgress,
      mutationStats: session.mutationProgress,
      harvestedItemsCount: session.harvestedBuffer.length,
      authCaptured: !!session.authContext?.atToken,
    };

    this.sendToSidePanel({ type: 'STATE_SNAPSHOT', payload: snapshot });
  }

  private notifySidePanelConnection(connected: boolean, url?: string): void {
    this.sendToSidePanel({
      type: 'TAB_CONNECTION_CHANGED',
      payload: { connected, tabId: this.activeTabId, url },
    });
  }

  private async tryAutoInjectMapsTab(): Promise<boolean> {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.google.*/maps*' });
      let targetTab = tabs[0];
      if (!targetTab) {
        const allTabs = await chrome.tabs.query({});
        targetTab = allTabs.find((t) => t.url && t.url.includes('/maps')) || tabs[0];
      }
      if (!targetTab?.id) return false;

      this.sendToSidePanel({
        type: 'LOG_ENTRY',
        payload: {
          level: 'info',
          timestamp: Date.now(),
          tag: 'INJECT',
          message: `Inyectando script de extracción en pestaña activa (id: ${targetTab.id})...`,
        },
      });

      await chrome.scripting.executeScript({
        target: { tabId: targetTab.id },
        files: ['dist/content.bundle.js'],
      });

      // Wait up to 1.5s for port to connect
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (this.contentPort) return true;
      }
      return this.contentPort !== null;
    } catch (err) {
      console.warn('[PortManager] Auto-inject failed:', err);
      return false;
    }
  }
}
