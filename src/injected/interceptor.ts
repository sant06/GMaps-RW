/**
 * Injected script (MAIN World execution context).
 * Intercepts Google Maps Batchexecute RPC fetch/XHR network streams
 * and relays raw bodies across the postMessage bridge to the ISOLATED world.
 */

import { BRIDGE_SOURCE_MAIN } from '../types/messages';
import type { MainToIsolatedMessage } from '../types/messages';

(() => {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  const BRIDGE_NONCE = currentScript?.dataset.bridgeNonce || '';

  if (!BRIDGE_NONCE) {
    console.warn('[Interceptor MAIN] No bridge nonce detected. Halting injection.');
    return;
  }

  console.log('[Interceptor MAIN] Mounted in MAIN world execution context.');

  const TARGET_ENDPOINTS = ['/maps/preview/', 'tbm=map', 'batchexecute', '/maps/rpc/'];

  // Intercept window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string'
        ? args[0]
        : args[0] instanceof Request
          ? args[0].url
          : '';

      if (TARGET_ENDPOINTS.some((ep) => url.includes(ep))) {
        const clone = response.clone();
        clone.text().then((rawBody) => {
          const msg: MainToIsolatedMessage = {
            source: BRIDGE_SOURCE_MAIN,
            nonce: BRIDGE_NONCE,
            type: 'RPC_INTERCEPTED',
            payload: {
              endpoint: url,
              method: 'POST',
              rawBody,
            },
            timestamp: Date.now(),
          };
          window.postMessage(msg, window.location.origin);
        }).catch(() => {});
      }
    } catch {
      // Fail silently to avoid breaking Google Maps application execution
    }

    return response;
  };

  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: unknown[]) {
    (this as unknown as { __requestUrl: string }).__requestUrl = typeof url === 'string' ? url : url.toString();
    return originalOpen.apply(this, [method, url, ...rest] as Parameters<typeof originalOpen>);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    this.addEventListener('load', () => {
      try {
        const url = (this as unknown as { __requestUrl: string }).__requestUrl || '';
        if (TARGET_ENDPOINTS.some((ep) => url.includes(ep))) {
          const msg: MainToIsolatedMessage = {
            source: BRIDGE_SOURCE_MAIN,
            nonce: BRIDGE_NONCE,
            type: 'RPC_INTERCEPTED',
            payload: {
              endpoint: url,
              method: 'GET_OR_POST',
              rawBody: this.responseText,
            },
            timestamp: Date.now(),
          };
          window.postMessage(msg, window.location.origin);
        }
      } catch {
        // Fail silently
      }
    });

    return originalSend.apply(this, [body]);
  };

  // Announce ready
  window.postMessage({
    source: BRIDGE_SOURCE_MAIN,
    nonce: BRIDGE_NONCE,
    type: 'INTERCEPTOR_READY',
    payload: { version: '1.0.0' },
    timestamp: Date.now(),
  } as MainToIsolatedMessage, window.location.origin);
})();
