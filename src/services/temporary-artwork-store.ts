import type { ArtworkImportPayload } from './artwork-importer-core';

export interface TemporaryArtworkAsset {
	id: string;
	name: string;
	resourcePath: string;
	size: number;
	revisionFingerprint: string;
}

export interface TemporaryArtworkUrlFactory {
	create(blob: Blob): string;
	revoke(resourcePath: string): void;
}

const DEFAULT_URL_FACTORY: TemporaryArtworkUrlFactory = {
	create: (blob) => URL.createObjectURL(blob),
	revoke: (resourcePath) => URL.revokeObjectURL(resourcePath),
};

/** Plugin-lifetime owner-tracked object URLs for session-only artwork. */
export class TemporaryArtworkStore {
	private readonly assets = new Map<string, TemporaryArtworkAsset>();
	private readonly payloads = new Map<string, ArtworkImportPayload>();
	private readonly referencesByOwner = new Map<string, Set<string>>();

	constructor(
		private readonly urlFactory = DEFAULT_URL_FACTORY,
		private readonly createId: () => string = createTemporaryArtworkId,
	) {}

	get size(): number {
		return this.assets.size;
	}

	create(payload: ArtworkImportPayload): TemporaryArtworkAsset {
		const id = this.createId();
		const resourcePath = this.urlFactory.create(new Blob(
			[payload.data],
			{ type: payload.mimeType ?? 'application/octet-stream' },
		));
		const asset: TemporaryArtworkAsset = {
			id,
			name: payload.fileName,
			resourcePath,
			size: payload.data.byteLength,
			revisionFingerprint: JSON.stringify({
				revision: 'temporary-artwork-v1',
				id,
				name: payload.fileName,
				size: payload.data.byteLength,
			}),
		};
		this.assets.set(id, asset);
		this.payloads.set(id, payload);
		return asset;
	}

	get(id: string): TemporaryArtworkAsset | undefined {
		return this.assets.get(id);
	}

	getPayload(id: string): ArtworkImportPayload | undefined {
		return this.payloads.get(id);
	}

	setOwnerReferences(owner: string, ids: Iterable<string>): void {
		this.referencesByOwner.set(owner, new Set(ids));
		this.releaseUnreferenced();
	}

	releaseOwner(owner: string): void {
		this.referencesByOwner.delete(owner);
		this.releaseUnreferenced();
	}

	remove(id: string): void {
		const asset = this.assets.get(id);
		if (!asset) {
			return;
		}
		this.assets.delete(id);
		this.payloads.delete(id);
		this.urlFactory.revoke(asset.resourcePath);
	}

	clear(): void {
		for (const asset of this.assets.values()) {
			this.urlFactory.revoke(asset.resourcePath);
		}
		this.assets.clear();
		this.payloads.clear();
		this.referencesByOwner.clear();
	}

	private releaseUnreferenced(): void {
		const referenced = new Set<string>();
		for (const ids of this.referencesByOwner.values()) {
			for (const id of ids) {
				referenced.add(id);
			}
		}
		for (const id of this.assets.keys()) {
			if (!referenced.has(id)) {
				this.remove(id);
			}
		}
	}
}

export function collectTemporaryArtworkIds(
	values: Iterable<{ artwork?: { kind: string; id?: string } } | undefined>,
): Set<string> {
	const ids = new Set<string>();
	for (const value of values) {
		if (value?.artwork?.kind === 'temporary' && value.artwork.id) {
			ids.add(value.artwork.id);
		}
	}
	return ids;
}

function createTemporaryArtworkId(): string {
	return window.crypto?.randomUUID?.()
		?? `temporary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
