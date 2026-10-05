import { describe, it, expect } from 'vitest';
import { BatchexecuteUnpacker } from '../src/injected/rpc-unpacker';

describe('BatchexecuteUnpacker', () => {
  it('strips anti-XSSI security prefix and unpacks line-delimited batchexecute chunks', () => {
    const rawPayload = `)]}'

145
[["wrb.fr","d2kYSc","[[\\"ChIJgTwAaDSmEmsR5...\\",\\"Sydney Opera House\\",[-33.8568,151.2153],\\"Bennelong Point\\"]]",null,null,null,"generic"]]`;

    const unpacked = BatchexecuteUnpacker.unpack(rawPayload);
    expect(unpacked.length).toBeGreaterThan(0);
    expect(unpacked[0].rpcId).toBe('d2kYSc');

    const places = unpacked[0].extractedPlaces;
    expect(places.length).toBe(1);
    expect(places[0].title).toBe('Sydney Opera House');
    expect(places[0].latitude).toBeCloseTo(-33.8568, 4);
    expect(places[0].longitude).toBeCloseTo(151.2153, 4);
  });

  it('correctly decodes E7 scaled integer coordinates from deep array hierarchies', () => {
    const mockArray = [
      'random_token',
      [
        'Colosseum',
        [418902100, 124922300], // 41.89021, 12.49223 in E7
        'ChIJ47Xb3fRhKRMRK8q6h7Q1',
      ],
    ];

    const extracted = BatchexecuteUnpacker.deepExtractPlaces(mockArray);
    expect(extracted.length).toBe(1);
    expect(extracted[0].title).toBe('Colosseum');
    expect(extracted[0].latitude).toBeCloseTo(41.89021, 5);
    expect(extracted[0].longitude).toBeCloseTo(12.49223, 5);
    expect(extracted[0].placeId).toBe('ChIJ47Xb3fRhKRMRK8q6h7Q1');
  });

  it('decodes coordinates from extended arrays ([null, null, lat, lng]) and objects', () => {
    const mockExtended = [
      'Token',
      [
        'Sagrada Familia',
        [null, null, 41.4036, 2.1744],
        'ChIJqdcp1d-ipBIRTg16g3K6',
      ],
      [
        'Louvre Museum',
        { lat: 48.8606, lng: 2.3376 },
        'ChIJD39Dysdv5kcR_DYm8AyAPYA',
      ],
    ];

    const extracted = BatchexecuteUnpacker.deepExtractPlaces(mockExtended);
    expect(extracted.length).toBe(2);
    expect(extracted[0].title).toBe('Sagrada Familia');
    expect(extracted[0].latitude).toBeCloseTo(41.4036, 4);
    expect(extracted[0].longitude).toBeCloseTo(2.1744, 4);

    expect(extracted[1].title).toBe('Louvre Museum');
    expect(extracted[1].latitude).toBeCloseTo(48.8606, 4);
    expect(extracted[1].longitude).toBeCloseTo(2.3376, 4);
  });

  it('rejects protobuf metadata, enum pairs, and noise arrays that lack valid Place IDs', () => {
    const phantomPayload = [
      ['psm', [6, 7]],
      ['America/Montevideo', [81, 84]],
      ['lunes', [1.4, 5]],
      ['photos:AHX...extra', [0.0002026, 1e-6]],
      ['$ 1.282.963', [10.5, 20.3]], // No place ID
      ['Cuenta de Google: Santiago Montoya', [-34.6037, -58.3816], 'ChIJAccount1234567890'], // Rejected by title
    ];

    const extracted = BatchexecuteUnpacker.deepExtractPlaces(phantomPayload);
    expect(extracted.length).toBe(0);
  });

  it('correctly unpacks Google Maps Placelists (nested title and geometry arrays) like Mayo24', () => {
    const mockPlacelistPayload = [
      'list_metadata',
      [
        'Mayo24',
        '10 sitios',
        [
          [
            '0x960a33b2bf884145:0x8797f1cc51376e33',
            ['Neuquén', 'Neuquén, Neuquén Province'],
            null,
            null,
            null,
            [[null, null, -38.9516, -68.0591]],
            'ChIJNeuquenPlaceId12345678',
            'Hermosa ciudad para visitar',
          ],
          [
            '0x960a000000000000:0x1111111111111111',
            ['Dropped pin', 'near Camino Parque Centenario, Buenos Aires'],
            null,
            null,
            null,
            [[null, null, -34.8912, -58.0123]],
          ],
          [
            '0x9610000000000000:0x2222222222222222',
            ['Valdivia', 'Valdivia, Los Ríos'],
            null,
            null,
            null,
            [[null, null, -39.8142, -73.2459]],
            'ChIJValdiviaPlaceId1234567',
          ],
        ],
      ],
    ];

    const extracted = BatchexecuteUnpacker.deepExtractPlaces(mockPlacelistPayload);
    expect(extracted.length).toBe(3);

    expect(extracted[0].title).toBe('Neuquén');
    expect(extracted[0].address).toBe('Neuquén, Neuquén Province');
    expect(extracted[0].latitude).toBeCloseTo(-38.9516, 4);
    expect(extracted[0].longitude).toBeCloseTo(-68.0591, 4);
    expect(extracted[0].placeId).toBe('ChIJNeuquenPlaceId12345678');
    expect(extracted[0].userNote).toBe('Hermosa ciudad para visitar');

    expect(extracted[1].title).toBe('Dropped pin');
    expect(extracted[1].address).toBe('near Camino Parque Centenario, Buenos Aires');
    expect(extracted[1].latitude).toBeCloseTo(-34.8912, 4);
    expect(extracted[1].longitude).toBeCloseTo(-58.0123, 4);

    expect(extracted[2].title).toBe('Valdivia');
    expect(extracted[2].latitude).toBeCloseTo(-39.8142, 4);
    expect(extracted[2].longitude).toBeCloseTo(-73.2459, 4);
  });

  it('ignores rating and review count tuples and extracts real coordinates', () => {
    const mockBusinessPayload = [
      'ChIJBodegasLopez1234567890',
      'Bodegas López Buenos Aires',
      ['Tienda de vinos'],
      [4.6, 126], // Rating and review count! Must NOT be taken as coordinates!
      [null, null, -34.16998, -58.94943], // Real geographic coordinates
    ];

    const extracted = BatchexecuteUnpacker.deepExtractPlaces([mockBusinessPayload]);
    expect(extracted.length).toBe(1);
    expect(extracted[0].title).toBe('Bodegas López Buenos Aires');
    expect(extracted[0].latitude).toBeCloseTo(-34.16998, 4);
    expect(extracted[0].longitude).toBeCloseTo(-58.94943, 4);
  });

  it('correctly extracts unnamed dropped pins whose titles are raw coordinates (e.g. Turkmenistan pin)', () => {
    const mockTurkmenistanPin = [
      '(40.252596, 58.439703)',
      'Turkmenistán',
      [[null, null, 40.252596, 58.439703]],
    ];

    const extracted = BatchexecuteUnpacker.deepExtractPlaces([mockTurkmenistanPin]);
    expect(extracted.length).toBe(1);
    expect(extracted[0].title).toBe('(40.252596, 58.439703)');
    expect(extracted[0].address).toBe('Turkmenistán');
    expect(extracted[0].latitude).toBeCloseTo(40.252596, 5);
    expect(extracted[0].longitude).toBeCloseTo(58.439703, 5);
  });

  it('correctly extracts places from custom placelists that lack explicit ChIJ Place IDs (e.g. Mayo24)', () => {
    const mockCustomPlacelist = [
      'list_metadata',
      [
        'Mayo24',
        '10 sitios',
        [
          [
            'CAESY0FvQXR1234567890',
            ['Observatorio La Silla', 'Chile'],
            null,
            [-29.2563, -70.738],
            'Hermosa vista de las estrellas',
          ],
          [
            'CAESY0FvQXR0987654321',
            ['Tarapacá', 'Chile'],
            null,
            [-20.2138, -69.324],
          ],
        ],
      ],
    ];

    const extracted = BatchexecuteUnpacker.deepExtractPlaces(mockCustomPlacelist);
    expect(extracted.length).toBe(2);
    expect(extracted[0].title).toBe('Observatorio La Silla');
    expect(extracted[0].address).toBe('Chile');
    expect(extracted[0].latitude).toBeCloseTo(-29.2563, 4);
    expect(extracted[0].longitude).toBeCloseTo(-70.738, 4);
    expect(extracted[0].userNote).toBe('Hermosa vista de las estrellas');

    expect(extracted[1].title).toBe('Tarapacá');
    expect(extracted[1].address).toBe('Chile');
    expect(extracted[1].latitude).toBeCloseTo(-20.2138, 4);
    expect(extracted[1].longitude).toBeCloseTo(-69.324, 4);
  });

  it('spatially deduplicates records with identical coordinates, merging cleaner names with addresses and notes', () => {
    const mockDuplicates = [
      [
        'CAES1',
        ['Neuquén', 'Neuquén, Neuquén Province'],
        null,
        [-38.951678, -68.059188],
        'Hermosa ciudad',
      ],
      [
        'CAES2',
        ['Neuquén, Neuquén Province'],
        null,
        [-38.951678, -68.059188],
      ],
    ];

    const extracted = BatchexecuteUnpacker.deepExtractPlaces(mockDuplicates);
    expect(extracted.length).toBe(1);
    expect(extracted[0].title).toBe('Neuquén');
    expect(extracted[0].address).toBe('Neuquén, Neuquén Province');
    expect(extracted[0].userNote).toBe('Hermosa ciudad');
    expect(extracted[0].latitude).toBeCloseTo(-38.951678, 5);
    expect(extracted[0].longitude).toBeCloseTo(-68.059188, 5);
  });

  it('rejects Google Maps Pegman easter eggs and internal skin paths', () => {
    const mockPegman = [
      [
        '2015-02-08T08:00:00.000Z',
        'merman',
        '/tactile/pegman_v3/merman/',
        [-33.894113, 151.277414],
      ],
      [
        '2014-04-01T00:00:00.000Z',
        'area51',
        '/tactile/pegman_v3/area51/',
        [36.5262, -116.7102],
      ],
    ];

    const extracted = BatchexecuteUnpacker.deepExtractPlaces(mockPegman);
    expect(extracted.length).toBe(0);
  });

  it('fails gracefully on empty or malformed strings without throwing', () => {
    expect(BatchexecuteUnpacker.unpack('')).toEqual([]);
    expect(BatchexecuteUnpacker.unpack(')]}\'\nrandom non-json garbage')).toEqual([]);
  });
});
