export interface PrintQueueEntry {
	id: string;
	filePath: string;
	quantity: number;
}

export type PrintQueueListener = (entries: readonly PrintQueueEntry[]) => void;

export class PrintQueueService {
	private entries: PrintQueueEntry[];
	private readonly listeners = new Set<PrintQueueListener>();

	constructor(
		initialEntries: readonly PrintQueueEntry[] = [],
		private readonly createId: () => string = createQueueEntryId,
	) {
		this.entries = deserializePrintQueue(initialEntries);
	}

	getEntries(): readonly PrintQueueEntry[] {
		return this.entries;
	}

	subscribe(listener: PrintQueueListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	add(filePath: string): PrintQueueEntry {
		const normalizedPath = filePath.trim();
		const existing = this.entries.find((entry) => entry.filePath === normalizedPath);
		if (existing) {
			existing.quantity += 1;
			this.emit();
			return existing;
		}

		const entry: PrintQueueEntry = {
			id: this.createId(),
			filePath: normalizedPath,
			quantity: 1,
		};
		this.entries.push(entry);
		this.emit();
		return entry;
	}

	increment(id: string): void {
		const entry = this.find(id);
		if (!entry) {
			return;
		}
		entry.quantity += 1;
		this.emit();
	}

	decrement(id: string): void {
		const entry = this.find(id);
		if (!entry || entry.quantity <= 1) {
			return;
		}
		entry.quantity -= 1;
		this.emit();
	}

	remove(id: string): void {
		const next = this.entries.filter((entry) => entry.id !== id);
		if (next.length === this.entries.length) {
			return;
		}
		this.entries = next;
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
		const index = this.entries.findIndex((entry) => entry.id === id);
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

	private find(id: string): PrintQueueEntry | undefined {
		return this.entries.find((entry) => entry.id === id);
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
	return entries.map((entry) => ({ ...entry }));
}

export function deserializePrintQueue(value: unknown): PrintQueueEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const entries: PrintQueueEntry[] = [];
	for (const candidate of value) {
		if (!isRecord(candidate)) {
			continue;
		}
		const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
		const filePath = typeof candidate.filePath === 'string'
			? candidate.filePath.trim()
			: '';
		const quantity = typeof candidate.quantity === 'number'
			? Math.floor(candidate.quantity)
			: 0;
		if (!id || !filePath || quantity < 1) {
			continue;
		}

		const existing = entries.find((entry) => entry.filePath === filePath);
		if (existing) {
			existing.quantity += quantity;
		} else {
			entries.push({ id, filePath, quantity });
		}
	}
	return entries;
}

function createQueueEntryId(): string {
	return window.crypto?.randomUUID?.()
		?? `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
