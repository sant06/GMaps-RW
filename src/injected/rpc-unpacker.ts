/**
 * Unpacker and extractor for Google Maps Batchexecute RPC payloads and ambient WIZ data.
 */

import type { AmbientAuthContext } from '../types/rpc';
import type { ScrapedPlaceRecord } from '../types/places';
import { isValidCoordinate } from '../utils/coordinates';
import { generateSyntheticPlaceId } from '../utils/crypto';

export interface UnpackedRpcPayload {
  rpcId?: string;
  rawJson: unknown;
  extractedPlaces: ScrapedPlaceRecord[];
}

export class BatchexecuteUnpacker {
  private static readonly XSSI_PREFIX_REGEX = /^\)]\}'\s*\n?/;

  /**
   * Strips anti-XSSI security prefix and parses nested Google JSON envelopes using balanced-token extraction.
   */
  public static unpack(rawBody: string): UnpackedRpcPayload[] {
    if (!rawBody || typeof rawBody !== 'string') return [];

    const cleaned = rawBody.replace(this.XSSI_PREFIX_REGEX, '').trim();
    if (!cleaned) return [];

    const results: UnpackedRpcPayload[] = [];

    // Strategy 1: Balanced delimiter scan for batchexecute envelopes [["wrb.fr", ...]]
    let searchIdx = 0;
    while (searchIdx < cleaned.length) {
      const startIdx = cleaned.indexOf('[["wrb.fr"', searchIdx);
      if (startIdx === -1) break;

      let depth = 0;
      let inString = false;
      let escape = false;
      let endIdx = -1;

      for (let i = startIdx; i < cleaned.length; i++) {
        const char = cleaned[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === '[') depth++;
          else if (char === ']') {
            depth--;
            if (depth === 0) {
              endIdx = i + 1;
              break;
            }
          }
        }
      }

      if (endIdx !== -1) {
        const jsonStr = cleaned.slice(startIdx, endIdx);
        try {
          const parsedEnvelope = JSON.parse(jsonStr) as [string, string, string, ...unknown[]][];
          for (const item of parsedEnvelope) {
            if (Array.isArray(item) && item[0] === 'wrb.fr') {
              const currentRpcId = item[1];
              const innerPayload = item[2];
              let innerJson = innerPayload;
              if (typeof innerPayload === 'string') {
                try {
                  innerJson = JSON.parse(innerPayload);
                } catch {
                  // Keep as string
                }
              }
              const places = this.deepExtractPlaces(innerJson);
              results.push({
                rpcId: currentRpcId,
                rawJson: innerJson,
                extractedPlaces: places,
              });
            }
          }
        } catch {
          // Ignore chunk parse error
        }
        searchIdx = endIdx;
      } else {
        searchIdx = startIdx + 10;
      }
    }

    if (results.length > 0) {
      return results;
    }

    // Strategy 2: Direct top-level JSON array (e.g. /maps/preview/ or tbm=map)
    try {
      const directJson = JSON.parse(cleaned);
      const places = this.deepExtractPlaces(directJson);
      results.push({
        rawJson: directJson,
        extractedPlaces: places,
      });
    } catch {
      // Body is not top-level valid JSON
    }

    return results;
  }

  /**
   * Scans an arbitrary nested array structure to locate place records, coordinates, and notes.
   */
  public static deepExtractPlaces(data: unknown): ScrapedPlaceRecord[] {
    const places: ScrapedPlaceRecord[] = [];
    const visited = new Set<unknown>();

    function traverse(node: unknown) {
      if (!node || typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);

      if (Array.isArray(node)) {
        // Check if this array represents a place candidate
        const candidate = BatchexecuteUnpacker.extractPlaceCandidateFromArray(node);
        if (candidate) {
          places.push(candidate);
        }
        for (const child of node) {
          traverse(child);
        }
      } else {
        for (const key of Object.keys(node)) {
          traverse((node as Record<string, unknown>)[key]);
        }
      }
    }

    traverse(data);
    return places;
  }

  /**
   * Evaluates an array structure to determine if it encodes a Google Maps place entity.
   */
  private static extractPlaceCandidateFromArray(arr: unknown[]): ScrapedPlaceRecord | null {
    if (arr.length < 2) return null;

    let placeId: string | undefined;
    let title: string | undefined;
    let lat: number | undefined;
    let lng: number | undefined;
    let userNote: string | undefined;
    let address: string | undefined;

    // Scan array elements for typical Google Maps place markers
    for (const elem of arr) {
      if (typeof elem === 'string') {
        // Place ID marker: ChIJ... (23-30 chars)
        if (elem.startsWith('ChIJ') && elem.length >= 20 && !placeId) {
          placeId = elem;
        }
        // Google Hex FID marker: 0x...:0x...
        if (/^0x[0-9a-fA-F]+:0x[0-9a-fA-F]+$/.test(elem) && !placeId) {
          placeId = elem;
        }
      } else if (Array.isArray(elem) && elem.length >= 2) {
        // Scan for adjacent coordinates in array (supports [lat, lng], [null, null, lat, lng], [lat, lng, zoom])
        for (let i = 0; i < elem.length - 1; i++) {
          const n1 = elem[i];
          const n2 = elem[i + 1];
          if (typeof n1 === 'number' && typeof n2 === 'number') {
            if (isValidCoordinate(n1, n2) && (Math.abs(n1) > 0.0001 || Math.abs(n2) > 0.0001) && lat === undefined) {
              lat = n1;
              lng = n2;
              break;
            } else if (isValidCoordinate(n1 / 1e7, n2 / 1e7) && Math.abs(n1) > 1000 && lat === undefined) {
              lat = n1 / 1e7;
              lng = n2 / 1e7;
              break;
            }
          }
        }
      } else if (elem && typeof elem === 'object' && !Array.isArray(elem)) {
        // Support { lat, lng } or { latitude, longitude } objects
        const obj = elem as Record<string, unknown>;
        const objLat = typeof obj.lat === 'number' ? obj.lat : typeof obj.latitude === 'number' ? obj.latitude : undefined;
        const objLng = typeof obj.lng === 'number' ? obj.lng : typeof obj.longitude === 'number' ? obj.longitude : undefined;
        if (objLat !== undefined && objLng !== undefined && isValidCoordinate(objLat, objLng) && lat === undefined) {
          lat = objLat;
          lng = objLng;
        }
      }
    }

    // Look for place title (string of reasonable length not matching IDs or URLs)
    for (const elem of arr) {
      if (
        typeof elem === 'string' &&
        elem.length > 1 &&
        elem.length < 120 &&
        !elem.startsWith('ChIJ') &&
        !elem.startsWith('http') &&
        !elem.startsWith('0x') &&
        !title
      ) {
        title = elem;
      }
      if (typeof elem === 'string' && elem.length > 0 && elem !== title && !userNote) {
        if (elem.includes(',') || /\d+/.test(elem)) {
          address = elem;
        }
      }
    }

    if (title && lat !== undefined && lng !== undefined) {
      const id = placeId || generateSyntheticPlaceId(title, lat, lng);
      return {
        id,
        title,
        url: `https://www.google.com/maps/place/?q=${lat.toFixed(6)},${lng.toFixed(6)}`,
        latitude: lat,
        longitude: lng,
        isHighPrecision: true,
        address,
        userNote,
        placeId,
        extractedAt: new Date().toISOString(),
      };
    }

    return null;
  }

  /**
   * Extracts ambient WIZ tokens (CSRF at token, build label, session ID) from the host page.
   */
  public static extractAmbientWizData(): AmbientAuthContext {
    const wizData = (window as unknown as { WIZ_global_data?: Record<string, unknown> }).WIZ_global_data || {};
    const win = window as unknown as Record<string, unknown>;

    const atToken = (wizData.SNlM0e as string) || (win._at as string) || undefined;
    const fSid = (wizData.FdrFJe as string) || undefined;
    const buildLabel = (wizData.cfb2h as string) || undefined;
    const userEmail = (wizData.oP02Se as string) || undefined;
    const gaiaId = (wizData.oID9Rd as string) || undefined;

    return {
      atToken,
      fSid,
      buildLabel,
      userEmail,
      gaiaId,
      detectedAt: Date.now(),
    };
  }
}
