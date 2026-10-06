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

/**
 * Merges two scraped place records that share identical geographic coordinates,
 * preferring cleaner short place titles over long addresses, and preserving notes and IDs.
 */
export function mergePlaceRecords(existing: ScrapedPlaceRecord, incoming: ScrapedPlaceRecord): ScrapedPlaceRecord {
  let bestTitle = existing.title;
  let bestAddress = existing.address || incoming.address;

  const existingHasComma = existing.title.includes(',');
  const incomingHasComma = incoming.title.includes(',');

  // If one title is raw coordinates e.g. "(-34.59, -58.44)" and the other has a real name:
  const isExistingCoord = /^\(?-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+\)?$/.test(existing.title);
  const isIncomingCoord = /^\(?-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+\)?$/.test(incoming.title);

  if (isExistingCoord && !isIncomingCoord) {
    bestTitle = incoming.title;
    bestAddress = incoming.address || existing.address;
  } else if (!isExistingCoord && isIncomingCoord) {
    // Keep existing non-coordinate title
  } else if (existingHasComma && !incomingHasComma && incoming.title.length >= 2) {
    // Incoming title is cleaner (no comma, not an address) while existing title is an address
    bestTitle = incoming.title;
    if (!bestAddress || bestAddress === incoming.title) {
      bestAddress = existing.title;
    }
  } else if (!existingHasComma && incomingHasComma) {
    if (!bestAddress || bestAddress === existing.title) {
      bestAddress = incoming.title;
    }
  }

  return {
    ...existing,
    id: existing.placeId ? existing.id : incoming.placeId ? incoming.id : existing.id,
    title: bestTitle,
    address: bestAddress,
    userNote: existing.userNote || incoming.userNote,
    placeId: existing.placeId || incoming.placeId,
    featureId: existing.featureId || incoming.featureId,
    cid: existing.cid || incoming.cid,
    listTitle: existing.listTitle || incoming.listTitle,
    category: existing.category || incoming.category,
    isHighPrecision: existing.isHighPrecision || incoming.isHighPrecision,
  };
}

