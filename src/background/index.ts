/**
 * Service Worker background entry point.
 * Coordinates ephemeral lifecycle management, Port keep-alives,
 * and state persistence across worker terminations.
 */

import { PortManager } from './port-manager';
import { StateManager } from './state-manager';

console.log('[Background SW] Starting Google Maps Spatial Sync Engine worker...');

// Initialize Port multiplexer and keep-alive heartbeat loop
export const portManager = new PortManager();

// Configure side panel to open on action click
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch((err) => {
  console.warn('[Background SW] setPanelBehavior error:', err);
});

// Restore session state on worker startup
StateManager.getSessionState().then((state) => {
  console.log(`[Background SW] Restored session state (Status: ${state.pipelineStatus}, Harvested: ${state.harvestedBuffer.length})`);
});
