/**
 * Side Panel Controller (chrome.sidePanel context).
 * Connects to background SW via Port ('GMAPS_SIDEPANEL')
 * and drives UI state, metrics display, and file export triggers.
 */

import { SIDEPANEL_PORT_NAME } from '../types/messages';
import type { SidePanelToWorkerMessage, WorkerToSidePanelMessage } from '../types/messages';
import type { ScrapedPlaceRecord } from '../types/places';

console.log('[Side Panel] Controller initializing...');

let backgroundPort: chrome.runtime.Port | null = null;
const harvestedPlaces: Map<string, ScrapedPlaceRecord> = new Map();

// UI Elements
const elConnIndicator = document.getElementById('connection-indicator');
const elConnText = document.getElementById('connection-status-text');
const elTabBadge = document.getElementById('tab-url-badge');
const elAuthStatus = document.getElementById('auth-status-value');
const elMetricHarvested = document.getElementById('metric-harvested');
const elMetricVelocity = document.getElementById('metric-velocity');
const elMetricEta = document.getElementById('metric-eta');
const elProgressBar = document.getElementById('extraction-progress-bar');
const elLogTerminal = document.getElementById('log-terminal');

const btnStartExtract = document.getElementById('btn-start-extract') as HTMLButtonElement;
const btnPauseExtract = document.getElementById('btn-pause-extract') as HTMLButtonElement;
const btnAbortExtract = document.getElementById('btn-abort-extract') as HTMLButtonElement;

const btnExportGeoJson = document.getElementById('btn-export-geojson') as HTMLButtonElement;
const btnExportKml = document.getElementById('btn-export-kml') as HTMLButtonElement;
const btnExportCsv = document.getElementById('btn-export-csv') as HTMLButtonElement;

// Tab switcher
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const panelId = btn.id === 'tab-btn-extract' ? 'panel-extract' : btn.id === 'tab-btn-mutate' ? 'panel-mutate' : 'panel-settings';
    document.getElementById(panelId)?.classList.add('active');
  });
});

function connectToBackground(): void {
  try {
    backgroundPort = chrome.runtime.connect({ name: SIDEPANEL_PORT_NAME });
    backgroundPort.onMessage.addListener(handleWorkerMessage);
    backgroundPort.onDisconnect.addListener(() => {
      backgroundPort = null;
      updateConnectionStatus(false);
      logEntry('warn', 'Disconnected from service worker. Retrying in 2s...');
      setTimeout(connectToBackground, 2000);
    });
    updateConnectionStatus(true);
    logEntry('info', 'Connected to Background Service Worker.');
  } catch (err) {
    updateConnectionStatus(false);
    setTimeout(connectToBackground, 3000);
  }
}

connectToBackground();

function handleWorkerMessage(msg: WorkerToSidePanelMessage): void {
  switch (msg.type) {
    case 'TAB_CONNECTION_CHANGED':
      updateConnectionStatus(msg.payload.connected);
      if (elTabBadge) elTabBadge.textContent = msg.payload.connected ? 'Google Maps Connected' : 'No Maps Tab';
      break;

    case 'LIVE_EXTRACTION_PROGRESS':
      if (elMetricHarvested) elMetricHarvested.textContent = String(msg.payload.totalHarvested);
      if (elMetricVelocity) elMetricVelocity.textContent = `${msg.payload.velocityItemsPerSec.toFixed(1)}/s`;
      if (elMetricEta) elMetricEta.textContent = msg.payload.etaSeconds != null ? `${msg.payload.etaSeconds}s` : '--:--';
      if (elProgressBar && msg.payload.totalHarvested > 0) {
        // Pulse or indicate active harvesting
        elProgressBar.style.width = '100%';
      }
      break;

    case 'STATE_SNAPSHOT':
      if (elAuthStatus) {
        elAuthStatus.textContent = msg.payload.authCaptured ? 'Captured (Active)' : 'Unintercepted';
        elAuthStatus.className = msg.payload.authCaptured ? 'value text-success' : 'value text-warning';
      }
      break;

    case 'ITEMS_HARVESTED_UPDATE':
      msg.payload.newlyAdded.forEach((item) => harvestedPlaces.set(item.id, item));
      if (elMetricHarvested) elMetricHarvested.textContent = String(harvestedPlaces.size);
      updateExportButtonsState();
      break;

    case 'LOG_ENTRY':
      logEntry(msg.payload.level, msg.payload.message);
      break;
  }
}

function updateConnectionStatus(connected: boolean): void {
  if (elConnIndicator && elConnText) {
    if (connected) {
      elConnIndicator.className = 'status-indicator status-connected';
      elConnText.textContent = 'Ready';
    } else {
      elConnIndicator.className = 'status-indicator status-disconnected';
      elConnText.textContent = 'Disconnected';
    }
  }
}

function updateExportButtonsState(): void {
  const hasItems = harvestedPlaces.size > 0;
  if (btnExportGeoJson) btnExportGeoJson.disabled = !hasItems;
  if (btnExportKml) btnExportKml.disabled = !hasItems;
  if (btnExportCsv) btnExportCsv.disabled = !hasItems;
}

function logEntry(level: 'info' | 'warn' | 'error' | 'debug', text: string): void {
  if (!elLogTerminal) return;
  const line = document.createElement('div');
  line.className = `log-line log-${level}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${text}`;
  elLogTerminal.appendChild(line);
  elLogTerminal.scrollTop = elLogTerminal.scrollHeight;
}

// Clear logs button
document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
  if (elLogTerminal) elLogTerminal.innerHTML = '';
});

// Extraction trigger
btnStartExtract?.addEventListener('click', () => {
  const select = document.getElementById('extraction-mode-select') as HTMLSelectElement;
  const mode = (select?.value || 'hybrid') as 'hybrid' | 'rpc_only' | 'dom_only';

  backgroundPort?.postMessage({
    type: 'REQUEST_START_EXTRACTION',
    payload: { mode },
  } as SidePanelToWorkerMessage);

  btnStartExtract.disabled = true;
  if (btnPauseExtract) btnPauseExtract.disabled = false;
  if (btnAbortExtract) btnAbortExtract.disabled = false;
  logEntry('info', `Dispatched extraction start command (mode: ${mode}).`);
});

btnPauseExtract?.addEventListener('click', () => {
  backgroundPort?.postMessage({ type: 'REQUEST_PAUSE_EXTRACTION' } as SidePanelToWorkerMessage);
  logEntry('warn', 'Extraction paused.');
});

btnAbortExtract?.addEventListener('click', () => {
  backgroundPort?.postMessage({ type: 'REQUEST_ABORT_EXTRACTION' } as SidePanelToWorkerMessage);
  btnStartExtract.disabled = false;
  if (btnPauseExtract) btnPauseExtract.disabled = true;
  if (btnAbortExtract) btnAbortExtract.disabled = true;
  logEntry('error', 'Extraction aborted by user.');
});
