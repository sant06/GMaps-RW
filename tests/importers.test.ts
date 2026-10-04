import { describe, it, expect } from 'vitest';
import { SpatialDataImporters } from '../src/sidepanel/importers';

describe('SpatialDataImporters', () => {
  it('parses valid GeoJSON FeatureCollection into MutationItemPayload records', () => {
    const geojsonStr = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [-73.9855, 40.7484], // [lng, lat]
          },
          properties: {
            title: 'Empire State Building',
            placeId: 'ChIJtcaxrqlZwokRfwmmibzEiSo',
            userNote: 'Visit 86th floor observatory',
            address: '20 W 34th St, New York, NY 10001',
          },
        },
      ],
    });

    const items = SpatialDataImporters.parseGeoJSON(geojsonStr, 'NYC Landmarks');
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Empire State Building');
    expect(items[0].latitude).toBeCloseTo(40.7484, 4);
    expect(items[0].longitude).toBeCloseTo(-73.9855, 4);
    expect(items[0].placeId).toBe('ChIJtcaxrqlZwokRfwmmibzEiSo');
    expect(items[0].userNote).toBe('Visit 86th floor observatory');
    expect(items[0].targetListId).toBe('NYC Landmarks');
  });

  it('parses RFC 4180 CSV with quoted commas and multiline content', () => {
    const csvContent = `Title,Latitude,Longitude,User_Note,Address\n"Times Square",40.7580,-73.9855,"Crowded, but bright!","Broadway, New York, NY"`;

    const items = SpatialDataImporters.parseCSV(csvContent, 'NYC Favorites');
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('Times Square');
    expect(items[0].latitude).toBeCloseTo(40.758, 3);
    expect(items[0].longitude).toBeCloseTo(-73.9855, 4);
    expect(items[0].userNote).toBe('Crowded, but bright!');
    expect(items[0].address).toBe('Broadway, New York, NY');
  });
});