export class BatchexecuteUnpacker {
  private static readonly XSSI_PREFIX_REGEX = /^\)]\}'\s*\n?/;

  /**
   * Robustly unpacks Batchexecute, streaming RPC, and preview JSON payloads.
   * Scans for all top-level JSON structures ([...] and {...}) across line-delimited or chunked streams.
   */
  public static unpack(rawBody: string): UnpackedRpcPayload[] {
    if (!rawBody || typeof rawBody !== 'string') return [];

    const cleaned = rawBody.replace(this.XSSI_PREFIX_REGEX, '').trim();
    if (!cleaned) return [];

    const results: UnpackedRpcPayload[] = [];

    // Scan for all top-level JSON structures ([...] or {...}) in the payload
    let i = 0;
    while (i < cleaned.length) {
      const nextArr = cleaned.indexOf('[', i);
      const nextObj = cleaned.indexOf('{', i);

      let startIdx = -1;
      let openChar = '[';
      let closeChar = ']';

      if (nextArr !== -1 && (nextObj === -1 || nextArr < nextObj)) {
        startIdx = nextArr;
        openChar = '[';
        closeChar = ']';
      } else if (nextObj !== -1) {
        startIdx = nextObj;
        openChar = '{';
        closeChar = '}';
      } else {
        break; // No more JSON structures
      }

      let depth = 0;
      let inString = false;
      let escape = false;
      let endIdx = -1;

      for (let j = startIdx; j < cleaned.length; j++) {
        const char = cleaned[j];
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
          if (char === openChar) depth++;
          else if (char === closeChar) {
            depth--;
            if (depth === 0) {
              endIdx = j + 1;
              break;
            }
          }
        }
      }

      if (endIdx !== -1) {
        const jsonStr = cleaned.slice(startIdx, endIdx);
        try {
          const parsed = JSON.parse(jsonStr);

          // Check if parsed structure is a wrb.fr batchexecute envelope
          if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0]) && parsed[0][0] === 'wrb.fr') {
            for (const item of parsed) {
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
          } else {
            // Direct JSON chunk (e.g. [[null, ...]] or /maps/preview/ or list chunk)
            const places = this.deepExtractPlaces(parsed);
            results.push({
              rawJson: parsed,
              extractedPlaces: places,
            });
          }
        } catch {
          // Ignore chunk parse error
        }
        i = endIdx;
      } else {
        i = startIdx + 1;
      }
    }

    return results;
  }

  /**
   * Scans an arbitrary nested array structure to locate place records, coordinates, and notes.
   * Spatially deduplicates places to ensure each geographic location is uniquely represented.
   */
  public static deepExtractPlaces(data: unknown): ScrapedPlaceRecord[] {
    const coordMap = new Map<string, ScrapedPlaceRecord>();
    const visited = new Set<unknown>();

    function getCoordKey(lat: number, lng: number): string {
      return `${lat.toFixed(5)},${lng.toFixed(5)}`;
    }

    function traverse(node: unknown) {
      if (!node) return;

      // Unpack stringified Batchexecute chunks or JSON arrays (common in APP_INITIALIZATION_STATE and _pageData)
      if (typeof node === 'string') {
        const trimmed = node.trim();
        if (trimmed.startsWith(')]}\'') || (trimmed.startsWith('[[') && trimmed.endsWith(']]'))) {
          try {
            const unpacked = BatchexecuteUnpacker.unpack(trimmed);
            for (const item of unpacked) {
              traverse(item.rawJson);
            }
          } catch {
            // Ignore parse errors
          }
        } else if (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 20) {
          try {
            const parsed = JSON.parse(trimmed);
            traverse(parsed);
          } catch {
            // Ignore parse errors
          }
        }
        return;
      }

      if (typeof node !== 'object' || visited.has(node)) return;
      visited.add(node);

      if (Array.isArray(node)) {
        for (const child of node) {
          traverse(child);
        }

        const candidate = BatchexecuteUnpacker.extractPlaceCandidateFromArray(node);
        if (candidate) {
          const coordKey = getCoordKey(candidate.latitude, candidate.longitude);
          const existing = coordMap.get(coordKey);
          if (existing) {
            const merged = mergePlaceRecords(existing, candidate);
            coordMap.set(coordKey, merged);
          } else {
            coordMap.set(coordKey, candidate);
          }
        }
      } else {
        for (const key of Object.keys(node)) {
          traverse((node as Record<string, unknown>)[key]);
        }
      }
    }

    traverse(data);
    return Array.from(coordMap.values());
  }

  /**
   * Recursively collects strings within a candidate node (direct strings and sub-array strings).
   */
  private static collectStrings(node: unknown, depth = 0, bucket: string[] = []): string[] {
    if (depth > 4 || !node) return bucket;
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
    if (depth > 6 || !node || typeof node !== 'object') return null;

    if (Array.isArray(node)) {
      // 1. Priority A: Canonical Google Maps protobuf coordinate array [null, null, lat, lng]
      if (
        node.length >= 4 &&
        (node[0] === null || node[0] === undefined) &&
        (node[1] === null || node[1] === undefined) &&
        typeof node[2] === 'number' &&
        typeof node[3] === 'number'
      ) {
        if (isPlausibleGeoCoordinate(node[2], node[3])) {
          return { lat: node[2], lng: node[3] };
        }
        if (Math.abs(node[2]) > 1000 && isPlausibleGeoCoordinate(node[2] / 1e7, node[3] / 1e7)) {
          return { lat: node[2] / 1e7, lng: node[3] / 1e7 };
        }
      }

      // Check immediate child arrays first for canonical [null, null, lat, lng] pin markers
      for (const child of node) {
        if (child && Array.isArray(child)) {
          if (
            child.length >= 4 &&
            (child[0] === null || child[0] === undefined) &&
            (child[1] === null || child[1] === undefined) &&
            typeof child[2] === 'number' &&
            typeof child[3] === 'number'
          ) {
            if (isPlausibleGeoCoordinate(child[2], child[3])) {
              return { lat: child[2], lng: child[3] };
            }
            if (Math.abs(child[2]) > 1000 && isPlausibleGeoCoordinate(child[2] / 1e7, child[3] / 1e7)) {
              return { lat: child[2] / 1e7, lng: child[3] / 1e7 };
            }
          }
        }
      }

      // 2. Priority B: Exact 2-element coordinate tuple [lat, lng] or [latE7, lngE7]
      if (node.length === 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
        const n1 = node[0];
        const n2 = node[1];
        if (isPlausibleGeoCoordinate(n1, n2)) {
          return { lat: n1, lng: n2 };
        }
        if (Math.abs(n1) > 1000 && isPlausibleGeoCoordinate(n1 / 1e7, n2 / 1e7)) {
          return { lat: n1 / 1e7, lng: n2 / 1e7 };
        }
      }

      // 3. Priority C: Check children recursively
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

    // Reject list container arrays that describe lists rather than single places
    const directStrings = arr.filter((x): x is string => typeof x === 'string');
    const isListMetadata = directStrings.some(
      (s) =>
        /\b\d+\s*(?:sitios?|places?|lugares?|items?|elementos?)\b/i.test(s) ||
        /^(?:compartida|privada|shared|private|pública|public)$/i.test(s)
    );
    if (isListMetadata) return null;

    // Check if this array is a list collection containing multiple distinct child place entities.
    // In a collection array, multiple child arrays each contain their own independent place title.
    let childTitleCount = 0;
    const seenTitles = new Set<string>();
    for (const item of arr) {
      if (Array.isArray(item)) {
        const itemStrings = BatchexecuteUnpacker.collectStrings(item, 0, []);
        const validTitle = itemStrings.find(
          (s) => isLegitimatePlaceTitle(s) && !s.includes('||') && !s.toLowerCase().startsWith('http')
        );
        if (validTitle && !seenTitles.has(validTitle.toLowerCase())) {
          seenTitles.add(validTitle.toLowerCase());
          childTitleCount++;
          if (childTitleCount >= 2) {
            return null; // This array contains multiple distinct place entities (it is a collection)
          }
        }
      }
    }

    // Scan for coordinates in this subtree
    const coords = BatchexecuteUnpacker.findDeepCoords(arr);
    if (!coords || !isPlausibleGeoCoordinate(coords.lat, coords.lng)) {
      return null;
    }

    // Collect all strings in this subtree (depth <= 4)
    const strings = BatchexecuteUnpacker.collectStrings(arr);
    if (strings.length === 0) return null;

    // Reject pegman easter egg skins / assets
    if (
      strings.some(
        (s) =>
          s.includes('/tactile/') ||
          s.toLowerCase().includes('pegman') ||
          /^\d{4}-\d{2}-\d{2}T/.test(s)
      )
    ) {
      return null;
    }

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
        } else if (!address && str !== title) {
          const titleIsCoord =
            /^\(?-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+\)?$/.test(title) ||
            /^\d{1,2}°\d{1,2}'[\d\.]+"?[NS]\s+\d{1,3}°\d{1,2}'[\d\.]+"?[EW]$/i.test(title);

          if (!titleIsCoord && title.includes(',') && !str.includes(',')) {
            address = title;
            title = str;
          } else {
            address = str;
          }
        } else if (!userNote && str !== title && str !== address && str.length >= 3) {
          const isInternalToken =
            str.includes('||') ||
            str.includes('IMAGE_ALLEYCAT') ||
            str.includes('GEO_PHOTO') ||
            str.toLowerCase().startsWith('http') ||
            (/^[a-zA-Z0-9_\-\|\=]{15,}$/.test(str) && !str.includes(' '));

          if (!isInternalToken && !str.toLowerCase().startsWith('+ not') && !str.toLowerCase().startsWith('agregar not')) {
            userNote = str;
          }
        }
      }
    }

    if (!title) return null;

    const effectiveId = placeId || featureId;
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
