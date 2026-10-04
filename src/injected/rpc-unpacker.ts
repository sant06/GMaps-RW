/**
 * Unpacker and extractor for Google Maps Batchexecute RPC payloads and ambient WIZ data.
 */

import type { AmbientAuthContext } from '../types/rpc';
import type { ScrapedPlaceRecord } from '../types/places';
import { isPlausibleGeoCoordinate, isLegitimatePlaceTitle } from '../utils/validation';
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
    const seenPlaceIds = new Set<string>();

    function traverse(node: unknown) {
      if (!node || typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);

      if (Array.isArray(node)) {
        for (const child of node) {
          traverse(child);
        }

        // Check if this array represents a place candidate (post-order: most specific entity wins)
        const candidate = BatchexecuteUnpacker.extractPlaceCandidateFromArray(node);
        if (candidate && !seenPlaceIds.has(candidate.id)) {
          seenPlaceIds.add(candidate.id);
          places.push(candidate);
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
   * Recursively collects strings within a candidate node (direct strings and sub-array strings).
   */
  private static collectStrings(node: unknown, depth = 0, bucket: string[] = []): string[] {
    if (depth > 2 || !node) return bucket;
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (trimmed) bucket.push(trimmed);
    } else if (Array.isArray(node)) {
      for (const child of node) {
        BatchexecuteUnpacker.collectStrings(child, depth + 1, bucket);
      }
    }
    return bucket;
  }

  /**
   * Recursively scans for coordinates [lat, lng], [null, null, lat, lng], E7, or coordinate objects up to depth 5.
   */
  private static findDeepCoords(node: unknown, depth = 0): { lat: number; lng: number } | null {
    if (depth > 5 || !node || typeof node !== 'object') return null;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length - 1; i++) {
        const n1 = node[i];
        const n2 = node[i + 1];
        if (typeof n1 === 'number' && typeof n2 === 'number') {
          if (isPlausibleGeoCoordinate(n1, n2)) {
            return { lat: n1, lng: n2 };
          }
          if (Math.abs(n1) > 1000 && isPlausibleGeoCoordinate(n1 / 1e7, n2 / 1e7)) {
            return { lat: n1 / 1e7, lng: n2 / 1e7 };
          }
        }
      }

      for (const child of node) {
        if (child && typeof child === 'object') {
          const found = BatchexecuteUnpacker.findDeepCoords(child, depth + 1);
          if (found) return found;
        }
      }
    } else {
      const obj = node as Record<string, unknown>;
      const objLat = typeof obj.lat === 'number' ? obj.lat : typeof obj.latitude === 'number' ? obj.latitude : undefined;
      const objLng = typeof obj.lng === 'number' ? obj.lng : typeof obj.longitude === 'number' ? obj.longitude : undefined;
      if (objLat !== undefined && objLng !== undefined && isPlausibleGeoCoordinate(objLat, objLng)) {
        return { lat: objLat, lng: objLng };
      }
    }

    return null;
  }

  /**
   * Evaluates an array structure to determine if it encodes a Google Maps place entity.
   */
  private static extractPlaceCandidateFromArray(arr: unknown[]): ScrapedPlaceRecord | null {
    if (arr.length < 2) return null;

    // Scan for coordinates in this subtree
    const coords = BatchexecuteUnpacker.findDeepCoords(arr);
    if (!coords || !isPlausibleGeoCoordinate(coords.lat, coords.lng)) {
      return null;
    }

    // Collect all strings in this subtree (depth <= 3)
    const strings = BatchexecuteUnpacker.collectStrings(arr);
    if (strings.length === 0) return null;

    let placeId: string | undefined;
    let featureId: string | undefined;
    let title: string | undefined;
    let address: string | undefined;
    let userNote: string | undefined;

    // 1. Identify Place ID (ChIJ...) and Hex Feature ID (0x...:0x...)
    for (const str of strings) {
      if (str.startsWith('ChIJ') && str.length >= 20 && !placeId) {
        placeId = str;
      } else if (/^0x[0-9a-fA-F]+:0x[0-9a-fA-F]+$/.test(str) && !featureId) {
        featureId = str;
      }
    }

    // 2. Identify Title, Address, and User Note
    for (const str of strings) {
      if (str === placeId || str === featureId) continue;

      if (isLegitimatePlaceTitle(str)) {
        if (!title) {
          title = str;
        } else if (!address && (str.includes(',') || /\d+/.test(str)) && str !== title) {
          // If title has a comma but str does not, prefer the shorter clean name as title
          if (title.includes(',') && !str.includes(',')) {
            address = title;
            title = str;
          } else {
            address = str;
          }
        } else if (!userNote && str !== title && str !== address && str.length > 2) {
          if (!str.toLowerCase().startsWith('+ not') && !str.toLowerCase().startsWith('agregar not')) {
            userNote = str;
          }
        }
      }
    }

    if (!title) return null;

    const effectiveId = placeId || featureId;
    const isDroppedPin =
      title.toLowerCase().includes('pin') ||
      title.toLowerCase().includes('marcador') ||
      title.toLowerCase().includes('dropped');

    // Every authentic place entity MUST have a Place ID (ChIJ...) or Hex Feature ID (0x...),
    // EXCEPT dropped pins/markers which are identified by their pin title.
    if (!effectiveId && !isDroppedPin) {
      return null;
    }

    const finalId = effectiveId || generateSyntheticPlaceId(title, coords.lat, coords.lng);

    return {
      id: finalId,
      title,
      url: `https://www.google.com/maps/place/?q=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`,
      latitude: coords.lat,
      longitude: coords.lng,
      isHighPrecision: true,
      placeId,
      featureId,
      address,
      userNote,
      extractedAt: new Date().toISOString(),
    };
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
