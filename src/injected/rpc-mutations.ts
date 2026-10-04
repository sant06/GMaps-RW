/**
 * Mutation payload builder and validator for Google Maps Batchexecute RPCs.
 * Formulates envelopes for list creation, place bookmarking, and custom note synchronization.
 */

import { GMAPS_RPC_IDS } from '../types/rpc';
import type { MutationItemPayload } from '../types/places';
import { isValidCoordinate } from '../utils/coordinates';

export interface ValidatedMutationPayload {
  rpcId: string;
  innerPayload: unknown[];
  targetListId: string;
  itemTitle: string;
}

export class RpcMutationBuilder {
  /**
   * Validates place record inputs prior to RPC dispatch.
   */
  public static validateItemPayload(item: MutationItemPayload): { valid: boolean; error?: string } {
    if (!item.title || item.title.trim().length === 0) {
      return { valid: false, error: 'Place title is required and cannot be empty.' };
    }

    if (!isValidCoordinate(item.latitude, item.longitude)) {
      return {
        valid: false,
        error: `Invalid coordinates: lat=${item.latitude}, lng=${item.longitude}. Must be within [-90,90] and [-180,180].`,
      };
    }

    if (!item.targetListId || item.targetListId.trim().length === 0) {
      return { valid: false, error: 'Target list ID is required.' };
    }

    return { valid: true };
  }

  /**
   * Builds the internal Batchexecute envelope for bookmarking a place to a list.
   * RPC ID: yZ1dGc (or fallback bookmarking RPC)
   */
  public static buildSavePlacePayload(item: MutationItemPayload): ValidatedMutationPayload {
    const validation = this.validateItemPayload(item);
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.error}`);
    }

    // Determine target list identifier
    const listId = this.normalizeListIdentifier(item.targetListId);

    // Google Maps Place Save Envelope Structure:
    // [placeIdentifier, listId, userNote, [latE7, lngE7]]
    const latE7 = Math.round(item.latitude * 1e7);
    const lngE7 = Math.round(item.longitude * 1e7);

    const placeIdentifier = item.placeId || item.featureId || [item.title, [latE7, lngE7]];

    const innerPayload = [
      listId,
      [placeIdentifier],
      item.userNote || null,
      1, // Active state flag (1 = add, 0 = remove)
      null,
      [latE7, lngE7],
      item.title,
    ];

    return {
      rpcId: GMAPS_RPC_IDS.SAVE_PLACE_TO_LIST,
      innerPayload,
      targetListId: listId,
      itemTitle: item.title,
    };
  }

  /**
   * Builds the Batchexecute envelope for creating a new user-curated custom list.
   * RPC ID: mD07Re
   */
  public static buildCreateListPayload(
    listTitle: string,
    description = ''
  ): { rpcId: string; innerPayload: unknown[] } {
    if (!listTitle || listTitle.trim().length === 0) {
      throw new Error('List title cannot be empty.');
    }

    const innerPayload = [
      listTitle.trim(),
      description.trim() || null,
      1, // Visibility (1 = private, 2 = shared)
      null,
      [], // Initial place array
    ];

    return {
      rpcId: GMAPS_RPC_IDS.CREATE_CUSTOM_LIST,
      innerPayload,
    };
  }

  /**
   * Builds the Batchexecute envelope for adding or modifying a custom user note on a saved place.
   * RPC ID: P01qQe
   */
  public static buildUpdateNotePayload(
    placeId: string,
    listId: string,
    noteText: string
  ): { rpcId: string; innerPayload: unknown[] } {
    const innerPayload = [
      this.normalizeListIdentifier(listId),
      placeId,
      noteText.trim(),
      Date.now(),
    ];

    return {
      rpcId: GMAPS_RPC_IDS.UPDATE_PLACE_NOTE,
      innerPayload,
    };
  }

  /**
   * Normalizes well-known system list tokens to Google internal representation.
   */
  private static normalizeListIdentifier(listId: string): string {
    const lower = listId.toLowerCase().trim();
    if (lower === 'starred' || lower === 'destacados') return 'starred';
    if (lower === 'favorites' || lower === 'favoritos') return 'favorites';
    if (lower === 'want_to_go' || lower === 'quiero_ir' || lower === 'want to go') return 'want_to_go';
    return listId;
  }
}
