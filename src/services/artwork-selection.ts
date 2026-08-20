import type { CardArtworkOverride } from '../models/card-overrides';
import {
	type ArtworkAssetVault,
	type ArtworkImportPayload,
	storeImportedArtwork,
} from './artwork-importer-core';
import type {
	TemporaryArtworkAsset,
	TemporaryArtworkStore,
} from './temporary-artwork-store';

export interface SelectedArtworkStorage {
	override: CardArtworkOverride;
	temporaryAsset?: TemporaryArtworkAsset;
	vaultPath?: string;
}

export async function selectArtworkStorage(
	vault: ArtworkAssetVault,
	temporaryStore: TemporaryArtworkStore,
	payload: ArtworkImportPayload,
	options: { persist: boolean; origin: 'local' | 'https' },
): Promise<SelectedArtworkStorage> {
	if (options.persist) {
		const path = await storeImportedArtwork(vault, payload);
		return {
			override: { kind: 'vault', path },
			vaultPath: path,
		};
	}
	const asset = temporaryStore.create(payload);
	return {
		override: {
			kind: 'temporary',
			id: asset.id,
			name: asset.name,
			origin: options.origin,
		},
		temporaryAsset: asset,
	};
}
