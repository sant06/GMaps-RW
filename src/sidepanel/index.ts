/**
 * Side Panel Controller (chrome.sidePanel context).
 * Drives the extension UI, reactive progress monitors, spatial data export/import workflows,
 * mutation fallback approval dialogs, and diagnostic audit logs.
 */

import { SIDEPANEL_PORT_NAME } from '../types/messages';
import type {
  SidePanelToWorkerMessage,
  WorkerToSidePanelMessage,
  MutationProgressStats,
} from '../types/messages';
import type { ScrapedPlaceRecord, MutationItemPayload } from '../types/places';
import { SpatialDataExporters } from './exporters';
import { SpatialDataImporters } from './importers';

console.log('[Side Panel] Controller initializing...');

let backgroundPort: chrome.runtime.Port | null = null;
const harvestedPlaces: Map<string, ScrapedPlaceRecord> = new Map();
let importedItemsQueue: MutationItemPayload[] = [];

// DOM Elements
const elConnIndicator = document.getElementById('connection-indicator');
const elConnText = document.getElementById('connection-status-text');
const elTabBadge = document.getElementById('tab-url-badge');
const elAuthStatus = document.getElementById('auth-status-value');
const elActiveList = document.getElementById('active-list-value');

// Extraction elements
const elMetricHarvested = document.getElementById('metric-harvested');
const elMetricVelocity = document.getElementById('metric-velocity');
const elMetricEta = document.getElementById('metric-eta');
const elProgressBar = document.getElementById('extraction-progress-bar');
const selectExtractionMode = document.getElementById('extraction-mode-select') as HTMLSelectElement;
const btnStartExtract = document.getElementById('btn-start-extract') as HTMLButtonElement;
const btnPauseExtract = document.getElementById('btn-pause-extract') as HTMLButtonElement;
const btnAbortExtract = document.getElementById('btn-abort-extract') as HTMLButtonElement;

// Export buttons
const btnExportExcel = document.getElementById('btn-export-excel') as HTMLButtonElement;
const btnExportGeoJson = document.getElementById('btn-export-geojson') as HTMLButtonElement;
const btnExportKml = document.getElementById('btn-export-kml') as HTMLButtonElement;
const btnExportCsv = document.getElementById('btn-export-csv') as HTMLButtonElement;

// Mutation elements
const fileImportInput = document.getElementById('file-import-input') as HTMLInputElement;
const selectMutationMode = document.getElementById('mutation-mode-select') as HTMLSelectElement;
const inputTargetList = document.getElementById('target-list-input') as HTMLInputElement;
const btnStartMutation = document.getElementById('btn-start-mutation') as HTMLButtonElement;
const btnPauseMutation = document.getElementById('btn-pause-mutation') as HTMLButtonElement;
const btnAbortMutation = document.getElementById('btn-abort-mutation') as HTMLButtonElement;
const elMetricMutSuccess = document.getElementById('metric-mut-success');
const elMetricMutPending = document.getElementById('metric-mut-pending');
const elMetricMutFailed = document.getElementById('metric-mut-failed');

// Fallback approval banner elements
const bannerFallback = document.getElementById('fallback-prompt-banner');
const elFallbackText = document.getElementById('fallback-prompt-text');
const btnApproveFallback = document.getElementById('btn-approve-fallback');
const btnRejectFallback = document.getElementById('btn-reject-fallback');

// Settings elements
const inputMinDelay = document.getElementById('setting-min-delay') as HTMLInputElement;
const inputMaxDelay = document.getElementById('setting-max-delay') as HTMLInputElement;
const inputCooling = document.getElementById('setting-cooling-interval') as HTMLInputElement;
const btnSaveSettings = document.getElementById('btn-save-settings') as HTMLButtonElement;

// Audit log terminal & Action Banner
const elLogTerminal = document.getElementById('log-terminal');
const btnClearLogs = document.getElementById('btn-clear-logs');
const elLiveActionText = document.getElementById('live-action-text');

// ============================================================================
// TAB NAVIGATION
// ============================================================================
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const panelId =
      btn.id === 'tab-btn-extract'
        ? 'panel-extract'
        : btn.id === 'tab-btn-mutate'
          ? 'panel-mutate'
          : 'panel-settings';
    document.getElementById(panelId)?.classList.add('active');
  });
});

// ============================================================================
// PORT CONNECTION & MESSAGE DISPATCH
// ============================================================================
let sidepanelHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let extractionStartTime = 0;

