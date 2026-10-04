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
   * Strips anti-XSSI security prefix and parses nested Google JSON envelopes.
   */
  public static unpack(rawBody: string): UnpackedRpcPayload[] {
    if (!rawBody || typeof rawBody !== 'string') return [];

    const cleaned = rawBody.replace(this.XSSI_PREFIX_REGEX, '').trim();
    if (!cleaned) return [];

    const results: UnpackedRpcPayload[] = [];

    // Attempt 1: Standard line-chunked batchexecute format
    // Format: \n<chunk-byte-length>\n[["wrb.fr", "rpcId", "[...json-string...]", ...]]
    const chunkRegex = /\[\["wrb\.fr",\s*"([^"]+)",\s*(".*?"|null|\[.*?\])/g;
    let match: RegExpExecArray | null;

    while ((match = chunkRegex.exec(cleaned)) !== null) {
      try {
        // Attempt to parse the full envelope
        const envelopeMatch = cleaned.slice(match.index).match(/^(\[\["wrb\.fr".*?\]\])/);
        if (envelopeMatch) {
          const parsedEnvelope = JSON.parse(envelopeMatch[1]) as [string, string, string, ...unknown[]][];
          for (const item of parsedEnvelope) {
            if (item[0] === 'wrb.fr') {
              const currentRpcId = item[1];
              const innerPayloadString = item[2];
              if (typeof innerPayloadString === 'string') {
                try {
                  const innerJson = JSON.parse(innerPayloadString);
                  const places = this.deepExtractPlaces(innerJson);
                  results.push({
                    rpcId: currentRpcId,
                    rawJson: innerJson,
                    extractedPlaces: places,
                  });
                } catch {
                  // Ignore JSON parse error of inner payload
                }
              }
            }
          }
        }
      } catch {
        // Continue parsing subsequent matches
      }
    }

    if (results.length > 0) {
      return results;
    }

    // Attempt 2: Direct top-level JSON array (e.g. /maps/preview/ or tbm=map)
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
    if (arr.length < 3) return null;

    let placeId: string | undefined;
    let title: string | undefined;
    let lat: number | undefined;
    let lng: number | undefined;
    let userNote: string | undefined;
    let address: string | undefined;

    // Scan array elements for typical Google Maps place markers
    for (const elem of arr) {
      if (typeof elem === 'string') {
        // Place ID marker: ChIJ... (27 characters standard)
        if (elem.startsWith('ChIJ') && elem.length >= 25 && !placeId) {
          placeId = elem;
        }
        // Google Hex FID marker: 0x...:0x...
        if (/^0x[0-9a-fA-F]+:0x[0-9a-fA-F]+$/.test(elem) && !placeId) {
          placeId = elem;
        }
      } else if (Array.isArray(elem) && elem.length === 2) {
        // Coordinate pair: [lat, lng] or [latE7, lngE7]
        const [n1, n2] = elem;
        if (typeof n1 === 'number' && typeof n2 === 'number') {
          // Floating point coordinates
          if (isValidCoordinate(n1, n2) && lat === undefined) {
            lat = n1;
            lng = n2;
          }
          // E7 integer coordinates
          else if (isValidCoordinate(n1 / 1e7, n2 / 1e7) && lat === undefined) {
            lat = n1 / 1e7;
            lng = n2 / 1e7;
          }
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
      // Check for note field (often nested or string tagged with custom note signatures)
      if (typeof elem === 'string' && elem.length > 0 && elem !== title && !userNote) {
        // Potential address or note
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

    // SNlM0e is Google's internal CSRF / 'at' token key
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
