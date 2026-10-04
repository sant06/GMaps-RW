/**
 * Injected Script (MAIN World Execution Context).
 * Intercepts Google Maps Batchexecute RPC fetch/XHR traffic,
 * extracts ambient session CSRF (WIZ) tokens,
 * and replayers mutation requests carrying ambient cookies.
 */

import {
  BRIDGE_SOURCE_MAIN,
  isIsolatedWorldMessage,
} from '../types/messages';
import type { MainToIsolatedMessage } from '../types/messages';
import type { BatchexecuteReplayResponse } from '../types/rpc';
import { BatchexecuteUnpacker } from './rpc-unpacker';

(() => {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  const BRIDGE_NONCE = currentScript?.dataset.bridgeNonce || '';

  if (!BRIDGE_NONCE) {
    console.warn('[Interceptor MAIN] Missing bridge nonce. Halting initialization.');
    return;
  }

  console.log('[Interceptor MAIN] Successfully mounted in host MAIN execution context.');

  const TARGET_ENDPOINTS = [
    '/maps/preview/',
    'tbm=map',
    'batchexecute',
    '/maps/rpc/',
    '/search?tbm=map',
    'userplaces',
    'entity',
    '/maps/api/place/',
    'collection',
    'placelist',
    'lookup',
    'list',
  ];

  // PostMessage dispatch helper
  function postToBridge(msg: Omit<MainToIsolatedMessage, 'nonce' | 'source' | 'timestamp'>): void {
    const fullMsg: MainToIsolatedMessage = {
      ...msg,
      source: BRIDGE_SOURCE_MAIN,
      nonce: BRIDGE_NONCE,
      timestamp: Date.now(),
    } as MainToIsolatedMessage;

    window.postMessage(fullMsg, window.location.origin);
  }

  // Periodic and on-demand auth extractor
  function inspectAndBroadcastAuth(): void {
    const auth = BatchexecuteUnpacker.extractAmbientWizData();
    if (auth.atToken || auth.fSid) {
      postToBridge({
        type: 'AUTH_CONTEXT_CAPTURED',
        payload: { authContext: auth },
      });
    }
  }

  // Scans initial host page state (APP_INITIALIZATION_STATE / _pageData / script tags) for places already hydrated on load
  function inspectInitialAppState(): void {
    try {
      const win = window as unknown as Record<string, unknown>;
      const candidates = [win.APP_INITIALIZATION_STATE, win._pageData, win._];
      for (const candidate of candidates) {
        if (candidate) {
          const places = BatchexecuteUnpacker.deepExtractPlaces(candidate);
          if (places.length > 0) {
            postToBridge({
              type: 'RPC_INTERCEPTED',
              payload: {
                endpoint: 'APP_INITIALIZATION_STATE',
                method: 'GET',
                rawBody: '',
                parsedPayload: [candidate],
                rpcId: 'initial_state',
              },
            });
          }
        }
      }

      // Also scan script tags for inline JSON/WIZ arrays
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const s of scripts) {
        const text = s.textContent || '';
        if (
          text.includes('APP_INITIALIZATION_STATE') ||
          text.includes('_pageData') ||
          text.includes(')]}\'')
        ) {
          const places = BatchexecuteUnpacker.deepExtractPlaces(text);
          if (places.length > 0) {
            postToBridge({
              type: 'RPC_INTERCEPTED',
              payload: {
                endpoint: 'INLINE_SCRIPT_STATE',
                method: 'GET',
                rawBody: text,
                parsedPayload: [text],
                rpcId: 'script_tags',
              },
            });
          }
        }
      }
    } catch {
      // Fail silently
    }
  }

  // Initial broadcasts with retries for late WIZ/DOM hydration
  setTimeout(inspectAndBroadcastAuth, 500);
  setTimeout(inspectInitialAppState, 600);
  setTimeout(inspectAndBroadcastAuth, 1500);
  setTimeout(inspectInitialAppState, 1800);
  setTimeout(inspectAndBroadcastAuth, 3500);
  setTimeout(inspectInitialAppState, 3800);

  // ==========================================================================
  // 1. MONKEY-PATCH NATIVE fetch API
  // ==========================================================================
  const originalFetch = window.fetch;

  window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string'
        ? args[0]
        : args[0] instanceof Request
          ? args[0].url
          : '';

      const isTarget = TARGET_ENDPOINTS.some((ep) => url.includes(ep));

      if (isTarget) {
        // Inspect outgoing request body for at= token if POST
        if (args[1]?.body && typeof args[1].body === 'string') {
          const match = args[1].body.match(/at=([^&]+)/);
          if (match) {
            const capturedAt = decodeURIComponent(match[1]);
            const auth = BatchexecuteUnpacker.extractAmbientWizData();
            auth.atToken = capturedAt;
            postToBridge({
              type: 'AUTH_CONTEXT_CAPTURED',
              payload: { authContext: auth },
            });
          }
        }

        const clone = response.clone();
        clone.text().then((rawBody) => {
          const unpacked = BatchexecuteUnpacker.unpack(rawBody);

          postToBridge({
            type: 'RPC_INTERCEPTED',
            payload: {
              endpoint: url,
              method: (args[1]?.method || 'GET').toUpperCase(),
              rawBody,
              parsedPayload: unpacked.map((u) => u.rawJson),
              rpcId: unpacked[0]?.rpcId,
            },
          });
        }).catch(() => {});
      }
    } catch {
      // Fail silently to never interrupt Google Maps host execution
    }

    return response;
  };

  // ==========================================================================
  // 2. MONKEY-PATCH NATIVE XMLHttpRequest API
  // ==========================================================================
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    (this as unknown as { __requestUrl: string; __method: string }).__requestUrl =
      typeof url === 'string' ? url : url.toString();
    (this as unknown as { __requestUrl: string; __method: string }).__method = method;
    return originalOpen.apply(this, [method, url, ...rest] as Parameters<typeof originalOpen>);
  };

  XMLHttpRequest.prototype.send = function (
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    this.addEventListener('load', () => {
      try {
        const url = (this as unknown as { __requestUrl: string }).__requestUrl || '';
        const method = (this as unknown as { __method: string }).__method || 'GET';
        const isTarget = TARGET_ENDPOINTS.some((ep) => url.includes(ep));

        if (isTarget && this.responseText) {
          const unpacked = BatchexecuteUnpacker.unpack(this.responseText);

          postToBridge({
            type: 'RPC_INTERCEPTED',
            payload: {
              endpoint: url,
              method,
              rawBody: this.responseText,
              parsedPayload: unpacked.map((u) => u.rawJson),
              rpcId: unpacked[0]?.rpcId,
            },
          });
        }
      } catch {
        // Fail silently
      }
    });

    return originalSend.apply(this, [body]);
  };

  // ==========================================================================
  // 3. LISTEN FOR INCOMING COMMANDS FROM ISOLATED WORLD (RPC REPLAY & AUTH)
  // ==========================================================================
  window.addEventListener('message', async (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (!isIsolatedWorldMessage(event.data, BRIDGE_NONCE)) return;

    const data = event.data;

    switch (data.type) {
      case 'QUERY_AUTH_CONTEXT': {
        inspectAndBroadcastAuth();
        inspectInitialAppState();
        break;
      }

      case 'QUERY_INITIAL_STATE' as unknown as string: {
        inspectInitialAppState();
        break;
      }

      case 'EXECUTE_RPC_MUTATION': {
        const { correlationId, request } = data.payload;
        try {
          const replayResult = await executeNativeBatchexecuteRpc(request);
          postToBridge({
            type: 'MUTATION_REPLAY_RESPONSE',
            payload: {
              correlationId,
              response: replayResult,
            },
          });
        } catch (err) {
          const errResponse: BatchexecuteReplayResponse = {
            success: false,
            httpStatus: 0,
            rpcId: request.rpcId,
            error: err instanceof Error ? err.message : String(err),
          };
          postToBridge({
            type: 'MUTATION_REPLAY_RESPONSE',
            payload: {
              correlationId,
              response: errResponse,
            },
          });
        }
        break;
      }
    }
  });

  /**
   * Replays an internal batchexecute mutation request using host page's ambient cookies.
   */
  async function executeNativeBatchexecuteRpc(
    request: { endpointUrl: string; rpcId: string; innerPayload: unknown[]; atToken?: string }
  ): Promise<BatchexecuteReplayResponse> {
    const auth = BatchexecuteUnpacker.extractAmbientWizData();
    const token = request.atToken || auth.atToken;

    if (!token) {
      return {
        success: false,
        httpStatus: 401,
        rpcId: request.rpcId,
        error: 'Missing ambient CSRF token (atToken) in active session.',
      };
    }

    // Envelope format: [[[rpcId, innerPayloadJson, null, "generic"]]]
    const innerJson = JSON.stringify(request.innerPayload);
    const envelope = [[[request.rpcId, innerJson, null, 'generic']]];
    const fReq = JSON.stringify(envelope);

    const bodyParams = new URLSearchParams();
    bodyParams.set('f.req', fReq);
    bodyParams.set('at', token);

    // Endpoint URL
    const targetUrl = request.endpointUrl.includes('batchexecute')
      ? request.endpointUrl
      : `${window.location.origin}/_/common/batchexecute?rpcids=${request.rpcId}&rt=c`;

    const res = await originalFetch.call(window, targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Same-Domain': '1',
      },
      body: bodyParams.toString(),
      credentials: 'include', // Guarantees ambient cookie inclusion
    });

    const text = await res.text();
    const isSuccess = res.ok && !text.includes('[[null,null,"error"]');

    return {
      success: isSuccess,
      httpStatus: res.status,
      rpcId: request.rpcId,
      rawText: text,
      extractedResult: BatchexecuteUnpacker.unpack(text),
    };
  }

  // Announce ready
  postToBridge({
    type: 'INTERCEPTOR_READY',
    payload: { version: '1.0.0' },
  });
})();
