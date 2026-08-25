import type { CardOverrides } from './card-overrides';
import type { CardDesignProfile } from './card-design';
import {
	areCardDesignProfilesEqual,
	cloneCardDesignProfile,
	normalizeCardDesignProfile,
} from './card-design';
import {
	areCardOverridesEqual,
	normalizeCardOverrides,
} from '../services/card-overrides';

export interface PrintQueueEntrySnapshot {
	filePath: string;
	quantity: number;
	overrides?: CardOverrides;
	/** Resolved design snapshot. Missing means the stable pre-0.7.0 legacy profile. */
	design?: CardDesignProfile;
	/** Preserve an intentionally separate logical entry even when its printable state matches another. */
	separate?: true;
}

export interface PrintQueueEntry extends PrintQueueEntrySnapshot {
	id: string;
}

export type PrintQueueListener = (entries: readonly PrintQueueEntry[]) => void;

export interface PrintQueueHydrationResult {
	entries: PrintQueueEntry[];
	repaired: boolean;
}

export interface PrintQueueAddInput {
	filePath: string;
	overrides?: CardOverrides;
	design?: CardDesignProfile;
}

export interface PrintQueueBatchAddResult {
	entries: PrintQueueEntry[];
	rejected: number;
}

export type PrintQueueReplaceResult = PrintQueueBatchAddResult;

export class PrintQueueService {
	private entries: PrintQueueEntry[];
	private readonly listeners = new Set<PrintQueueListener>();
	readonly hydrationRepaired: boolean;

	constructor(
		initialEntries: unknown = [],
		private readonly createId: () => string = createQueueEntryId,
	) {
		const hydration = hydratePrintQueue(initialEntries, this.createId);
		this.entries = hydration.entries;
		this.hydrationRepaired = hydration.repaired;
	}

	getEntries(): readonly PrintQueueEntry[] {
		return this.entries;
	}

