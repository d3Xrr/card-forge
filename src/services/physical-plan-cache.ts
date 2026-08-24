import {
	createStructuredItemFieldOriginsSnapshot,
	type ItemCardData,
} from '../models/item';
import {
	PHYSICAL_CARD_PROFILE,
	type PhysicalCardProfile,
} from '../models/physical-card-profile';

export const DEFAULT_PHYSICAL_PLAN_CACHE_CAPACITY = 128;
export const PHYSICAL_PLAN_CACHE_SCHEMA_REVISION = 'physical-plan-cache-v2';
export const DEFAULT_PHYSICAL_PLAN_PLANNER_REVISION = 'item-card-planner-v4-field-provenance';
export const DEFAULT_PHYSICAL_PLAN_RENDERER_REVISION = 'item-card-renderer-css-v5';
export const EMPTY_PHYSICAL_PLAN_FINGERPRINT = 'none';

export interface PhysicalPlanArtworkFingerprint {
	filePath: string;
	modifiedTime: number;
	size: number;
	contentFingerprint?: string;
}

export interface PhysicalPlanCacheKeyInput {
	item: ItemCardData;
	sourceFingerprint: string;
	artworkFingerprint?: PhysicalPlanArtworkFingerprint;
	physicalProfile?: Readonly<PhysicalCardProfile>;
	plannerRevision?: string;
	rendererRevision?: string;
	renderSettingsFingerprint?: string;
	overrideFingerprint?: string;
}

export interface PhysicalPlanCacheIdentity {
	filePath: string;
	key: string;
	artworkFilePath?: string;
}

interface CachedPhysicalPlan<T> {
	filePath: string;
	artworkFilePath?: string;
	value: T;
}

interface PendingPhysicalPlan<T> {
	filePath: string;
	artworkFilePath?: string;
	promise: Promise<T>;
}

/**
 * Produces an exact, fixed-order cache key rather than a filename-only key.
 * The normalized item remains in the key to avoid stale plans from a lossy
 * synchronous hash. The bounded cache limits total key memory.
 */
export function createPhysicalPlanCacheKey(
	input: PhysicalPlanCacheKeyInput,
): string {
	const profile = input.physicalProfile ?? PHYSICAL_CARD_PROFILE;
	return JSON.stringify({
		schemaRevision: PHYSICAL_PLAN_CACHE_SCHEMA_REVISION,
		filePath: input.item.filePath,
		sourceFingerprint: input.sourceFingerprint,
		item: createCanonicalItemFingerprint(input.item),
		artwork: input.artworkFingerprint
			? {
				filePath: input.artworkFingerprint.filePath,
				modifiedTime: input.artworkFingerprint.modifiedTime,
				size: input.artworkFingerprint.size,
				contentFingerprint: input.artworkFingerprint.contentFingerprint
					?? null,
			}
			: null,
		physicalProfile: {
			widthMm: profile.widthMm,
			heightMm: profile.heightMm,
			widthPx: profile.widthPx,
			heightPx: profile.heightPx,
			dpi: profile.dpi,
		},
		plannerRevision: input.plannerRevision
			?? DEFAULT_PHYSICAL_PLAN_PLANNER_REVISION,
		rendererRevision: input.rendererRevision
			?? DEFAULT_PHYSICAL_PLAN_RENDERER_REVISION,
		renderSettingsFingerprint: input.renderSettingsFingerprint
			?? EMPTY_PHYSICAL_PLAN_FINGERPRINT,
		overrideFingerprint: input.overrideFingerprint
			?? EMPTY_PHYSICAL_PLAN_FINGERPRINT,
	});
}

export function createPhysicalPlanCacheIdentity(
	input: PhysicalPlanCacheKeyInput,
): PhysicalPlanCacheIdentity {
	return {
		filePath: input.item.filePath,
		key: createPhysicalPlanCacheKey(input),
		...(input.artworkFingerprint
			? { artworkFilePath: input.artworkFingerprint.filePath }
			: {}),
	};
}

/** Exact normalized-input fingerprint used for selective index reconciliation. */
export function createEffectiveItemFingerprint(item: ItemCardData): string {
	return JSON.stringify(createCanonicalItemFingerprint(item));
}

/**
 * Produces a compact source-revision fingerprint without retaining Markdown in
 * the runtime cache or diagnostics. The normalized item is also stored exactly
 * in the cache key, so hash collisions cannot cause stale plan reuse.
 */
export function createSourceContentFingerprint(
	markdown: string,
	modifiedTime: number,
	size: number,
): string {
	return JSON.stringify({
		revision: 'item-source-v1',
		modifiedTime,
		size,
		contentHash: hashFingerprintText(markdown),
	});
}

/**
 * A plugin-lifetime, data-only cache for completed canonical physical plans.
 * Completed values use LRU ordering; identical in-flight work is deduplicated.
 */
export class PhysicalPlanCache<T> {
	private readonly completed = new Map<string, CachedPhysicalPlan<T>>();
	private readonly inFlight = new Map<string, PendingPhysicalPlan<T>>();

	constructor(
		readonly capacity = DEFAULT_PHYSICAL_PLAN_CACHE_CAPACITY,
	) {
		if (!Number.isInteger(capacity) || capacity < 1) {
			throw new RangeError('Physical plan cache capacity must be a positive integer.');
		}
	}

	get completedSize(): number {
		return this.completed.size;
	}

	get inFlightSize(): number {
		return this.inFlight.size;
	}

