/**
 * Domain data models for Google Maps places, lists, notes, and spatial export formats.
 */

export interface ParsedPlaceCoordinates {
  latitude: number;
  longitude: number;
  isHighPrecision: boolean;
  placeId?: string;
  featureId?: string;
}

export type ListCategoryType = 'favorites' | 'starred' | 'want_to_go' | 'travel_plans' | 'custom';

export interface GoogleMapsListSummary {
  listId: string;
  title: string;
  itemCount?: number;
  listType: ListCategoryType;
  ownerName?: string;
  isCollaborative?: boolean;
  iconName?: string;
  lastUpdated?: string;
}

export interface ScrapedPlaceRecord {
  id: string; // ChIJ PlaceId, 0x Hex FID, or synthetic fallback
  title: string;
  url: string;
  latitude: number;
  longitude: number;
  isHighPrecision: boolean;
  address?: string;
  category?: string;
  userNote?: string;
  listId?: string;
  listTitle?: string;
  placeId?: string; // Standard ChIJ...
  featureId?: string; // Hex 0x...:0x...
  isClosed?: boolean;
  extractedAt: string; // ISO 8601
}

// Ingestion payload for Write Engine
export interface MutationItemPayload {
  title: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  featureId?: string;
  address?: string;
  userNote?: string;
  targetListId: string;
  targetListName?: string;
  customMetadata?: Record<string, unknown>;
}

export interface MutationResult {
  success: boolean;
  itemTitle: string;
  targetListId: string;
  methodUsed: 'rpc' | 'dom_fallback' | 'skipped';
  error?: string;
  rpcExecutionTimeMs?: number;
  timestamp: number;
}

// ============================================================================
// SPATIAL EXPORT / IMPORT FORMATS (RFC 7946 GeoJSON, KML 2.2, RFC 4180 CSV)
// ============================================================================

export interface GeoJSONPointGeometry {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude] as per RFC 7946
}

export interface GeoJSONPlaceProperties {
  id: string;
  title: string;
  url: string;
  address: string | null;
  category: string | null;
  userNote: string | null;
  listId: string | null;
  listTitle: string | null;
  placeId: string | null;
  featureId: string | null;
  isHighPrecision: boolean;
  isClosed: boolean;
  exportedAt: string;
  [key: string]: unknown;
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONPointGeometry;
  properties: GeoJSONPlaceProperties;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  name?: string;
  features: GeoJSONFeature[];
}

export interface CsvPlaceRow {
  Title: string;
  Latitude: number | string;
  Longitude: number | string;
  Place_ID: string;
  Address: string;
  Category: string;
  User_Note: string;
  List_Title: string;
  Source_URL: string;
  Is_High_Precision: boolean | string;
  Exported_At: string;
}
