import { describe, it, expect } from 'vitest';
import { RpcMutationBuilder } from '../src/injected/rpc-mutations';
import { GMAPS_RPC_IDS } from '../src/types/rpc';
import type { MutationItemPayload } from '../types/places';

describe('RpcMutationBuilder', () => {
  it('validates place mutation payload accurately', () => {
    const validItem: MutationItemPayload = {
      title: 'Grand Canyon',
      latitude: 36.1069,
      longitude: -112.1129,
      targetListId: 'favorites',
      userNote: 'Must visit viewpoint at sunset',
    };

    expect(RpcMutationBuilder.validateItemPayload(validItem).valid).toBe(true);

    const missingTitle: MutationItemPayload = {
      ...validItem,
      title: '   ',
    };
    expect(RpcMutationBuilder.validateItemPayload(missingTitle).valid).toBe(false);

    const invalidCoords: MutationItemPayload = {
      ...validItem,
      latitude: 105.0, // Exceeds 90
    };
    expect(RpcMutationBuilder.validateItemPayload(invalidCoords).valid).toBe(false);
  });

  it('builds valid save place envelope with E7 scaled coordinates and target list', () => {
    const item: MutationItemPayload = {
      title: 'Machu Picchu',
      latitude: -13.1631,
      longitude: -72.545,
      placeId: 'ChIJ2yKqHwG_bZER5jT_X-tD_zE',
      targetListId: 'want_to_go',
      userNote: 'Inca trail permit reserved',
    };

    const built = RpcMutationBuilder.buildSavePlacePayload(item);
    expect(built.rpcId).toBe(GMAPS_RPC_IDS.SAVE_PLACE_TO_LIST);
    expect(built.targetListId).toBe('want_to_go');
    expect(built.innerPayload[0]).toBe('want_to_go');
    expect(built.innerPayload[2]).toBe('Inca trail permit reserved');

    // Coordinates scaled to E7
    const coordsE7 = built.innerPayload[5] as [number, number];
    expect(coordsE7[0]).toBe(Math.round(-13.1631 * 1e7));
    expect(coordsE7[1]).toBe(Math.round(-72.545 * 1e7));
  });

  it('builds create list envelope with custom name and description', () => {
    const built = RpcMutationBuilder.buildCreateListPayload('Japan 2027 Trip', 'Ramen and temples itinerary');
    expect(built.rpcId).toBe(GMAPS_RPC_IDS.CREATE_CUSTOM_LIST);
    expect(built.innerPayload[0]).toBe('Japan 2027 Trip');
    expect(built.innerPayload[1]).toBe('Ramen and temples itinerary');
  });
});
