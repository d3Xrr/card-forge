import type { CardOverrides } from './card-overrides';
import {
	createPrintQueueEntrySnapshot,
	normalizePrintQueueEntrySnapshot,
	type PrintQueueEntry,
	type PrintQueueEntrySnapshot,
	type PrintQueueService,
} from './print-queue';

export type SavedPrintSetEntry = PrintQueueEntrySnapshot;

export interface SavedPrintSet {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
	entries: SavedPrintSetEntry[];
}

export type SavedPrintSetListener = (sets: readonly SavedPrintSet[]) => void;

export type SavePrintSetResult =
	| { status: 'created' | 'replaced'; set: SavedPrintSet; containsTemporaryArtwork: boolean }
	| { status: 'duplicate-name'; existing: SavedPrintSet }
	| { status: 'empty-queue' | 'invalid-name' };

export type RenamePrintSetResult =
	| { status: 'renamed'; set: SavedPrintSet }
	| { status: 'duplicate-name'; existing: SavedPrintSet }
	| { status: 'invalid-name' | 'not-found' };

export type LoadPrintSetResult =
	| {
		status: 'loaded';
		set: SavedPrintSet;
		entries: PrintQueueEntry[];
		missingCount: number;
		totalCopies: number;
		containsTemporaryArtwork: boolean;
	}
	| { status: 'requires-confirmation'; set: SavedPrintSet; missingCount: number }
	| { status: 'no-resolvable-entries'; set: SavedPrintSet; missingCount: number }
	| { status: 'not-found' };

export interface SavedPrintSetHydrationResult {
	sets: SavedPrintSet[];
	repaired: boolean;
}

export class SavedPrintSetService {
	private sets: SavedPrintSet[];
	private readonly listeners = new Set<SavedPrintSetListener>();
	readonly hydrationRepaired: boolean;

	constructor(
		initialSets: unknown = [],
		private readonly createId: () => string = createSavedPrintSetId,
		private readonly now: () => number = () => Date.now(),
	) {
		const hydration = hydrateSavedPrintSets(initialSets, this.createId, this.now);
		this.sets = hydration.sets;
		this.hydrationRepaired = hydration.repaired;
	}

	getSets(): readonly SavedPrintSet[] {
		return this.sets;
	}

	getSet(id: string): SavedPrintSet | undefined {
		return getUniqueSavedPrintSetById(this.sets, id);
	}

