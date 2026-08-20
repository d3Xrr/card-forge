export interface BrowserSelectionUpdate {
	selectedFilePath: string | null;
	selectionChanged: boolean;
}

export interface LatestRequestToken<TKey> {
	readonly generation: number;
	readonly key: TKey;
}

export interface PlanningSourceRevision {
	modifiedTime: number;
	size: number;
}

/** Keeps the current browser selection when a search result still contains it. */
export function reconcileVisibleSelection(
	currentFilePath: string | null,
	visibleFilePaths: readonly string[],
): BrowserSelectionUpdate {
	const selectedFilePath = currentFilePath !== null
		&& visibleFilePaths.includes(currentFilePath)
		? currentFilePath
		: visibleFilePaths[0] ?? null;
	return {
		selectedFilePath,
		selectionChanged: selectedFilePath !== currentFilePath,
	};
}

/** A null next key represents no selected item and therefore no planning request. */
export function shouldRequestSelectedPlan(
	previousPlanKey: string | null,
	nextPlanKey: string | null,
): boolean {
	return nextPlanKey !== null && nextPlanKey !== previousPlanKey;
}

export function isIndexedPlanningInputCurrent(
	indexedSource: PlanningSourceRevision | undefined,
	liveSource: PlanningSourceRevision | undefined,
	indexedHasArtwork: boolean,
	resolvedHasArtwork: boolean,
): boolean {
	return indexedSource !== undefined
		&& liveSource !== undefined
		&& indexedSource.modifiedTime === liveSource.modifiedTime
		&& indexedSource.size === liveSource.size
		&& indexedHasArtwork === resolvedHasArtwork;
}

/** Selects an already-planned page without consulting a planner. */
export function selectRelativePageIndex(
	currentPageIndex: number,
	offset: number,
	pageCount: number,
): number {
	const lastPageIndex = Math.max(0, pageCount - 1);
	return Math.min(
		Math.max(0, currentPageIndex + offset),
		lastPageIndex,
	);
}

/**
 * Allows completed work to remain reusable while preventing stale requests from
 * committing UI state after a newer request has begun.
 */
export class LatestRequestGate<TKey> {
	private generation = 0;
	private currentKey: TKey | undefined;

	begin(key: TKey): LatestRequestToken<TKey> {
		this.currentKey = key;
		return {
			generation: ++this.generation,
			key,
		};
	}

	isCurrent(token: LatestRequestToken<TKey>): boolean {
		return token.generation === this.generation
			&& Object.is(token.key, this.currentKey);
	}

	commitIfCurrent(
		token: LatestRequestToken<TKey>,
		commit: () => void,
	): boolean {
		if (!this.isCurrent(token)) {
			return false;
		}
		commit();
		return true;
	}

	invalidate(): void {
		this.generation += 1;
		this.currentKey = undefined;
	}
}

/**
 * Resolves one plan per stable queue entry, retaining warm plans across
 * quantity and ordering changes. Same-source entries may have different
 * effective overrides, so source paths are never used as plan-map identity.
 */
export async function resolveQueuePlanMap<TPlan>(
	entries: readonly { id: string; filePath: string }[],
	warmPlans: ReadonlyMap<string, TPlan>,
	lookupPlan: (entry: { id: string; filePath: string }) => Promise<TPlan>,
	shouldContinue: () => boolean = () => true,
): Promise<Map<string, TPlan>> {
	const resolved = new Map<string, TPlan>();
	for (const entry of entries) {
		if (resolved.has(entry.id)) {
			continue;
		}
		if (warmPlans.has(entry.id)) {
			resolved.set(entry.id, warmPlans.get(entry.id) as TPlan);
			continue;
		}
		if (!shouldContinue()) {
			break;
		}
		resolved.set(entry.id, await lookupPlan(entry));
	}
	return resolved;
}

/** Verifies materialized queue plans against freshly computed effective keys. */
export function areQueuePlanInputsCurrent(
	plans: readonly { entryId: string; cacheKey?: string }[],
	getCurrentKey: (entryId: string) => string | undefined,
): boolean {
	return plans.every((plan) =>
		plan.cacheKey !== undefined
		&& getCurrentKey(plan.entryId) === plan.cacheKey,
	);
}
