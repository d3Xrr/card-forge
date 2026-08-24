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

/** Plugin-lifetime association between the live queue and one Saved Print Set. */
export class SavedPrintSetSession {
	private activeId: string | undefined;
	private cleanQueueFingerprint: string | undefined;

	get activeSavedSetId(): string | undefined {
		return this.activeId;
	}

	activate(id: string, cleanEntries: readonly PrintQueueEntrySnapshot[]): void {
		this.activeId = id;
		this.cleanQueueFingerprint = createSavedPrintSetQueueFingerprint(cleanEntries);
	}

	clear(): void {
		this.activeId = undefined;
		this.cleanQueueFingerprint = undefined;
	}

	clearIfActive(id: string): void {
		if (this.activeId === id) {
			this.clear();
		}
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
