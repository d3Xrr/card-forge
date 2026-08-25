import {
	normalizeCardDesignProfile,
	type CardDensity,
	type CardDesignProfile,
	type ResolvedCardDensity,
} from '../models/card-design';
import { PRINT_TYPOGRAPHY } from './print-typography';

export type ArtworkPlanningPriority = 'balanced' | 'preserve' | 'content' | 'hidden';

export interface DensityPlanningPolicy {
	resolvedDensity: ResolvedCardDensity;
	bodyFontPoints: readonly number[];
	targetBodyFontPoints: number;
	minimumBodyFontPoints: number;
	capacityMultiplier: number;
	bodyLineHeight: number;
}

export interface CardDesignPlanningPolicy {
	requestedDensity: CardDensity;
	densityCandidates: readonly ResolvedCardDensity[];
	artworkPriority: ArtworkPlanningPriority;
}

export const PRINT_SAFE_MINIMUM_BODY_FONT_POINTS = PRINT_TYPOGRAPHY.body.minimumPoints;

export const DENSITY_PLANNING_POLICIES: Readonly<
	Record<ResolvedCardDensity, Readonly<DensityPlanningPolicy>>
> = Object.freeze({
	standard: Object.freeze({
		resolvedDensity: 'standard',
		bodyFontPoints: Object.freeze([10, 9.5, 9, 8.5, 8, 7.5, 7]),
		targetBodyFontPoints: 10,
		minimumBodyFontPoints: PRINT_SAFE_MINIMUM_BODY_FONT_POINTS,
		capacityMultiplier: 1,
		bodyLineHeight: 1.3,
	}),
	compact: Object.freeze({
		resolvedDensity: 'compact',
		bodyFontPoints: Object.freeze([9, 8.5, 8, 7.5, 7]),
		targetBodyFontPoints: 9,
		minimumBodyFontPoints: PRINT_SAFE_MINIMUM_BODY_FONT_POINTS,
		capacityMultiplier: 1.24,
		bodyLineHeight: 1.18,
	}),
});

export function createCardDesignPlanningPolicy(
	designInput: Readonly<CardDesignProfile>,
): CardDesignPlanningPolicy {
	const design = normalizeCardDesignProfile(designInput);
	return {
		requestedDensity: design.density,
		densityCandidates: design.density === 'auto'
			? ['standard', 'compact']
			: [design.density],
		artworkPriority: design.artworkSize === 'larger'
			? 'preserve'
			: design.artworkSize === 'minimal'
				? 'content'
				: design.artworkSize === 'hidden'
					? 'hidden'
					: 'balanced',
	};
}

export function resolvePlanningDensity(
	density: CardDensity,
): ResolvedCardDensity {
	return density === 'compact' ? 'compact' : 'standard';
}

export function withResolvedCardDensity(
	designInput: Readonly<CardDesignProfile>,
	density: ResolvedCardDensity,
): CardDesignProfile {
	return {
		...normalizeCardDesignProfile(designInput),
		density,
	};
}

export function getDensityPlanningPolicy(
	density: CardDensity,
): Readonly<DensityPlanningPolicy> {
	return DENSITY_PLANNING_POLICIES[resolvePlanningDensity(density)];
}

export function selectPreferredDensityBodyFontPoints(
	preferredPoints: number,
	density: CardDensity,
): number {
	const policy = getDensityPlanningPolicy(density);
	return Math.max(
		policy.minimumBodyFontPoints,
		Math.min(policy.targetBodyFontPoints, preferredPoints),
	);
}

export interface AutoDensityCandidate {
	resolvedDensity: ResolvedCardDensity;
	pageCount: number;
	exportable: boolean;
}

/** Auto selects Compact only when it is the least aggressive safe way to reduce pages. */
export function chooseAutoDensityCandidate<T extends AutoDensityCandidate>(
	standard: T,
	compact: T,
): T {
	if (!standard.exportable && compact.exportable) {
		return compact;
	}
	if (standard.exportable && !compact.exportable) {
		return standard;
	}
	return compact.pageCount < standard.pageCount ? compact : standard;
}

export function shouldPreserveFittedArtwork(
	designInput: Readonly<CardDesignProfile>,
): boolean {
	return createCardDesignPlanningPolicy(designInput).artworkPriority === 'preserve';
}