	getStatus(identity: PhysicalPlanCacheIdentity): 'hit' | 'pending' | 'miss' {
		const completed = this.completed.get(identity.key);
		if (completed?.filePath === identity.filePath) {
			return 'hit';
		}
		const pending = this.inFlight.get(identity.key);
		return pending?.filePath === identity.filePath ? 'pending' : 'miss';
	}

	peek(identity: PhysicalPlanCacheIdentity): T | undefined {
		const entry = this.completed.get(identity.key);
		if (!entry || entry.filePath !== identity.filePath) {
			return undefined;
		}

		this.completed.delete(identity.key);
		this.completed.set(identity.key, entry);
		return entry.value;
	}

	getOrCreate(
		identity: PhysicalPlanCacheIdentity,
		factory: () => Promise<T> | T,
	): Promise<T> {
		const completed = this.peek(identity);
		if (completed !== undefined) {
			return Promise.resolve(completed);
		}

		const pending = this.inFlight.get(identity.key);
		if (pending?.filePath === identity.filePath) {
			return pending.promise;
		}

		const promise = Promise.resolve().then(factory);
		const entry = {
			filePath: identity.filePath,
			...(identity.artworkFilePath
				? { artworkFilePath: identity.artworkFilePath }
				: {}),
			promise,
		};
		this.inFlight.set(identity.key, entry);
		void promise.then(
			(value) => {
				if (this.inFlight.get(identity.key) !== entry) {
					return;
				}
				this.inFlight.delete(identity.key);
				this.storeCompleted(identity, value);
			},
			() => {
				if (this.inFlight.get(identity.key) === entry) {
					this.inFlight.delete(identity.key);
				}
			},
		);
		return promise;
	}

	/** Invalidates every completed or pending plan for one source item only. */
	invalidateFile(filePath: string): number {
		let removed = 0;
		for (const [key, entry] of this.completed) {
			if (entry.filePath === filePath) {
				this.completed.delete(key);
				removed += 1;
			}
		}
		for (const [key, entry] of this.inFlight) {
			if (entry.filePath === filePath) {
				this.inFlight.delete(key);
				removed += 1;
			}
		}
		return removed;
	}

	/** Invalidates only plans whose resolved artwork file changed. */
	invalidateArtwork(artworkFilePath: string): number {
		let removed = 0;
		for (const [key, entry] of this.completed) {
			if (entry.artworkFilePath === artworkFilePath) {
				this.completed.delete(key);
				removed += 1;
			}
		}
		for (const [key, entry] of this.inFlight) {
			if (entry.artworkFilePath === artworkFilePath) {
				this.inFlight.delete(key);
				removed += 1;
			}
		}
		return removed;
	}

	/**
	 * Removes stale keys only for the files represented by `validIdentities`.
	 * Unlisted files remain warm; deleted files use invalidateFile.
	 */
	reconcile(validIdentities: readonly PhysicalPlanCacheIdentity[]): number {
		const validKeysByFile = new Map<string, Set<string>>();
		for (const identity of validIdentities) {
			let keys = validKeysByFile.get(identity.filePath);
			if (!keys) {
				keys = new Set<string>();
				validKeysByFile.set(identity.filePath, keys);
			}
			keys.add(identity.key);
		}

		let removed = 0;
		for (const [key, entry] of this.completed) {
			const validKeys = validKeysByFile.get(entry.filePath);
			if (validKeys && !validKeys.has(key)) {
				this.completed.delete(key);
				removed += 1;
			}
		}
		for (const [key, entry] of this.inFlight) {
			const validKeys = validKeysByFile.get(entry.filePath);
			if (validKeys && !validKeys.has(key)) {
				this.inFlight.delete(key);
				removed += 1;
			}
		}
		return removed;
	}

	clear(): void {
		this.completed.clear();
		this.inFlight.clear();
	}

	private storeCompleted(
		identity: PhysicalPlanCacheIdentity,
		value: T,
	): void {
		this.completed.delete(identity.key);
		this.completed.set(identity.key, {
			filePath: identity.filePath,
			...(identity.artworkFilePath
				? { artworkFilePath: identity.artworkFilePath }
				: {}),
			value,
		});

		while (this.completed.size > this.capacity) {
			const oldestKey = this.completed.keys().next().value;
			if (oldestKey === undefined) {
				break;
			}
			this.completed.delete(oldestKey);
		}
	}
}

function hashFingerprintText(value: string): string {
	let hash = 0xcbf29ce484222325n;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= BigInt(value.charCodeAt(index));
		hash = BigInt.asUintN(64, hash * 0x100000001b3n);
	}
	return hash.toString(16).padStart(16, '0');
}

function createCanonicalItemFingerprint(item: ItemCardData): object {
	return {
		filePath: item.filePath,
		name: item.name,
		description: item.description,
		detail: item.detail ?? null,
		imagePath: item.imagePath ?? null,
		sourceText: item.sourceText ?? null,
		sourceDisplayOverride: item.sourceDisplayOverride ?? null,
		hasImage: item.hasImage,
		rarity: item.rarity ?? null,
		attunement: item.attunement ?? null,
		source: item.source ?? null,
		damage: item.damage ?? null,
		damageTwoHanded: item.damageTwoHanded ?? null,
		range: item.range ?? null,
		properties: item.properties ? [...item.properties] : null,
		mastery: item.mastery ?? null,
		cost: item.cost ?? null,
		weight: item.weight ?? null,
		rawTags: [...item.rawTags],
		typeText: item.typeText ?? null,
		rarityText: item.rarityText ?? null,
		attunementText: item.attunementText ?? null,
		structuredFieldOrigins: createStructuredItemFieldOriginsSnapshot(item),
		manualRuleSegments: item.manualRuleSegments
			? [...item.manualRuleSegments]
			: null,
	};
}
