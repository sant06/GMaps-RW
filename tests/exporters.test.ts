import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { SpatialDataExporters } from '../src/sidepanel/exporters';
import type { ScrapedPlaceRecord } from '../src/types/places';

describe('SpatialDataExporters - Excel (.xlsx)', () => {
  const mockPlaces: ScrapedPlaceRecord[] = [
    {
      id: 'ChIJLU7jZClu5kcR4PcOOO6p3I0',
      title: 'Eiffel Tower',
      url: 'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813',
      latitude: 48.8583701,
      longitude: 2.2944813,
      isHighPrecision: true,
      placeId: 'ChIJLU7jZClu5kcR4PcOOO6p3I0',
      featureId: '0x47e66e2964e32e2d:0x8dfda938e3aef0e0',
      cid: '10231572917539074272',
      listTitle: 'European Wonders',
      listId: 'custom_list_123',
      listType: 'custom',
      userNote: 'Book summit elevator tickets in advance!',
      address: 'Champ de Mars, 5 Av. Anatole France, 75007 Paris, France',
      category: 'Monument',
      phoneNumber: '+33 892 70 12 39',
      websiteUrl: 'https://www.toureiffel.paris',
      rating: 4.7,
      reviewCount: 345000,
      priceLevel: '€€',
      operationalStatus: 'Operational',
      dateAddedToList: '2024-05-12T14:30:00Z',
      extractedAt: '2026-10-04T12:00:00Z',
    },
    {
      id: '0x8085806445f34bc1:0x4d59bc422a578961',
      title: 'Golden Gate Bridge Vista',
      url: 'https://www.google.com/maps/@37.8199,-122.4783,15z',
      latitude: 37.8199,
      longitude: -122.4783,
      isHighPrecision: false,
      listTitle: 'European Wonders',
      userNote: 'Great fog photos in early morning',
      address: 'San Francisco, CA 94129',
      category: 'Scenic Viewpoint',
      rating: 4.8,
      reviewCount: 52000,
      operationalStatus: 'Operational',
      dateAddedToList: '2023-11-01T09:15:00Z',
      extractedAt: '2026-10-04T12:00:00Z',
    },
  ];

  it('generates a valid, multi-sheet Excel (.xlsx) file with all requested pin columns', async () => {
    const blob = SpatialDataExporters.toExcel(mockPlaces, 'European Wonders');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain('spreadsheetml.sheet');

    const buffer = await blob.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });

    // Verify worksheets
    expect(workbook.SheetNames).toContain('Saved Places & Pins');
    expect(workbook.SheetNames).toContain('Audit Summary');

    const placesSheet = workbook.Sheets['Saved Places & Pins'];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(placesSheet);

    expect(rows.length).toBe(2);

    const firstRow = rows[0];
    // Verify comprehensive column coverage
    expect(firstRow['Pin / Place Title']).toBe('Eiffel Tower');
    expect(firstRow['Latitude']).toBeCloseTo(48.85837, 4);
    expect(firstRow['Longitude']).toBeCloseTo(2.29448, 4);
    expect(firstRow['Coordinates (Lat, Lng)']).toBe('48.858370, 2.294481');
    expect(firstRow['Precision Tier']).toBe('High-Precision Pin (!3d/!4d)');
    expect(firstRow['Google Place ID']).toBe('ChIJLU7jZClu5kcR4PcOOO6p3I0');
    expect(firstRow['Hex Feature ID']).toBe('0x47e66e2964e32e2d:0x8dfda938e3aef0e0');
    expect(firstRow['CID Number']).toBe('10231572917539074272');
    expect(firstRow['List Name']).toBe('European Wonders');
    expect(firstRow['List ID']).toBe('custom_list_123');
    expect(firstRow['Personal User Note']).toBe('Book summit elevator tickets in advance!');
    expect(firstRow['Full Address']).toBe('Champ de Mars, 5 Av. Anatole France, 75007 Paris, France');
    expect(firstRow['Place Category']).toBe('Monument');
    expect(firstRow['Phone Number']).toBe('+33 892 70 12 39');
    expect(firstRow['Website URL']).toBe('https://www.toureiffel.paris');
    expect(firstRow['Rating Score']).toBe(4.7);
    expect(firstRow['Review Count']).toBe(345000);
    expect(firstRow['Price Level']).toBe('€€');
    expect(firstRow['Operational Status']).toBe('Operational');
    expect(firstRow['Date Added to List']).toBe('2024-05-12T14:30:00Z');
    expect(firstRow['Extraction Timestamp']).toBe('2026-10-04T12:00:00Z');
    expect(firstRow['Google Maps URL']).toContain('https://www.google.com/maps/place/');
    expect(firstRow['Direct Search Query URL']).toContain('query_place_id=ChIJLU7jZClu5kcR4PcOOO6p3I0');

    // Second row precision tier check
    const secondRow = rows[1];
    expect(secondRow['Precision Tier']).toBe('Viewport Camera (@lat,lng)');
  });

  it('generates valid GeoJSON FeatureCollection complying with RFC 7946', async () => {
    const blob = SpatialDataExporters.toGeoJSON(mockPlaces);
    const text = await blob.text();
    const geojson = JSON.parse(text);

    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features.length).toBe(2);
    // RFC 7946 specifies [longitude, latitude]
    expect(geojson.features[0].geometry.coordinates).toEqual([2.2944813, 48.8583701]);
    expect(geojson.features[0].properties.userNote).toBe('Book summit elevator tickets in advance!');
  });

  it('generates RFC 4180 CSV with escaped commas and notes', async () => {
    const blob = SpatialDataExporters.toCSV(mockPlaces);
    const text = await blob.text();

    expect(text).toContain('Title,Latitude,Longitude,Coordinates');
    expect(text).toContain('"Champ de Mars, 5 Av. Anatole France, 75007 Paris, France"');
    expect(text).toContain('"Book summit elevator tickets in advance!"');
  });
});
