/**
 * Content Script entry point (ISOLATED World).
 * Manages injection of MAIN world interceptor, cryptographic nonce verification,
 * and maintains long-lived port connection to the Service Worker.
 */

import { PIPELINE_PORT_NAME, BRIDGE_SOURCE_MAIN } from '../types/messages';
import type { MainToIsolatedMessage, WorkerToContentMessage } from '../types/messages';

console.log('[Content Script] Initializing in ISOLATED world...');

// Generate dynamic cryptographic nonce for MAIN <-> ISOLATED bridge
const bridgeNonce = crypto.randomUUID();

// Connect to background Service Worker
let pipelinePort: chrome.runtime.Port | null = null;

function connectToBackground(): void {
  try {
    pipelinePort = chrome.runtime.connect({ name: PIPELINE_PORT_NAME });
    console.log('[Content Script] Established port connection to Background SW.');

    pipelinePort.onMessage.addListener((msg: WorkerToContentMessage) => {
      console.log('[Content Script] Received from SW:', msg.type);
    });

    pipelinePort.onDisconnect.addListener(() => {
      console.warn('[Content Script] Background port disconnected. Reconnecting in 3s...');
      pipelinePort = null;
      setTimeout(connectToBackground, 3000);
    });
  } catch (err) {
    console.error('[Content Script] Failed to connect to background:', err);
    setTimeout(connectToBackground, 5000);
  }
}

connectToBackground();

// Listen to postMessage from MAIN world interceptor
window.addEventListener('message', (event: MessageEvent) => {
  if (event.origin !== window.location.origin) return;
  const data = event.data as Partial<MainToIsolatedMessage>;
  if (!data || data.source !== BRIDGE_SOURCE_MAIN || data.nonce !== bridgeNonce) return;

  console.log('[Content Script] Verified bridge message from MAIN world:', data.type);
});

// Inject MAIN world interceptor script
function injectMainWorldInterceptor(): void {
  const scriptUrl = chrome.runtime.getURL('dist/injected_interceptor.bundle.js');
  const scriptTag = document.createElement('script');
  scriptTag.src = scriptUrl;
  scriptTag.dataset.bridgeNonce = bridgeNonce;
  scriptTag.onload = () => {
    console.log('[Content Script] Interceptor script successfully mounted in MAIN world.');
    scriptTag.remove();
  };
  (document.head || document.documentElement).appendChild(scriptTag);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectMainWorldInterceptor);
} else {
  injectMainWorldInterceptor();
}
