import type { CardOverrides } from './card-overrides';
import {
	areCardOverridesEqual,
	normalizeCardOverrides,
} from '../services/card-overrides';

export interface PrintQueueEntry {
	id: string;
	filePath: string;
	quantity: number;
	overrides?: CardOverrides;
}

export type PrintQueueListener = (entries: readonly PrintQueueEntry[]) => void;

export interface PrintQueueHydrationResult {
	entries: PrintQueueEntry[];
	repaired: boolean;
}

export interface PrintQueueAddInput {
	filePath: string;
	overrides?: CardOverrides;
}

export interface PrintQueueBatchAddResult {
	entries: PrintQueueEntry[];
	rejected: number;
}

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

	add(filePath: string, overrides?: CardOverrides): PrintQueueEntry {
		const entry = this.addWithoutEmitting(filePath, overrides);
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
			entries.push(this.addWithoutEmitting(input.filePath, input.overrides));
		}
		if (entries.length > 0) {
			this.emit();
		}
		return { entries, rejected };
	}

	private addWithoutEmitting(filePath: string, overrides?: CardOverrides): PrintQueueEntry {
		const normalizedPath = filePath.trim();
		const normalizedOverrides = normalizeCardOverrides(overrides);
		const existing = this.entries.find((entry) =>
			entry.filePath === normalizedPath
			&& areCardOverridesEqual(entry.overrides, normalizedOverrides));
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
		};
		this.entries.push(entry);
		return entry;
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
	return entries.map((entry) => ({
		...entry,
		...(entry.overrides
			? { overrides: structuredClone(entry.overrides) }
			: {}),
	}));
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
		if (!isRecord(candidate)) {
			repaired = true;
			continue;
		}
		const persistedId = typeof candidate.id === 'string' ? candidate.id.trim() : '';
		const filePath = typeof candidate.filePath === 'string'
			? candidate.filePath.trim()
			: '';
		const quantity = candidate.quantity === undefined
			? 1
			: typeof candidate.quantity === 'number'
				? Math.floor(candidate.quantity)
				: 0;
		if (candidate.quantity === undefined) {
			repaired = true;
		}
		if (!filePath || quantity < 1) {
			repaired = true;
			continue;
		}
		const overrides = normalizeCardOverrides(candidate.overrides);

		const existing = entries.find((entry) =>
			entry.filePath === filePath
			&& areCardOverridesEqual(entry.overrides, overrides));
		if (existing) {
			existing.quantity += quantity;
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
			entries.push({
				id,
				filePath,
				quantity,
				...(overrides ? { overrides } : {}),
			});
		}
	}
	return { entries, repaired };
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
