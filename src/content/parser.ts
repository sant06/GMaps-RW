/**
 * Parser for Google Maps URLs, anchors, and internal serialized parameters.
 * Extracts high-precision pin markers (!3d/!4d), Place IDs, and Hex Feature IDs.
 */

import type { ParsedPlaceCoordinates } from '../types/places';
import { isPlausibleGeoCoordinate } from '../utils/validation';

export class GoogleMapsUrlParser {
  private static readonly PIN_COORD_STRICT = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
  private static readonly PIN_COORD_RELAXED = /!3d(-?\d+(?:\.\d+)?)(?:!4d|-?\d+.*!4d)(-?\d+(?:\.\d+)?)/;
  private static readonly VIEWPORT_COORD_REGEX = /@(-?\d+\.\d+),(-?\d+\.\d+),(\d+(?:\.\d+)?z)?/;
  private static readonly PLACE_ID_REGEX = /!(?:1s|19s)(ChIJ[a-zA-Z0-9_-]{23,})/;
  private static readonly HEX_FEATURE_ID_REGEX = /!(?:1s|2s)(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/;
  private static readonly CID_PARAM_REGEX = /[?&]cid=(\d+)/;
  private static readonly QUERY_COORD_REGEX = /[?&](?:q|ll|center)=(-?\d+\.\d+),(-?\d+\.\d+)/;

  /**
   * Decodes latitude, longitude, and identifiers from any Google Maps URL.
   * Prioritizes high-precision pin markers (!3d/!4d) over viewport camera center values (@lat,lng).
   */
  public static parse(url: string): ParsedPlaceCoordinates | null {
    if (!url) return null;

    let decodedUrl: string;
    try {
      decodedUrl = decodeURIComponent(url);
    } catch {
      decodedUrl = url;
    }

    // 0. Reject non-place URLs (Google Account avatars, sign-out redirectors, help, legal)
    if (
      decodedUrl.includes('accounts.google.') ||
      decodedUrl.includes('SignOutOptions') ||
      decodedUrl.includes('support.google.') ||
      decodedUrl.includes('policies.google.')
    ) {
      return null;
    }

    const placeId = this.extractPlaceId(decodedUrl);
    const featureId = this.extractFeatureId(decodedUrl);

    // 1. Primary Strategy: Pin coordinate extraction from !3d and !4d tokens
    const strictPinMatch = decodedUrl.match(this.PIN_COORD_STRICT);
    if (strictPinMatch) {
      const lat = parseFloat(strictPinMatch[1]);
      const lng = parseFloat(strictPinMatch[2]);
      if (isPlausibleGeoCoordinate(lat, lng)) {
        return {
          latitude: lat,
          longitude: lng,
          isHighPrecision: true,
          placeId,
          featureId,
        };
      }
    }

    const relaxedPinMatch = decodedUrl.match(this.PIN_COORD_RELAXED);
    if (relaxedPinMatch) {
      const lat = parseFloat(relaxedPinMatch[1]);
      const lng = parseFloat(relaxedPinMatch[2]);
      if (isPlausibleGeoCoordinate(lat, lng)) {
        return {
          latitude: lat,
          longitude: lng,
          isHighPrecision: true,
          placeId,
          featureId,
        };
      }
    }

    // 2. Secondary Strategy: Viewport camera fallback extraction
    // ONLY accepted if the URL explicitly denotes a place or has a known Place ID/FID,
    // preventing camera viewpoints (@lat,lng) on map overview links from being misclassified as places.
    const isPlaceUrl = decodedUrl.includes('/place/') || decodedUrl.includes('/search/') || !!placeId || !!featureId;
    const viewportMatch = decodedUrl.match(this.VIEWPORT_COORD_REGEX);
    if (viewportMatch && isPlaceUrl) {
      const lat = parseFloat(viewportMatch[1]);
      const lng = parseFloat(viewportMatch[2]);
      if (isPlausibleGeoCoordinate(lat, lng)) {
        return {
          latitude: lat,
          longitude: lng,
          isHighPrecision: false,
          placeId,
          featureId,
        };
      }
    }

    // 3. Tertiary Strategy: Explicit query parameter extraction (?q=lat,lng, ll=lat,lng, center=lat,lng)
    const queryMatch = decodedUrl.match(this.QUERY_COORD_REGEX);
    if (queryMatch) {
      const lat = parseFloat(queryMatch[1]);
      const lng = parseFloat(queryMatch[2]);
      if (isPlausibleGeoCoordinate(lat, lng)) {
        return {
          latitude: lat,
          longitude: lng,
          isHighPrecision: true,
          placeId,
          featureId,
        };
      }
    }

    return null;
  }

  public static extractPlaceId(url: string): string | undefined {
    const match = url.match(this.PLACE_ID_REGEX);
    return match ? match[1] : undefined;
  }

  public static extractFeatureId(url: string): string | undefined {
    const match = url.match(this.HEX_FEATURE_ID_REGEX);
    return match ? match[1] : undefined;
  }

  public static extractCid(url: string): string | undefined {
    const match = url.match(this.CID_PARAM_REGEX);
    return match ? match[1] : undefined;
  }
}