function startSidepanelHeartbeat(): void {
  if (sidepanelHeartbeatTimer) clearInterval(sidepanelHeartbeatTimer);
  sidepanelHeartbeatTimer = setInterval(() => {
    if (backgroundPort) {
      try {
        backgroundPort.postMessage({ type: 'HEARTBEAT_PING' } as SidePanelToWorkerMessage);
      } catch (err) {
        console.warn('[SidePanel] Heartbeat failed:', err);
      }
    }
  }, 15000);
}

function stopSidepanelHeartbeat(): void {
  if (sidepanelHeartbeatTimer) {
    clearInterval(sidepanelHeartbeatTimer);
    sidepanelHeartbeatTimer = null;
  }
}

function connectToBackground(): void {
  try {
    backgroundPort = chrome.runtime.connect({ name: SIDEPANEL_PORT_NAME });
    backgroundPort.onMessage.addListener(handleWorkerMessage);

    startSidepanelHeartbeat();

    backgroundPort.onDisconnect.addListener(() => {
      stopSidepanelHeartbeat();
      backgroundPort = null;
      updateConnectionStatus(false);
      logEntry('warn', 'Disconnected from service worker. Reconnecting in 2s...');
      setTimeout(connectToBackground, 2000);
    });

    updateConnectionStatus(true);
    logEntry('info', 'Connected to Background Service Worker.');
    backgroundPort.postMessage({ type: 'GET_PIPELINE_STATE' } as SidePanelToWorkerMessage);
  } catch {
    stopSidepanelHeartbeat();
    updateConnectionStatus(false);
    setTimeout(connectToBackground, 3000);
  }
}

connectToBackground();

