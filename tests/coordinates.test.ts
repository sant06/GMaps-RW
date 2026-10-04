import { describe, it, expect } from 'vitest';
import { GoogleMapsUrlParser } from '../src/content/parser';
import { isValidCoordinate, haversineDistanceMeters } from '../src/utils/coordinates';

describe('GoogleMapsUrlParser', () => {
  it('extracts high-precision pin coordinates from strict !3d/!4d parameters', () => {
    const url = 'https://www.google.com/maps/place/Central+Park/@40.785091,-73.968285,17z/data=!3m1!4b1!4m6!3m5!1s0x89c2589a018531e3:0xb9df1f7387a94119!8m2!3d40.782865!4d-73.965355!16zL20vMGpjN3c';
    const parsed = GoogleMapsUrlParser.parse(url);

    expect(parsed).not.toBeNull();
    expect(parsed?.isHighPrecision).toBe(true);
    expect(parsed?.latitude).toBeCloseTo(40.782865, 5);
    expect(parsed?.longitude).toBeCloseTo(-73.965355, 5);
    expect(parsed?.featureId).toBe('0x89c2589a018531e3:0xb9df1f7387a94119');
  });

  it('extracts Place ID (ChIJ...) from data parameter', () => {
    const url = 'https://www.google.com/maps/place/Eiffel+Tower/data=!4m2!3m1!1sChIJLU7jZClu5kcR4PcOOO6p3I0!3d48.8583701!4d2.2944813';
    const parsed = GoogleMapsUrlParser.parse(url);

    expect(parsed).not.toBeNull();
    expect(parsed?.placeId).toBe('ChIJLU7jZClu5kcR4PcOOO6p3I0');
    expect(parsed?.latitude).toBeCloseTo(48.8583701, 5);
    expect(parsed?.longitude).toBeCloseTo(2.2944813, 5);
  });

  it('falls back to viewport camera @lat,lng when pin markers are absent', () => {
    const url = 'https://www.google.com/maps/@-34.603722,-58.381592,14z';
    const parsed = GoogleMapsUrlParser.parse(url);

    expect(parsed).not.toBeNull();
    expect(parsed?.isHighPrecision).toBe(false);
    expect(parsed?.latitude).toBeCloseTo(-34.603722, 5);
    expect(parsed?.longitude).toBeCloseTo(-58.381592, 5);
  });

  it('returns null on invalid or empty URLs', () => {
    expect(GoogleMapsUrlParser.parse('')).toBeNull();
    expect(GoogleMapsUrlParser.parse('https://www.google.com/search?q=test')).toBeNull();
  });
});

describe('Coordinate Validation and Distance', () => {
  it('validates coordinate boundaries correctly', () => {
    expect(isValidCoordinate(0, 0)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90.1, 0)).toBe(false);
    expect(isValidCoordinate(0, 180.1)).toBe(false);
    expect(isValidCoordinate(NaN, 0)).toBe(false);
  });

  it('calculates Haversine distance accurately', () => {
    // New York (40.7128, -74.0060) to London (51.5074, -0.1278) ~ 5570 km
    const dist = haversineDistanceMeters(40.7128, -74.006, 51.5074, -0.1278);
    expect(dist).toBeGreaterThan(5500000);
    expect(dist).toBeLessThan(5600000);
  });
});
