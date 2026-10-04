/**
 * Client-side parser for GeoJSON and CSV spatial data ingestion.
 * Normalizes input files into typed MutationItemPayload records for the Write Engine.
 */

import type { MutationItemPayload } from '../types/places';
import { isValidCoordinate } from '../utils/coordinates';

export class SpatialDataImporters {
  /**
   * Parses an RFC 7946 GeoJSON FeatureCollection text into MutationItemPayload items.
   */
  public static parseGeoJSON(
    jsonText: string,
    defaultListId: string,
    defaultListName?: string
  ): MutationItemPayload[] {
    const data = JSON.parse(jsonText);
    if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('Invalid GeoJSON: Root must be a FeatureCollection.');
    }

    const items: MutationItemPayload[] = [];

    for (const feature of data.features) {
      if (!feature.geometry || feature.geometry.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) {
        continue;
      }

      const [lng, lat] = feature.geometry.coordinates;
      if (!isValidCoordinate(lat, lng)) continue;

      const props = feature.properties || {};
      const title = props.title || props.name || `Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

      items.push({
        title: String(title).trim(),
        latitude: lat,
        longitude: lng,
        placeId: props.placeId || props.place_id || undefined,
        address: props.address || undefined,
        userNote: props.userNote || props.note || props.description || undefined,
        targetListId: props.listId || defaultListId,
        targetListName: props.listTitle || defaultListName || defaultListId,
      });
    }

    return items;
  }

  /**
   * Parses an RFC 4180 CSV document into MutationItemPayload items.
   */
  public static parseCSV(
    csvText: string,
    defaultListId: string,
    defaultListName?: string
  ): MutationItemPayload[] {
    const rows = this.parseCsvRows(csvText);
    if (rows.length < 2) {
      throw new Error('CSV file must contain a header row and at least one data row.');
    }

    const header = rows[0].map((h) => h.toLowerCase().trim());
    const titleIdx = header.findIndex((h) => ['title', 'name', 'place_name', 'spot'].includes(h));
    const latIdx = header.findIndex((h) => ['latitude', 'lat', 'y'].includes(h));
    const lngIdx = header.findIndex((h) => ['longitude', 'lng', 'lon', 'x'].includes(h));
    const noteIdx = header.findIndex((h) => ['user_note', 'note', 'notes', 'description', 'comment'].includes(h));
    const addrIdx = header.findIndex((h) => ['address', 'formatted_address'].includes(h));
    const placeIdIdx = header.findIndex((h) => ['place_id', 'placeid', 'cid'].includes(h));
    const listIdx = header.findIndex((h) => ['list_title', 'list_id', 'list'].includes(h));

    if (latIdx === -1 || lngIdx === -1) {
      throw new Error('CSV must contain Latitude (or Lat) and Longitude (or Lng) columns.');
    }

    const items: MutationItemPayload[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0 || (row.length === 1 && !row[0])) continue;

      const lat = parseFloat(row[latIdx]);
      const lng = parseFloat(row[lngIdx]);
      if (!isValidCoordinate(lat, lng)) continue;

      const title = titleIdx !== -1 && row[titleIdx] ? row[titleIdx] : `Place (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      const note = noteIdx !== -1 && row[noteIdx] ? row[noteIdx] : undefined;
      const addr = addrIdx !== -1 && row[addrIdx] ? row[addrIdx] : undefined;
      const pid = placeIdIdx !== -1 && row[placeIdIdx] ? row[placeIdIdx] : undefined;
      const targetList = listIdx !== -1 && row[listIdx] ? row[listIdx] : defaultListId;

      items.push({
        title: title.trim(),
        latitude: lat,
        longitude: lng,
        placeId: pid,
        address: addr,
        userNote: note,
        targetListId: targetList,
        targetListName: defaultListName || targetList,
      });
    }

    return items;
  }

  /**
   * RFC 4180 compliant CSV line tokenizer supporting escaped quotes and embedded commas.
   */
  private static parseCsvRows(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentCell += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentRow.push(currentCell);
        currentCell = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentRow.push(currentCell);
        currentCell = '';
        if (currentRow.length > 0) {
          rows.push(currentRow);
          currentRow = [];
        }
      } else {
        currentCell += char;
      }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell);
      rows.push(currentRow);
    }

    return rows;
  }
}
