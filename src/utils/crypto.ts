/**
 * Cryptographic utilities for cross-world nonce validation and synthetic ID generation.
 */

export function generateBridgeNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments lacking crypto.randomUUID
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateCorrelationId(prefix = 'rpc'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Creates a deterministic unique identifier for places that lack a native Place ID.
 */
export function generateSyntheticPlaceId(title: string, lat: number, lng: number): string {
  const cleanTitle = title.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
  const latStr = lat.toFixed(6);
  const lngStr = lng.toFixed(6);
  return `synthetic_${cleanTitle}_${latStr}_${lngStr}`;
}