	subscribe(listener: PrintQueueListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	add(
		filePath: string,
		overrides?: CardOverrides,
		design?: CardDesignProfile,
	): PrintQueueEntry {
		const entry = this.addWithoutEmitting(filePath, overrides, design);
		this.emit();
		return entry;
	}

	addMany(inputs: readonly PrintQueueAddInput[]): PrintQueueBatchAddResult {
		const entries: PrintQueueEntry[] = [];
		let rejected = 0;
		for (const input of inputs) {
			if (!input.filePath.trim()) {
				rejected += 1;
				continue;
			}
			entries.push(this.addWithoutEmitting(
				input.filePath,
				input.overrides,
				input.design,
			));
		}
		if (entries.length > 0) {
			this.emit();
		}
		return { entries, rejected };
	}

	private addWithoutEmitting(
		filePath: string,
		overrides?: CardOverrides,
		design?: CardDesignProfile,
	): PrintQueueEntry {
		const normalizedPath = filePath.trim();
		const normalizedOverrides = normalizeCardOverrides(overrides);
		const normalizedDesign = design
			? normalizeCardDesignProfile(design)
			: undefined;
		const existing = this.entries.find((entry) =>
			!entry.separate
			&& entry.filePath === normalizedPath
			&& areCardOverridesEqual(entry.overrides, normalizedOverrides)
			&& areCardDesignProfilesEqual(entry.design, normalizedDesign));
		if (existing) {
			existing.quantity += 1;
			return existing;
		}

		const entry: PrintQueueEntry = {
			id: createUniqueQueueEntryId(
				new Set(this.entries.map((candidate) => candidate.id)),
				this.createId,
			),
			filePath: normalizedPath,
			quantity: 1,
			...(normalizedOverrides ? { overrides: normalizedOverrides } : {}),
			...(normalizedDesign ? { design: normalizedDesign } : {}),
		};
		this.entries.push(entry);
		return entry;
	}

	duplicate(id: string): PrintQueueEntry | undefined {
		const source = this.getEntry(id);
		if (!source) {
			return undefined;
		}
		const duplicate: PrintQueueEntry = {
			id: createUniqueQueueEntryId(
				new Set(this.entries.map((candidate) => candidate.id)),
				this.createId,
			),
			...createPrintQueueEntrySnapshot(source),
			separate: true,
		};
		const sourceIndex = this.entries.indexOf(source);
		this.entries.splice(sourceIndex + 1, 0, duplicate);
		this.emit();
		return duplicate;
	}

	replaceWithSnapshots(
		values: readonly PrintQueueEntrySnapshot[],
	): PrintQueueReplaceResult {
		const entries: PrintQueueEntry[] = [];
		const usedIds = new Set<string>();
		let rejected = 0;
		for (const value of values) {
			const snapshot = normalizePrintQueueEntrySnapshot(value);
			if (!snapshot) {
				rejected += 1;
				continue;
			}
			const id = createUniqueQueueEntryId(usedIds, this.createId);
			usedIds.add(id);
			entries.push({ id, ...snapshot });
		}
		this.entries = entries;
		this.emit();
		return { entries, rejected };
	}

	updateOverrides(id: string, overrides?: CardOverrides): boolean {
		const entry = this.getEntry(id);
		if (!entry) {
			return false;
		}
		const normalized = normalizeCardOverrides(overrides);
		if (areCardOverridesEqual(entry.overrides, normalized)) {
			return true;
		}
		if (normalized) {
			entry.overrides = normalized;
		} else {
			delete entry.overrides;
		}
		this.emit();
		return true;
	}

	/** Atomically persists the content and design halves of one editor draft. */
	updateCard(
		id: string,
		overrides: CardOverrides | undefined,
		design: CardDesignProfile,
	): boolean {
		const entry = this.getEntry(id);
		if (!entry) {
			return false;
		}
		const normalizedOverrides = normalizeCardOverrides(overrides);
		const normalizedDesign = normalizeCardDesignProfile(design);
		if (normalizedOverrides) {
			entry.overrides = normalizedOverrides;
		} else {
			delete entry.overrides;
		}
		entry.design = normalizedDesign;
		this.emit();
		return true;
	}

	updateDesign(id: string, design: CardDesignProfile): boolean {
		const entry = this.getEntry(id);
		if (!entry) {
			return false;
		}
		const normalized = normalizeCardDesignProfile(design);
		if (areCardDesignProfilesEqual(entry.design, normalized)) {
			return true;
		}
		entry.design = normalized;
		this.emit();
		return true;
	}

	promoteTemporaryArtworkReferences(
		vaultPaths: ReadonlyMap<string, string>,
	): number {
		let changed = 0;
		for (const entry of this.entries) {
			const artwork = entry.overrides?.artwork;
			if (artwork?.kind !== 'temporary') {
				continue;
			}
			const path = vaultPaths.get(artwork.id)?.trim();
			if (!path) {
				continue;
			}
			entry.overrides = {
				...entry.overrides,
				artwork: { kind: 'vault', path },
			};
			changed += 1;
		}
		if (changed > 0) {
			this.emit();
		}
		return changed;
	}

	increment(id: string): void {
		const entry = this.getEntry(id);
		if (!entry) {
			return;
		}
		entry.quantity += 1;
		this.emit();
	}

	decrement(id: string): void {
		const entry = this.getEntry(id);
		if (!entry || entry.quantity <= 1) {
			return;
		}
		entry.quantity -= 1;
		this.emit();
	}

	remove(id: string): void {
		const entry = this.getEntry(id);
		if (!entry) {
			return;
		}
		this.entries = this.entries.filter((candidate) => candidate !== entry);
		this.emit();
	}

	clear(): void {
		if (this.entries.length === 0) {
			return;
		}
		this.entries = [];
		this.emit();
	}

	move(id: string, direction: -1 | 1): void {
		const target = this.getEntry(id);
		if (!target) {
			return;
		}
		const index = this.entries.indexOf(target);
		const destination = index + direction;
		if (index < 0 || destination < 0 || destination >= this.entries.length) {
			return;
		}
		const entry = this.entries[index];
		const displaced = this.entries[destination];
		if (!entry || !displaced) {
			return;
		}
		this.entries[index] = displaced;
		this.entries[destination] = entry;
		this.emit();
	}

	serialize(): PrintQueueEntry[] {
		return serializePrintQueue(this.entries);
	}

	getEntry(id: string): PrintQueueEntry | undefined {
		return getUniqueQueueEntryById(this.entries, id);
	}

	private emit(): void {
		for (const listener of this.listeners) {
			listener(this.entries);
		}
	}
}

export function serializePrintQueue(
	entries: readonly PrintQueueEntry[],
): PrintQueueEntry[] {
	return entries.map((entry) => ({ id: entry.id, ...createPrintQueueEntrySnapshot(entry) }));
}

export function createPrintQueueEntrySnapshot(
	entry: PrintQueueEntrySnapshot,
): PrintQueueEntrySnapshot {
	return {
		filePath: entry.filePath,
		quantity: entry.quantity,
		...(entry.overrides ? { overrides: structuredClone(entry.overrides) } : {}),
		...(entry.design ? { design: cloneCardDesignProfile(entry.design) } : {}),
		...(entry.separate ? { separate: true as const } : {}),
	};
}

export function normalizePrintQueueEntrySnapshot(
	value: unknown,
): PrintQueueEntrySnapshot | undefined {
	return parsePrintQueueEntrySnapshot(value).snapshot;
}

export function deserializePrintQueue(
	value: unknown,
	createId: () => string = createQueueEntryId,
): PrintQueueEntry[] {
	return hydratePrintQueue(value, createId).entries;
}

export function hydratePrintQueue(
	value: unknown,
	createId: () => string = createQueueEntryId,
): PrintQueueHydrationResult {
	if (!Array.isArray(value)) {
		return { entries: [], repaired: value !== undefined && value !== null };
	}

	const entries: PrintQueueEntry[] = [];
	const usedIds = new Set<string>();
	const blockedIds = new Set(value.flatMap((candidate) => {
		if (!isRecord(candidate) || typeof candidate.id !== 'string') {
			return [];
		}
		const id = candidate.id.trim();
		return id ? [id] : [];
	}));
	let repaired = false;
	for (const candidate of value) {
		const parsed = parsePrintQueueEntrySnapshot(candidate);
		if (!parsed.snapshot) {
			repaired = true;
			continue;
		}
		const snapshot = parsed.snapshot;
		repaired ||= parsed.repaired;
		if (!isRecord(candidate)) {
			continue;
		}
		const persistedId = typeof candidate.id === 'string' ? candidate.id.trim() : '';

		const existing = snapshot.separate
			? undefined
			: entries.find((entry) =>
				!entry.separate
				&& entry.filePath === snapshot.filePath
				&& areCardOverridesEqual(entry.overrides, snapshot.overrides)
				&& areCardDesignProfilesEqual(entry.design, snapshot.design));
		if (existing) {
			existing.quantity += snapshot.quantity;
			repaired = true;
		} else {
			const id = persistedId && !usedIds.has(persistedId)
				? persistedId
				: createUniqueQueueEntryId(blockedIds, createId);
			if (id !== persistedId) {
				repaired = true;
			}
			usedIds.add(id);
			blockedIds.add(id);
			entries.push({ id, ...snapshot });
		}
	}
	return { entries, repaired };
}

function parsePrintQueueEntrySnapshot(value: unknown): {
	snapshot?: PrintQueueEntrySnapshot;
	repaired: boolean;
} {
	if (!isRecord(value)) {
		return { repaired: true };
	}
	const filePath = typeof value.filePath === 'string' ? value.filePath.trim() : '';
	const quantity = value.quantity === undefined
		? 1
		: typeof value.quantity === 'number'
			? Math.floor(value.quantity)
			: 0;
	if (!filePath || quantity < 1) {
		return { repaired: true };
	}
	const overrides = normalizeCardOverrides(value.overrides);
	const design = isRecord(value.design)
		? normalizeCardDesignProfile(value.design)
		: undefined;
	return {
		snapshot: {
			filePath,
			quantity,
			...(overrides ? { overrides } : {}),
			...(design ? { design } : {}),
			...(value.separate === true ? { separate: true as const } : {}),
		},
		repaired: value.quantity === undefined
			|| (value.separate !== undefined && value.separate !== true)
			|| (value.design !== undefined && !isRecord(value.design)),
	};
}

function createQueueEntryId(): string {
	return window.crypto?.randomUUID?.()
		?? `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createUniqueQueueEntryId(
	usedIds: ReadonlySet<string>,
	createId: () => string,
): string {
	const generated = createId().trim() || createQueueEntryId();
	if (!usedIds.has(generated)) {
		return generated;
	}
	let suffix = 2;
	while (usedIds.has(`${generated}-${suffix}`)) {
		suffix += 1;
	}
	return `${generated}-${suffix}`;
}

export function getUniqueQueueEntryById(
	entries: readonly PrintQueueEntry[],
	id: string,
): PrintQueueEntry | undefined {
	const normalizedId = id.trim();
	if (!normalizedId) {
		return undefined;
	}
	let match: PrintQueueEntry | undefined;
	for (const entry of entries) {
		if (entry.id !== normalizedId) {
			continue;
		}
		if (match) {
			return undefined;
		}
		match = entry;
	}
	return match;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
