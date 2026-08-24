import type { PrintQueueEntrySnapshot } from '../models/print-queue';
import {
	createPrintQueueEntrySnapshot,
	normalizePrintQueueEntrySnapshot,
} from '../models/print-queue';
import type { SavedPrintSet } from '../models/saved-print-set';

export interface ActiveSavedPrintSetState {
	activeSet?: SavedPrintSet;
	dirty: boolean;
}

export type SavedPrintSetSessionRestoreStatus = 'none' | 'restored' | 'invalid';
export type SavedPrintSetLoadRisk = 'none' | 'unsaved-queue' | 'modified-active-set';
export type SavedPrintSetSessionListener = (activeSavedSetId: string | undefined) => void;

/** Validated association between the persisted live queue and one Saved Print Set. */
export class SavedPrintSetSession {
	private activeId: string | undefined;
	private cleanQueueFingerprint: string | undefined;
	private readonly listeners = new Set<SavedPrintSetSessionListener>();

	get activeSavedSetId(): string | undefined {
		return this.activeId;
	}

	subscribe(listener: SavedPrintSetSessionListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	restore(
		value: unknown,
		sets: readonly SavedPrintSet[],
	): SavedPrintSetSessionRestoreStatus {
		this.activeId = undefined;
		this.cleanQueueFingerprint = undefined;
		if (value === undefined || value === null) {
			return 'none';
		}
		if (typeof value !== 'string' || value.trim() !== value || !value) {
			return 'invalid';
		}
		const set = sets.find((candidate) => candidate.id === value);
		if (!set) {
			return 'invalid';
		}
		this.activeId = set.id;
		this.cleanQueueFingerprint = createSavedPrintSetQueueFingerprint(set.entries);
		return 'restored';
	}

	activate(id: string, cleanEntries: readonly PrintQueueEntrySnapshot[]): boolean {
		const changed = this.activeId !== id;
		this.activeId = id;
		this.cleanQueueFingerprint = createSavedPrintSetQueueFingerprint(cleanEntries);
		if (changed) {
			this.emit();
		}
		return changed;
	}

	clear(): boolean {
		const changed = this.activeId !== undefined;
		this.activeId = undefined;
		this.cleanQueueFingerprint = undefined;
		if (changed) {
			this.emit();
		}
		return changed;
	}

	clearIfActive(id: string): boolean {
		if (this.activeId === id) {
			return this.clear();
		}
		return false;
	}

	getState(
		sets: readonly SavedPrintSet[],
		queueEntries: readonly PrintQueueEntrySnapshot[],
	): ActiveSavedPrintSetState {
		if (!this.activeId || !this.cleanQueueFingerprint) {
			return { dirty: false };
		}
		const activeSet = sets.find((set) => set.id === this.activeId);
		if (!activeSet) {
			this.clear();
			return { dirty: false };
		}
		return {
			activeSet,
			dirty: createSavedPrintSetQueueFingerprint(queueEntries)
				!== this.cleanQueueFingerprint,
		};
	}

	private emit(): void {
		for (const listener of this.listeners) {
			listener(this.activeId);
		}
	}
}

export function getSavedPrintSetLoadRisk(
	state: ActiveSavedPrintSetState,
	queueEntries: readonly PrintQueueEntrySnapshot[],
): SavedPrintSetLoadRisk {
	if (queueEntries.length === 0 || (state.activeSet && !state.dirty)) {
		return 'none';
	}
	return state.activeSet ? 'modified-active-set' : 'unsaved-queue';
}

/** Canonical reusable queue state; intentionally excludes live queue IDs. */
export function createSavedPrintSetQueueFingerprint(
	entries: readonly PrintQueueEntrySnapshot[],
): string {
	return JSON.stringify(entries.flatMap((entry) => {
		const normalized = normalizePrintQueueEntrySnapshot(entry);
		return normalized ? [createPrintQueueEntrySnapshot(normalized)] : [];
	}));
}
