import { describe, it, expect } from 'vitest';
import { isPlausibleGeoCoordinate, isLegitimatePlaceTitle } from '../src/utils/validation';

describe('Validation Heuristics (Anti-Phantom Extraction)', () => {
  describe('isPlausibleGeoCoordinate', () => {
    it('accepts legitimate geographic coordinates with fractional precision', () => {
      expect(isPlausibleGeoCoordinate(-34.603722, -58.381592)).toBe(true);
      expect(isPlausibleGeoCoordinate(41.4036, 2.1744)).toBe(true);
      expect(isPlausibleGeoCoordinate(48.8606, 2.3376)).toBe(true);
      expect(isPlausibleGeoCoordinate(-33.8568, 151.2153)).toBe(true);
    });

    it('rejects protobuf integer enums and UI dimensions ([6, 7], [1, 2], [81, 84])', () => {
      expect(isPlausibleGeoCoordinate(6, 7)).toBe(false);
      expect(isPlausibleGeoCoordinate(1, 2)).toBe(false);
      expect(isPlausibleGeoCoordinate(81, 84)).toBe(false);
      expect(isPlausibleGeoCoordinate(32, 84)).toBe(false);
      expect(isPlausibleGeoCoordinate(74, 84)).toBe(false);
    });

    it('rejects near-zero null island offsets and microscopic protobuf deltas', () => {
      expect(isPlausibleGeoCoordinate(0, 0)).toBe(false);
      expect(isPlausibleGeoCoordinate(0.0002026, 0.000001)).toBe(false);
      expect(isPlausibleGeoCoordinate(0.05, 0.08)).toBe(false);
      expect(isPlausibleGeoCoordinate(0, 0.4)).toBe(false);
    });

    it('rejects out of bounds coordinates', () => {
      expect(isPlausibleGeoCoordinate(95.0, 10.0)).toBe(false);
      expect(isPlausibleGeoCoordinate(10.0, 195.0)).toBe(false);
      expect(isPlausibleGeoCoordinate(NaN, 10.0)).toBe(false);
    });

    it('rejects Google Maps rating and review count tuples ([4.6, 126], [4.3, 118])', () => {
      expect(isPlausibleGeoCoordinate(4.6, 126)).toBe(false);
      expect(isPlausibleGeoCoordinate(4.3, 118)).toBe(false);
      expect(isPlausibleGeoCoordinate(3.6, 133)).toBe(false);
      expect(isPlausibleGeoCoordinate(4.8, 54)).toBe(false);
      expect(isPlausibleGeoCoordinate(4.5, 150)).toBe(false);
    });
  });

  describe('isLegitimatePlaceTitle', () => {
    it('accepts authentic place and venue names', () => {
      expect(isLegitimatePlaceTitle('Sydney Opera House')).toBe(true);
      expect(isLegitimatePlaceTitle('Colosseum')).toBe(true);
      expect(isLegitimatePlaceTitle('Sagrada Família')).toBe(true);
      expect(isLegitimatePlaceTitle('Café Tortoni')).toBe(true);
      expect(isLegitimatePlaceTitle('Parrilla Don Julio')).toBe(true);
      expect(isLegitimatePlaceTitle('Musée d’Orsay')).toBe(true);
    });

    it('accepts raw coordinate titles for dropped pins and unnamed saved locations', () => {
      expect(isLegitimatePlaceTitle('(-36.495170, -56.691744)')).toBe(true);
      expect(isLegitimatePlaceTitle('(40.252596, 58.439703)')).toBe(true);
      expect(isLegitimatePlaceTitle('(21.037718, 105.834036)')).toBe(true);
      expect(isLegitimatePlaceTitle('-34.601335, -58.370882')).toBe(true);
      expect(isLegitimatePlaceTitle('40°15\'09.4"N 58°26\'22.9"E')).toBe(true);
    });

    it('rejects user account avatar elements', () => {
      expect(isLegitimatePlaceTitle('Cuenta de Google: Santiago Montoya')).toBe(false);
      expect(isLegitimatePlaceTitle('Google Account: John Doe')).toBe(false);
    });

    it('rejects Google internal Protobuf and telemetry tags', () => {
      expect(isLegitimatePlaceTitle('psm')).toBe(false);
      expect(isLegitimatePlaceTitle('gps')).toBe(false);
      expect(isLegitimatePlaceTitle('tipo 2')).toBe(false);
      expect(isLegitimatePlaceTitle('tomacorriente')).toBe(false);
      expect(isLegitimatePlaceTitle('photos:AHX2f3...')).toBe(false);
      expect(isLegitimatePlaceTitle('bizbuilder:entry1')).toBe(false);
      expect(isLegitimatePlaceTitle('casanova:asset9')).toBe(false);
      expect(isLegitimatePlaceTitle('SearchResult.header')).toBe(false);
      expect(isLegitimatePlaceTitle('2ahUKEwj1234567')).toBe(false);
    });

    it('rejects days of the week', () => {
      expect(isLegitimatePlaceTitle('lunes')).toBe(false);
      expect(isLegitimatePlaceTitle('martes')).toBe(false);
      expect(isLegitimatePlaceTitle('miércoles')).toBe(false);
      expect(isLegitimatePlaceTitle('domingo')).toBe(false);
      expect(isLegitimatePlaceTitle('Monday')).toBe(false);
      expect(isLegitimatePlaceTitle('Saturday')).toBe(false);
    });

    it('rejects busyness labels and operational statuses', () => {
      expect(isLegitimatePlaceTitle('un poco concurrido')).toBe(false);
      expect(isLegitimatePlaceTitle('poco concurrido')).toBe(false);
      expect(isLegitimatePlaceTitle('cerrado permanentemente')).toBe(false);
      expect(isLegitimatePlaceTitle('cerrado')).toBe(false);
      expect(isLegitimatePlaceTitle('open 24 hours')).toBe(false);
    });

    it('rejects timezones', () => {
      expect(isLegitimatePlaceTitle('America/Montevideo')).toBe(false);
      expect(isLegitimatePlaceTitle('Europe/Madrid')).toBe(false);
      expect(isLegitimatePlaceTitle('Asia/Tokyo')).toBe(false);
    });

    it('rejects ISO dates, timestamps, prices, ratings, and time strings', () => {
      expect(isLegitimatePlaceTitle('2027-01-02')).toBe(false);
      expect(isLegitimatePlaceTitle('2015-02-08T08:00:00.000Z')).toBe(false);
      expect(isLegitimatePlaceTitle('2026-06-15T05:00:00.000Z')).toBe(false);
      expect(isLegitimatePlaceTitle('$ 1.282.963')).toBe(false);
      expect(isLegitimatePlaceTitle('150€')).toBe(false);
      expect(isLegitimatePlaceTitle('12:00 PM')).toBe(false);
      expect(isLegitimatePlaceTitle('14:30')).toBe(false);
      expect(isLegitimatePlaceTitle('4.5 estrellas')).toBe(false);
      expect(isLegitimatePlaceTitle('4.8 stars')).toBe(false);
    });

    it('rejects base64-like internal hashes and list tokens without spaces', () => {
      expect(isLegitimatePlaceTitle('d3fCauWaHYnL1sQPjYam8QM')).toBe(false);
      expect(isLegitimatePlaceTitle('dtwiDbA3kCGXN9zXNogHTRiK3nccSw')).toBe(false);
      expect(isLegitimatePlaceTitle('_dZ3G2xCjlm2w9CB3XKYHAteuFrUfA')).toBe(false);
    });

    it('rejects URLs, internal entity paths, and pegman easter egg skins', () => {
      expect(isLegitimatePlaceTitle('https://www.google.com')).toBe(false);
      expect(isLegitimatePlaceTitle('/m/042_8')).toBe(false);
      expect(isLegitimatePlaceTitle('/search?q=foo')).toBe(false);
      expect(isLegitimatePlaceTitle('/tactile/pegman_v3/merman/')).toBe(false);
    });

    it('rejects non-string or empty inputs', () => {
      expect(isLegitimatePlaceTitle('')).toBe(false);
      expect(isLegitimatePlaceTitle(' ')).toBe(false);
      expect(isLegitimatePlaceTitle(null)).toBe(false);
      expect(isLegitimatePlaceTitle(undefined)).toBe(false);
    });
  });
});
