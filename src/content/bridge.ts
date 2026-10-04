/**
 * Cryptographic bridge running in the ISOLATED world.
 * Manages secure communication with the MAIN world interceptor via window.postMessage.
 */

import {
  BRIDGE_SOURCE_ISOLATED,
  isMainWorldMessage,
} from '../types/messages';
import type {
  MainToIsolatedMessage,
  IsolatedToMainMessage,
  MainToIsolatedRpcCaptured,
  MainToIsolatedAuthCaptured,
} from '../types/messages';
import type { BatchexecuteReplayRequest, BatchexecuteReplayResponse } from '../types/rpc';
import { generateBridgeNonce, generateCorrelationId } from '../utils/crypto';

export class CrossWorldBridge {
  private nonce: string;
  private pendingCorrelationMap = new Map<
    string,
    { resolve: (res: BatchexecuteReplayResponse) => void; reject: (err: Error) => void; timer: number }
  >();

  private rpcListeners: ((data: MainToIsolatedRpcCaptured) => void)[] = [];
  private authListeners: ((data: MainToIsolatedAuthCaptured) => void)[] = [];
  private isReady = false;

  constructor() {
    this.nonce = generateBridgeNonce();
    this.initMessageListener();
  }

  public getNonce(): string {
    return this.nonce;
  }

  public isInterceptorReady(): boolean {
    return this.isReady;
  }

  /**
   * Dynamically mounts the MAIN world interceptor script tag into the host document.
   */
  public injectInterceptor(): void {
    const scriptUrl = chrome.runtime.getURL('dist/injected_interceptor.bundle.js');
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.dataset.bridgeNonce = this.nonce;
    script.onload = () => {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  public onRpc(listener: (data: MainToIsolatedRpcCaptured) => void): void {
    this.rpcListeners.push(listener);
  }

  public onAuth(listener: (data: MainToIsolatedAuthCaptured) => void): void {
    this.authListeners.push(listener);
  }

  /**
   * Executes an internal RPC mutation in the MAIN world with ambient cookies and awaits response.
   */
  public executeRpcMutation(
    request: BatchexecuteReplayRequest,
    timeoutMs = 12000
  ): Promise<BatchexecuteReplayResponse> {
    const correlationId = generateCorrelationId('mut');

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingCorrelationMap.delete(correlationId);
        reject(new Error(`RPC mutation timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pendingCorrelationMap.set(correlationId, { resolve, reject, timer });

      const msg: IsolatedToMainMessage = {
        source: BRIDGE_SOURCE_ISOLATED,
        nonce: this.nonce,
        type: 'EXECUTE_RPC_MUTATION',
        payload: { correlationId, request },
        timestamp: Date.now(),
      };

      window.postMessage(msg, window.location.origin);
    });
  }

  public queryAuthContext(): void {
    const msg: IsolatedToMainMessage = {
      source: BRIDGE_SOURCE_ISOLATED,
      nonce: this.nonce,
      type: 'QUERY_AUTH_CONTEXT',
      payload: { reason: 'manual_query' },
      timestamp: Date.now(),
    };
    window.postMessage(msg, window.location.origin);
  }

  public queryInitialState(): void {
    const msg = {
      source: BRIDGE_SOURCE_ISOLATED,
      nonce: this.nonce,
      type: 'QUERY_INITIAL_STATE',
      payload: {},
      timestamp: Date.now(),
    };
    window.postMessage(msg, window.location.origin);
  }

  private initMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isMainWorldMessage(event.data, this.nonce)) return;

      const data = event.data as MainToIsolatedMessage;

      switch (data.type) {
        case 'INTERCEPTOR_READY':
          this.isReady = true;
          this.queryAuthContext();
          break;

        case 'RPC_INTERCEPTED':
          for (const listener of this.rpcListeners) {
            listener(data.payload);
          }
          break;

        case 'AUTH_CONTEXT_CAPTURED':
          for (const listener of this.authListeners) {
            listener(data.payload);
          }
          break;

        case 'MUTATION_REPLAY_RESPONSE': {
          const { correlationId, response } = data.payload;
          const pending = this.pendingCorrelationMap.get(correlationId);
          if (pending) {
            window.clearTimeout(pending.timer);
            this.pendingCorrelationMap.delete(correlationId);
            pending.resolve(response);
          }
          break;
        }
      }
    });
  }
}