function handleWorkerMessage(msg: WorkerToSidePanelMessage): void {
  switch (msg.type) {
    case 'TAB_CONNECTION_CHANGED':
      updateConnectionStatus(msg.payload.connected);
      if (elTabBadge) {
        elTabBadge.textContent = msg.payload.connected ? 'Google Maps Conectado' : 'Sin Conexión (Presiona F5)';
        elTabBadge.className = msg.payload.connected ? 'badge text-success' : 'badge text-warning';
      }
      if (elLiveActionText && !msg.payload.connected) {
        elLiveActionText.textContent = 'Google Maps desconectado. Abre o recarga (F5) la pestaña de Maps.';
        elLiveActionText.style.color = 'var(--accent-amber)';
      }
      break;

    case 'STATE_SNAPSHOT':
      if (elAuthStatus) {
        elAuthStatus.textContent = msg.payload.authCaptured ? 'Capturado (Activo)' : 'No interceptado';
        elAuthStatus.className = msg.payload.authCaptured ? 'value text-success' : 'value text-warning';
      }
      if (elTabBadge) {
        elTabBadge.textContent = msg.payload.activeTabConnected ? 'Google Maps Conectado' : 'Sin Conexión (Presiona F5)';
        elTabBadge.className = msg.payload.activeTabConnected ? 'badge text-success' : 'badge text-warning';
      }
      if (msg.payload.harvestedItemsCount > 0) {
        if (elMetricHarvested) elMetricHarvested.textContent = String(msg.payload.harvestedItemsCount);
      }
      break;

    case 'LIVE_EXTRACTION_PROGRESS':
      if (elMetricHarvested) elMetricHarvested.textContent = String(msg.payload.totalHarvested);
      if (elMetricVelocity) elMetricVelocity.textContent = `${msg.payload.velocityItemsPerSec.toFixed(1)}/s`;
      if (elMetricEta) elMetricEta.textContent = msg.payload.etaSeconds != null ? `${msg.payload.etaSeconds}s` : '--:--';
      if (elProgressBar && msg.payload.totalHarvested > 0) {
        elProgressBar.style.width = '100%';
      }
      break;

    case 'ITEMS_HARVESTED_UPDATE': {
      msg.payload.newlyAdded.forEach((item) => harvestedPlaces.set(item.id, item));
      if (elMetricHarvested) elMetricHarvested.textContent = String(harvestedPlaces.size);
      
      // Calculate dynamic extraction velocity and update UI
      if (extractionStartTime > 0 && elMetricVelocity) {
        const elapsedSec = (Date.now() - extractionStartTime) / 1000;
        if (elapsedSec > 0) {
          const velocity = harvestedPlaces.size / elapsedSec;
          elMetricVelocity.textContent = `${velocity.toFixed(1)}/s`;
        }
      }

      if (msg.payload.newlyAdded.length > 0) {
        logEntry('info', `Extracted ${msg.payload.newlyAdded.length} places (Total: ${harvestedPlaces.size})`);
      }
      updateExportButtonsState();
      break;
    }

    case 'LIVE_MUTATION_PROGRESS':
      updateMutationProgressDisplay(msg.payload);
      break;

    case 'MUTATION_ITEM_UPDATE':
      logEntry(
        msg.payload.result.success ? 'info' : 'error',
        `Mutation [${msg.payload.result.methodUsed}]: "${msg.payload.item.title}" -> ${
          msg.payload.result.success ? 'Saved' : msg.payload.result.error || 'Failed'
        }`
      );
      break;

    case 'MUTATION_FALLBACK_REQUESTED':
      // Architectural decision: prompt user before executing DOM fallback
      showFallbackPrompt(msg.payload.item.title, msg.payload.reason);
      break;

    case 'OPERATION_FINISHED':
      logEntry('info', `Completed: ${msg.payload.message}`);
      if (elLiveActionText) {
        elLiveActionText.textContent = msg.payload.message;
        elLiveActionText.style.color = msg.payload.success ? 'var(--accent-green)' : 'var(--accent-amber)';
      }
      if (msg.payload.operation === 'extraction') {
        resetExtractionUiState();
      } else {
        resetMutationUiState();
      }
      break;

    case 'LOG_ENTRY':
      logEntry(msg.payload.level, `[${msg.payload.tag}] ${msg.payload.message}`);
      if (elLiveActionText) {
        elLiveActionText.textContent = msg.payload.message;
        elLiveActionText.style.color =
          msg.payload.level === 'error'
            ? 'var(--accent-red)'
            : msg.payload.level === 'warn'
              ? 'var(--accent-amber)'
              : '#93c5fd';
      }
      if (msg.payload.level === 'error') {
        resetExtractionUiState();
        resetMutationUiState();
      }
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
  if (btnExportExcel) btnExportExcel.disabled = !hasItems;
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

btnClearLogs?.addEventListener('click', () => {
  if (elLogTerminal) elLogTerminal.innerHTML = '';
});

// ============================================================================
// EXTRACTION CONTROLS
// ============================================================================
btnStartExtract?.addEventListener('click', () => {
  const mode = (selectExtractionMode?.value || 'hybrid') as 'hybrid' | 'rpc_only' | 'dom_only';
  extractionStartTime = Date.now();
  harvestedPlaces.clear();
  updateExportButtonsState();
  if (elMetricHarvested) elMetricHarvested.textContent = '0';
  if (elMetricVelocity) elMetricVelocity.textContent = '0.0/s';
  if (elMetricEta) elMetricEta.textContent = '--:--';
  if (elProgressBar) elProgressBar.style.width = '0%';

  backgroundPort?.postMessage({
    type: 'REQUEST_START_EXTRACTION',
    payload: { mode },
  } as SidePanelToWorkerMessage);

  btnStartExtract.disabled = true;
  if (btnPauseExtract) {
    btnPauseExtract.disabled = false;
    btnPauseExtract.textContent = 'Pause';
  }
  if (btnAbortExtract) btnAbortExtract.disabled = false;
  if (elLiveActionText) {
    elLiveActionText.textContent = `Iniciando extracción (${mode})...`;
    elLiveActionText.style.color = '#93c5fd';
  }
  logEntry('info', `Dispatched extraction start command (mode: ${mode}).`);
});

btnPauseExtract?.addEventListener('click', () => {
  if (btnPauseExtract.textContent === 'Pause') {
    backgroundPort?.postMessage({ type: 'REQUEST_PAUSE_EXTRACTION' } as SidePanelToWorkerMessage);
    btnPauseExtract.textContent = 'Resume';
    if (elLiveActionText) elLiveActionText.textContent = 'Extracción pausada.';
    logEntry('warn', 'Extraction paused.');
  } else {
    backgroundPort?.postMessage({ type: 'REQUEST_RESUME_EXTRACTION' } as SidePanelToWorkerMessage);
    btnPauseExtract.textContent = 'Pause';
    if (elLiveActionText) elLiveActionText.textContent = 'Extracción reanudada.';
    logEntry('info', 'Extraction resumed.');
  }
});

btnAbortExtract?.addEventListener('click', () => {
  backgroundPort?.postMessage({ type: 'REQUEST_ABORT_EXTRACTION' } as SidePanelToWorkerMessage);
  resetExtractionUiState();
  if (elLiveActionText) {
    elLiveActionText.textContent = 'Extracción cancelada por el usuario.';
    elLiveActionText.style.color = 'var(--accent-amber)';
  }
  logEntry('error', 'Extraction aborted by user.');
});

function resetExtractionUiState(): void {
  extractionStartTime = 0;
  if (btnStartExtract) btnStartExtract.disabled = false;
  if (btnPauseExtract) {
    btnPauseExtract.disabled = true;
    btnPauseExtract.textContent = 'Pause';
  }
  if (btnAbortExtract) btnAbortExtract.disabled = true;
  if (elLiveActionText && !elLiveActionText.textContent?.includes('Error') && !elLiveActionText.textContent?.includes('No')) {
    elLiveActionText.textContent = 'Estado: Listo.';
    elLiveActionText.style.color = '#93c5fd';
  }
}

// ============================================================================
// SPATIAL EXPORT TRIGGERS
// ============================================================================
btnExportExcel?.addEventListener('click', () => {
  const items = Array.from(harvestedPlaces.values());
  if (items.length === 0) return;
  const listName = inputTargetList?.value.trim() || 'Saved Places';
  const blob = SpatialDataExporters.toExcel(items, listName);
  const fileName = `google_maps_pins_${Date.now()}.xlsx`;
  SpatialDataExporters.triggerDownload(blob, fileName);
  logEntry('info', `Exported ${items.length} pins to Excel (.xlsx) organized in columns.`);
});

btnExportGeoJson?.addEventListener('click', () => {
  const items = Array.from(harvestedPlaces.values());
  if (items.length === 0) return;
  const blob = SpatialDataExporters.toGeoJSON(items);
  const fileName = `google_maps_export_${Date.now()}.geojson`;
  SpatialDataExporters.triggerDownload(blob, fileName);
  logEntry('info', `Exported ${items.length} places to GeoJSON.`);
});

btnExportKml?.addEventListener('click', () => {
  const items = Array.from(harvestedPlaces.values());
  if (items.length === 0) return;
  const blob = SpatialDataExporters.toKML(items);
  const fileName = `google_maps_export_${Date.now()}.kml`;
  SpatialDataExporters.triggerDownload(blob, fileName);
  logEntry('info', `Exported ${items.length} places to KML 2.2.`);
});

btnExportCsv?.addEventListener('click', () => {
  const items = Array.from(harvestedPlaces.values());
  if (items.length === 0) return;
  const blob = SpatialDataExporters.toCSV(items);
  const fileName = `google_maps_export_${Date.now()}.csv`;
  SpatialDataExporters.triggerDownload(blob, fileName);
  logEntry('info', `Exported ${items.length} places to CSV.`);
});

// ============================================================================
// IMPORT & WRITE ENGINE CONTROLS
// ============================================================================
fileImportInput?.addEventListener('change', async (e) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const defaultList = inputTargetList?.value.trim() || 'Imported Places';

  try {
    const text = await file.text();
    if (file.name.endsWith('.geojson') || file.name.endsWith('.json')) {
      importedItemsQueue = SpatialDataImporters.parseGeoJSON(text, defaultList);
    } else if (file.name.endsWith('.csv')) {
      importedItemsQueue = SpatialDataImporters.parseCSV(text, defaultList);
    } else {
      throw new Error('Unsupported format. Please select a .geojson, .json, or .csv file.');
    }

    if (btnStartMutation) {
      btnStartMutation.disabled = importedItemsQueue.length === 0;
    }
    if (elMetricMutPending) {
      elMetricMutPending.textContent = String(importedItemsQueue.length);
    }

    logEntry('info', `Loaded ${importedItemsQueue.length} records from ${file.name}.`);
  } catch (err) {
    logEntry('error', `Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`);
  }
});

btnStartMutation?.addEventListener('click', () => {
  if (importedItemsQueue.length === 0) return;

  const targetList = inputTargetList?.value.trim() || 'Imported Places';
  const mode = (selectMutationMode?.value || 'rpc_first_with_dom_fallback') as
    | 'rpc_first_with_dom_fallback'
    | 'rpc_only'
    | 'dom_only';

  // Ensure all items carry current target list
  importedItemsQueue.forEach((item) => {
    item.targetListId = targetList;
    item.targetListName = targetList;
  });

  backgroundPort?.postMessage({
    type: 'REQUEST_START_MUTATION',
    payload: {
      items: importedItemsQueue,
      options: {
        mode,
        targetListId: targetList,
        targetListName: targetList,
        promptBeforeDomFallback: true,
      },
    },
  } as SidePanelToWorkerMessage);

  btnStartMutation.disabled = true;
  if (btnPauseMutation) {
    btnPauseMutation.disabled = false;
    btnPauseMutation.textContent = 'Pause';
  }
  if (btnAbortMutation) btnAbortMutation.disabled = false;

  logEntry('info', `Dispatched mutation queue of ${importedItemsQueue.length} items (mode: ${mode}).`);
});

btnPauseMutation?.addEventListener('click', () => {
  if (btnPauseMutation.textContent === 'Pause') {
    backgroundPort?.postMessage({ type: 'REQUEST_PAUSE_MUTATION' } as SidePanelToWorkerMessage);
    btnPauseMutation.textContent = 'Resume';
    logEntry('warn', 'Mutation queue paused.');
  } else {
    backgroundPort?.postMessage({ type: 'REQUEST_RESUME_MUTATION' } as SidePanelToWorkerMessage);
    btnPauseMutation.textContent = 'Pause';
    logEntry('info', 'Mutation queue resumed.');
  }
});

btnAbortMutation?.addEventListener('click', () => {
  backgroundPort?.postMessage({ type: 'REQUEST_ABORT_MUTATION' } as SidePanelToWorkerMessage);
  resetMutationUiState();
  hideFallbackPrompt();
  logEntry('error', 'Mutation queue canceled by user.');
});

function updateMutationProgressDisplay(stats: MutationProgressStats): void {
  if (elMetricMutSuccess) elMetricMutSuccess.textContent = String(stats.successCount);
  if (elMetricMutPending) elMetricMutPending.textContent = String(stats.totalItems - stats.processedCount);
  if (elMetricMutFailed) elMetricMutFailed.textContent = String(stats.failureCount);
}

function resetMutationUiState(): void {
  if (btnStartMutation) btnStartMutation.disabled = importedItemsQueue.length === 0;
  if (btnPauseMutation) {
    btnPauseMutation.disabled = true;
    btnPauseMutation.textContent = 'Pause';
  }
  if (btnAbortMutation) btnAbortMutation.disabled = true;
}

// Update active list display when target list input changes
inputTargetList?.addEventListener('input', () => {
  if (elActiveList) {
    elActiveList.textContent = inputTargetList.value.trim() || 'None selected';
  }
});

// ============================================================================
// DOM FALLBACK APPROVAL PROMPT BANNER
// ============================================================================
function showFallbackPrompt(itemTitle: string, reason: string): void {
  if (!bannerFallback || !elFallbackText) return;
  elFallbackText.textContent = `RPC rejected for "${itemTitle}" (${reason}). Execute in-page DOM click automation fallback?`;
  bannerFallback.classList.remove('hidden');
}

function hideFallbackPrompt(): void {
  if (bannerFallback) bannerFallback.classList.add('hidden');
}

btnApproveFallback?.addEventListener('click', () => {
  hideFallbackPrompt();
  backgroundPort?.postMessage({
    type: 'RESPOND_FALLBACK_APPROVAL',
    payload: { approved: true },
  } as SidePanelToWorkerMessage);
  logEntry('info', 'Approved DOM fallback execution.');
});

btnRejectFallback?.addEventListener('click', () => {
  hideFallbackPrompt();
  backgroundPort?.postMessage({
    type: 'RESPOND_FALLBACK_APPROVAL',
    payload: { approved: false },
  } as SidePanelToWorkerMessage);
  logEntry('warn', 'Declined DOM fallback execution (skipped item).');
});

// ============================================================================
// SETTINGS PERSISTENCE
// ============================================================================
btnSaveSettings?.addEventListener('click', async () => {
  const minDelay = parseInt(inputMinDelay?.value, 10) || 1200;
  const maxDelay = parseInt(inputMaxDelay?.value, 10) || 2500;
  const cooling = parseInt(inputCooling?.value, 10) || 40;

  try {
    await chrome.storage.local.set({
      GMAPS_SETTINGS: {
        minDelayMs: minDelay,
        maxDelayMs: maxDelay,
        coolingIntervalSeconds: cooling,
      },
    });
    logEntry('info', 'Settings saved to local storage.');
  } catch (err) {
    logEntry('error', `Failed to save settings: ${err}`);
  }
});

// Load settings on startup
chrome.storage?.local?.get('GMAPS_SETTINGS').then((data) => {
  if (data?.GMAPS_SETTINGS) {
    const s = data.GMAPS_SETTINGS;
    if (inputMinDelay && s.minDelayMs) inputMinDelay.value = String(s.minDelayMs);
    if (inputMaxDelay && s.maxDelayMs) inputMaxDelay.value = String(s.maxDelayMs);
    if (inputCooling && s.coolingIntervalSeconds) inputCooling.value = String(s.coolingIntervalSeconds);
  }
});
