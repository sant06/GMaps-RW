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

  it('fails gracefully on empty or malformed strings without throwing', () => {
    expect(BatchexecuteUnpacker.unpack('')).toEqual([]);
    expect(BatchexecuteUnpacker.unpack(')]}\'\nrandom non-json garbage')).toEqual([]);
  });
});