	subscribe(listener: SavedPrintSetListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	save(
		name: string,
		queueEntries: readonly PrintQueueEntry[],
		replaceExisting = false,
	): SavePrintSetResult {
		const normalizedName = normalizeSavedPrintSetName(name);
		if (!normalizedName) {
			return { status: 'invalid-name' };
		}
		if (queueEntries.length === 0) {
			return { status: 'empty-queue' };
		}
		const existing = this.findByName(normalizedName);
		if (existing && !replaceExisting) {
			return { status: 'duplicate-name', existing };
		}
		const entries = queueEntries.map(createPrintQueueEntrySnapshot);
		const updatedAt = this.now();
		if (existing) {
			existing.name = normalizedName;
			existing.entries = entries;
			existing.updatedAt = updatedAt;
			this.sortSets();
			this.emit();
			return {
				status: 'replaced',
				set: existing,
				containsTemporaryArtwork: containsTemporaryArtwork(entries),
			};
		}

		const set: SavedPrintSet = {
			id: createUniqueSavedPrintSetId(
				new Set(this.sets.map((candidate) => candidate.id)),
				this.createId,
			),
			name: normalizedName,
			createdAt: updatedAt,
			updatedAt,
			entries,
		};
		this.sets.push(set);
		this.sortSets();
		this.emit();
		return {
			status: 'created',
			set,
			containsTemporaryArtwork: containsTemporaryArtwork(entries),
		};
	}

	rename(id: string, name: string): RenamePrintSetResult {
		const set = this.getSet(id);
		if (!set) {
			return { status: 'not-found' };
		}
		const normalizedName = normalizeSavedPrintSetName(name);
		if (!normalizedName) {
			return { status: 'invalid-name' };
		}
		const duplicate = this.findByName(normalizedName);
		if (duplicate && duplicate !== set) {
			return { status: 'duplicate-name', existing: duplicate };
		}
		set.name = normalizedName;
		set.updatedAt = this.now();
		this.sortSets();
		this.emit();
		return { status: 'renamed', set };
	}

	delete(id: string): boolean {
		const set = this.getSet(id);
		if (!set) {
			return false;
		}
		this.sets = this.sets.filter((candidate) => candidate !== set);
		this.emit();
		return true;
	}

	loadIntoQueue(
		id: string,
		queue: PrintQueueService,
		availableFilePaths: ReadonlySet<string>,
		replaceNonEmpty = false,
	): LoadPrintSetResult {
		const set = this.getSet(id);
		if (!set) {
			return { status: 'not-found' };
		}
		const resolvable = set.entries.filter((entry) => availableFilePaths.has(entry.filePath));
		const missingCount = set.entries.length - resolvable.length;
		if (resolvable.length === 0) {
			return { status: 'no-resolvable-entries', set, missingCount };
		}
		if (queue.getEntries().length > 0 && !replaceNonEmpty) {
			return { status: 'requires-confirmation', set, missingCount };
		}
		const result = queue.replaceWithSnapshots(resolvable);
		return {
			status: 'loaded',
			set,
			entries: result.entries,
			missingCount: missingCount + result.rejected,
			totalCopies: result.entries.reduce((sum, entry) => sum + entry.quantity, 0),
			containsTemporaryArtwork: containsTemporaryArtwork(resolvable),
		};
	}

	serialize(): SavedPrintSet[] {
		return serializeSavedPrintSets(this.sets);
	}

	private findByName(name: string): SavedPrintSet | undefined {
		const key = normalizeSavedPrintSetNameKey(name);
		return this.sets.find((set) => normalizeSavedPrintSetNameKey(set.name) === key);
	}

	private sortSets(): void {
		this.sets.sort(compareSavedPrintSets);
	}

	private emit(): void {
		for (const listener of this.listeners) {
			listener(this.sets);
		}
	}
}

export function serializeSavedPrintSets(
	sets: readonly SavedPrintSet[],
): SavedPrintSet[] {
	return sets.map((set) => ({
		id: set.id,
		name: set.name,
		createdAt: set.createdAt,
		updatedAt: set.updatedAt,
		entries: set.entries.map(createPrintQueueEntrySnapshot),
	}));
}

export function hydrateSavedPrintSets(
	value: unknown,
	createId: () => string = createSavedPrintSetId,
	now: () => number = () => Date.now(),
): SavedPrintSetHydrationResult {
	if (!Array.isArray(value)) {
		return { sets: [], repaired: value !== undefined && value !== null };
	}
	const candidates: SavedPrintSet[] = [];
	let repaired = false;
	for (const valueSet of value) {
		if (!isRecord(valueSet)) {
			repaired = true;
			continue;
		}
		const name = typeof valueSet.name === 'string'
			? normalizeSavedPrintSetName(valueSet.name)
			: '';
		const rawEntries = Array.isArray(valueSet.entries) ? valueSet.entries : [];
		const entries = rawEntries.flatMap((entry) => {
			const normalized = normalizePrintQueueEntrySnapshot(entry);
			return normalized ? [normalized] : [];
		});
		if (!name || entries.length === 0) {
			repaired = true;
			continue;
		}
		const createdAt = normalizeTimestamp(valueSet.createdAt, now());
		const updatedAt = normalizeTimestamp(valueSet.updatedAt, createdAt);
		const id = typeof valueSet.id === 'string' ? valueSet.id.trim() : '';
		if (
			!id
			|| createdAt !== valueSet.createdAt
			|| updatedAt !== valueSet.updatedAt
			|| entries.length !== rawEntries.length
			|| name !== valueSet.name
		) {
			repaired = true;
		}
		candidates.push({ id, name, createdAt, updatedAt, entries });
	}

	candidates.sort(compareSavedPrintSets);
	const sets: SavedPrintSet[] = [];
	const usedIds = new Set<string>();
	const usedNames = new Set<string>();
	const blockedIds = new Set(candidates.map((candidate) => candidate.id).filter(Boolean));
	for (const candidate of candidates) {
		const nameKey = normalizeSavedPrintSetNameKey(candidate.name);
		if (usedNames.has(nameKey)) {
			repaired = true;
			continue;
		}
		const id = candidate.id && !usedIds.has(candidate.id)
			? candidate.id
			: createUniqueSavedPrintSetId(blockedIds, createId);
		if (id !== candidate.id) {
			repaired = true;
		}
		usedIds.add(id);
		blockedIds.add(id);
		usedNames.add(nameKey);
		sets.push({ ...candidate, id });
	}
	return { sets, repaired };
}

export function containsTemporaryArtwork(
	entries: Iterable<{ overrides?: CardOverrides }>,
): boolean {
	for (const entry of entries) {
		if (entry.overrides?.artwork?.kind === 'temporary') {
			return true;
		}
	}
	return false;
}

function normalizeSavedPrintSetName(name: string): string {
	return name.trim().replace(/\s+/gu, ' ');
}

function normalizeSavedPrintSetNameKey(name: string): string {
	return normalizeSavedPrintSetName(name).toLocaleLowerCase();
}

function compareSavedPrintSets(left: SavedPrintSet, right: SavedPrintSet): number {
	return right.updatedAt - left.updatedAt
		|| left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function normalizeTimestamp(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: fallback;
}

function createSavedPrintSetId(): string {
	return window.crypto?.randomUUID?.()
		?? `saved-set-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createUniqueSavedPrintSetId(
	usedIds: ReadonlySet<string>,
	createId: () => string,
): string {
	const generated = createId().trim() || createSavedPrintSetId();
	if (!usedIds.has(generated)) {
		return generated;
	}
	let suffix = 2;
	while (usedIds.has(`${generated}-${suffix}`)) {
		suffix += 1;
	}
	return `${generated}-${suffix}`;
}

function getUniqueSavedPrintSetById(
	sets: readonly SavedPrintSet[],
	id: string,
): SavedPrintSet | undefined {
	const normalizedId = id.trim();
	if (!normalizedId) {
		return undefined;
	}
	let match: SavedPrintSet | undefined;
	for (const set of sets) {
		if (set.id !== normalizedId) {
			continue;
		}
		if (match) {
			return undefined;
		}
		match = set;
	}
	return match;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
