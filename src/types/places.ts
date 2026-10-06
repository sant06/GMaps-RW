/**
 * Domain data models for Google Maps places, lists, notes, and spatial export formats.
 * Captures comprehensive place attributes for deep auditing and tabular export.
 */

export interface ParsedPlaceCoordinates {
  latitude: number;
  longitude: number;
  isHighPrecision: boolean;
  placeId?: string;
  featureId?: string;
  cid?: string;
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

export type OperationalStatus = 'Operational' | 'Permanently closed' | 'Temporarily closed' | 'Unknown';

export interface ScrapedPlaceRecord {
  id: string; // ChIJ PlaceId, 0x Hex FID, or synthetic fallback
  title: string;
  url: string;
  latitude: number;
  longitude: number;
  isHighPrecision: boolean;
  precisionType?: 'High-Precision Pin (!3d/!4d)' | 'Viewport Camera (@lat,lng)';
  placeId?: string; // Standard ChIJ...
  featureId?: string; // Hex 0x...:0x...
  cid?: string; // Numeric Customer ID
  listId?: string;
  listTitle?: string;
  listType?: ListCategoryType;
  userNote?: string;
  address?: string;
  category?: string;
  phoneNumber?: string;
  websiteUrl?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: string;
  operationalStatus?: OperationalStatus;
  isClosed?: boolean;
  dateAddedToList?: string; // ISO 8601 or formatted date when user saved the place
  extractedAt: string; // ISO 8601 extraction timestamp
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
// EXCEL (.XLSX) EXPORT STRUCTURE
// ============================================================================

export interface ExcelPlaceRow {
  'Pin / Place Title': string;
  'Latitude': number;
  'Longitude': number;
  'Coordinates (Lat, Lng)': string;
  'Precision Tier': string;
  'Google Place ID': string;
  'Hex Feature ID': string;
  'CID Number': string;
  'List Name': string;
  'List ID': string;
  'List Type': string;
  'Personal User Note': string;
  'Full Address': string;
  'Place Category': string;
  'Phone Number': string;
  'Website URL': string;
  'Rating Score': string | number;
  'Review Count': string | number;
  'Price Level': string;
  'Operational Status': string;
  'Date Added to List': string;
  'Extraction Timestamp': string;
  'Google Maps URL': string;
  'Direct Search Query URL': string;
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
  cid: string | null;
  isHighPrecision: boolean;
  operationalStatus: string;
  dateAddedToList: string | null;
  extractedAt: string;
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
  Coordinates: string;
  Place_ID: string;
  Feature_ID: string;
  CID: string;
  List_Title: string;
  List_ID: string;
  User_Note: string;
  Address: string;
  Category: string;
  Phone_Number: string;
  Website_URL: string;
  Rating: string | number;
  Review_Count: string | number;
  Price_Level: string;
  Operational_Status: string;
  Date_Added_To_List: string;
  Source_URL: string;
  Precision_Type: string;
  Extracted_At: string;
}

// ============================================================================
// RAW DIAGNOSTIC AUDIT LOG STRUCTURES
// ============================================================================

export interface RawRpcLogEntry {
  timestamp: string;
  endpoint: string;
  method: string;
  rpcId?: string;
  rawBodyLength: number;
  rawBodySnippet: string;
  extractedPlacesCount: number;
  extractedPlacesSummary: Array<{ id: string; title: string; lat: number; lng: number }>;
}

export interface RawSpatialDedupLogEntry {
  timestamp: string;
  keptTitle: string;
  mergedTitle: string;
  distanceMeters: number;
  keptCoordinates: string;
  mergedCoordinates: string;
  reason: string;
}

export interface RawDomCardSnapshot {
  timestamp: string;
  cardIndex: number;
  rawText: string;
  dataItemId?: string;
  jsdata?: string;
  dataLat?: string;
  dataLng?: string;
  childHref?: string;
}

export interface RawDiagnosticDump {
  dumpGeneratedAt: string;
  activeUrl: string;
  currentListTitle: string | null;
  totalHarvestedPlaces: number;
  rawRpcCount: number;
  rawRpcEntries: RawRpcLogEntry[];
  spatialDedupLog: RawSpatialDedupLogEntry[];
  domCardSnapshots: RawDomCardSnapshot[];
  harvestedPlaces: ScrapedPlaceRecord[];
  auditLogs?: Array<{ timestamp: number | string; level: string; tag: string; message: string }>;
}
