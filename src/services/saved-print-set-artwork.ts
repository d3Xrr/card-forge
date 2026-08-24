import type { CardOverrides } from '../models/card-overrides';
import {
	createPrintQueueEntrySnapshot,
	type PrintQueueEntrySnapshot,
} from '../models/print-queue';
import {
	storeImportedArtwork,
	type ArtworkAssetVault,
	type ArtworkImportPayload,
} from './artwork-importer-core';

export interface TemporaryArtworkPayloadSource {
	getPayload(id: string): ArtworkImportPayload | undefined;
}

export type PreparedSavedPrintSetEntries =
	| {
		status: 'ready';
		entries: PrintQueueEntrySnapshot[];
		persistedArtworkCount: number;
		temporaryArtworkPaths: ReadonlyMap<string, string>;
	}
	| { status: 'missing-artwork'; temporaryArtworkId: string };

/**
 * Converts available session artwork to durable vault overrides before a Saved
 * Print Set record is mutated. One temporary resource is written at most once
 * per save operation.
 */
export async function prepareSavedPrintSetEntries(
	entries: readonly PrintQueueEntrySnapshot[],
	vault: ArtworkAssetVault,
	temporaryArtwork: TemporaryArtworkPayloadSource,
	assetsFolder: string,
): Promise<PreparedSavedPrintSetEntries> {
	const snapshots = entries.map(createPrintQueueEntrySnapshot);
	const payloads = new Map<string, ArtworkImportPayload>();
	for (const entry of snapshots) {
		const artwork = entry.overrides?.artwork;
		if (artwork?.kind !== 'temporary' || payloads.has(artwork.id)) {
			continue;
		}
		const payload = temporaryArtwork.getPayload(artwork.id);
		if (!payload) {
			return { status: 'missing-artwork', temporaryArtworkId: artwork.id };
		}
		payloads.set(artwork.id, payload);
	}

	const vaultPaths = new Map<string, string>();
	for (const [id, payload] of payloads) {
		vaultPaths.set(
			id,
			await storeImportedArtwork(vault, payload, assetsFolder),
		);
	}

	return {
		status: 'ready',
		entries: snapshots.map((entry) => replaceTemporaryArtwork(entry, vaultPaths)),
		persistedArtworkCount: vaultPaths.size,
		temporaryArtworkPaths: vaultPaths,
	};
}

function replaceTemporaryArtwork(
	entry: PrintQueueEntrySnapshot,
	vaultPaths: ReadonlyMap<string, string>,
): PrintQueueEntrySnapshot {
	const artwork = entry.overrides?.artwork;
	if (artwork?.kind !== 'temporary') {
		return entry;
	}
	const path = vaultPaths.get(artwork.id);
	if (!path) {
		return entry;
	}
	const overrides: CardOverrides = {
		...entry.overrides,
		artwork: { kind: 'vault', path },
	};
	return { ...entry, overrides };
}
