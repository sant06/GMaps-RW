/**
 * Definitions for Google Maps internal Batchexecute RPC serialization,
 * session CSRF/xsrf tokens, and mutation payload structures.
 */

export interface AmbientAuthContext {
  atToken?: string; // Google CSRF / xsrf token (window._at or window.WIZ_global_data?.SNlM0e)
  fSid?: string; // Session ID from window.WIZ_global_data?.FdrFJe
  buildLabel?: string; // Build label from window.WIZ_global_data?.cfb2h
  userEmail?: string;
  gaiaId?: string;
  detectedAt: number;
}

export interface BatchexecuteEnvelope {
  rpcId: string;
  payloadJson: string; // JSON.stringify(innerArgs)
  correlationId?: string;
}

export interface BatchexecuteReplayRequest {
  endpointUrl: string;
  rpcId: string;
  innerPayload: unknown[];
  atToken?: string;
}

export interface BatchexecuteReplayResponse {
  success: boolean;
  httpStatus: number;
  rpcId: string;
  extractedResult?: unknown;
  rawText?: string;
  error?: string;
}

/**
 * Well-known Google Maps internal RPC IDs:
 * - List extraction & place reading
 * - Custom list mutations & place bookmarking
 */
export const GMAPS_RPC_IDS = {
  FETCH_SAVED_LISTS: 'o02sFe',
  FETCH_LIST_ITEMS: 'd2kYSc',
  CREATE_CUSTOM_LIST: 'mD07Re',
  SAVE_PLACE_TO_LIST: 'yZ1dGc',
  REMOVE_PLACE_FROM_LIST: 'O2yS9b',
  UPDATE_PLACE_NOTE: 'P01qQe',
  FETCH_PLACE_DETAILS: 'e39w7c',
} as const;

export type GmapsRpcId = typeof GMAPS_RPC_IDS[keyof typeof GMAPS_RPC_IDS] | string;
