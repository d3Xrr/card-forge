import {
	createStructuredItemFieldOriginsSnapshot,
	type ItemCardData,
} from '../models/item';
import {
	createLayoutDesignFingerprint,
	LEGACY_CARD_DESIGN_PROFILE,
	normalizeCardDesignProfile,
	type CardDesignProfile,
	type ResolvedCardDensity,
} from '../models/card-design';
import type {
	ArtworkOrientation,
	CompactStatRowSpan,
	ItemCardPage,
} from '../models/item-card-page';
import {
	createCanonicalMeasurementRoot,
	PHYSICAL_CARD_PROFILE,
} from '../models/physical-card-profile';
import { ArtworkBoundsService } from './artwork-bounds';
import { classifyArtworkOrientation } from './artwork-orientation';
import { compactContinuationPages } from './item-card-compactor';
import {
	chooseAutoDensityCandidate,
	getMonotonicDensityBodyFontCandidates,
	shouldPreserveFittedArtwork,
	withResolvedCardDensity,
} from './card-design-policy';
import {
	ItemCardRenderer,
	type ArtworkLoadResult,
} from './item-card-renderer';
import {
	createMemoizedItemCardPagePlanner,
	prepareItemCardPlanningContext,
	type ItemCardPagePlanner,
} from './item-card-planner';
import {
	buildItemStatRows,
	getCompactStatRowSpans,
	promoteUnsafeCompactStatPairs,
	type CompactStatCellWidth,
} from './structured-item-stats';
import type { PlanningPerformanceTrace } from '../services/planning-performance';

export interface FittedItemCardPlan {
	pages: ItemCardPage[];
	artworkResult: ArtworkLoadResult;
	capacityScale: number;
	bodyFontPoints: number;
	resolvedDensity: ResolvedCardDensity;
	unfitPageIndexes: ReadonlySet<number>;
}

export const ITEM_CARD_FIT_CAPACITY_SCALES = Object.freeze([
	1,
	0.88,
	0.76,
	0.66,
	0.55,
	0.45,
	0.35,
	0.25,
] as const);

export interface AdaptiveBodyFit<T> {
	bodyFontPoints: number;
	pageCount: number;
	value: T;
}

export async function findBestAdaptiveBodyFit<T>(
	bodyFontPoints: readonly number[],
	attempt: (points: number) => Promise<{ pageCount: number; value: T } | undefined>,
	minimumPageCount = 0,
): Promise<AdaptiveBodyFit<T> | undefined> {
	let best: AdaptiveBodyFit<T> | undefined;
	for (const points of bodyFontPoints) {
		const result = await attempt(points);
		if (!result) {
			continue;
		}
		const candidate = { bodyFontPoints: points, ...result };
		if (!best
			|| candidate.pageCount < best.pageCount
			|| (candidate.pageCount === best.pageCount
				&& candidate.bodyFontPoints > best.bodyFontPoints)) {
			best = candidate;
		}
		if (best.pageCount <= minimumPageCount) {
			break;
		}
	}
	return best;
}

export interface ArtworkPriorityFit<T> extends AdaptiveBodyFit<T> {
	showArtwork: boolean;
}

export function chooseArtworkPriorityFit<T>(
	withArtwork: AdaptiveBodyFit<T> | undefined,
	withoutArtwork: AdaptiveBodyFit<T> | undefined,
	maximumArtworkPagePenalty = 1,
): ArtworkPriorityFit<T> | undefined {
	if (withArtwork
		&& (!withoutArtwork
			|| withArtwork.pageCount <= withoutArtwork.pageCount + maximumArtworkPagePenalty)) {
		return { ...withArtwork, showArtwork: true };
	}
	return withoutArtwork
		? { ...withoutArtwork, showArtwork: false }
		: withArtwork
			? { ...withArtwork, showArtwork: true }
			: undefined;
}

interface MeasuredFit {
	pages: ItemCardPage[];
	capacityScale: number;
	unfitPageIndexes: ReadonlySet<number>;
}

interface PageMeasurementCache {
	values: Map<string, Promise<boolean>>;
	statPackingValues: Map<string, Promise<CompactStatRowSpan[] | undefined>>;
	artworkFingerprint?: string;
}

const ARTWORK_SHARE_CANDIDATES = [undefined, 20, 16] as const;
const MAXIMUM_ARTWORK_PAGE_PENALTY = 1;
export const ITEM_CARD_MEASUREMENT_RENDER_REVISION = 'item-card-renderer-css-v7-stat-width';

export class ItemCardFitService {
	constructor(
		private readonly renderer: ItemCardRenderer,
		private readonly artworkBounds: ArtworkBoundsService = new ArtworkBoundsService(),
	) {}

	async fit(
		document: Document,
		item: ItemCardData,
		artworkResourcePath?: string,
		performanceTrace?: PlanningPerformanceTrace,
		artworkFingerprint = artworkResourcePath,
		designInput: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
	): Promise<FittedItemCardPlan> {
		const design = normalizeCardDesignProfile(designInput);
		if (design.density === 'standard') {
			return this.fitResolved(
				document,
				item,
				artworkResourcePath,
				performanceTrace,
				artworkFingerprint,
				design,
			);
		}
		const standard = await this.fitResolved(
			document,
			item,
			artworkResourcePath,
			performanceTrace,
			artworkFingerprint,
			withResolvedCardDensity(design, 'standard'),
		);
		if (design.density === 'auto'
			&& standard.unfitPageIndexes.size === 0
			&& standard.pages.length <= 1) {
			return standard;
		}
		const compact = await this.fitResolved(
			document,
			item,
			artworkResourcePath,
			performanceTrace,
			artworkFingerprint,
			withResolvedCardDensity(design, 'compact'),
			standard.bodyFontPoints,
		);
		if (design.density === 'compact') {
			return compact;
		}
		const selected = chooseAutoDensityCandidate(
			{
				plan: standard,
				resolvedDensity: 'standard',
				pageCount: standard.pages.length,
				exportable: standard.unfitPageIndexes.size === 0,
			},
			{
				plan: compact,
				resolvedDensity: 'compact',
				pageCount: compact.pages.length,
				exportable: compact.unfitPageIndexes.size === 0,
			},
		);
		return selected.plan;
	}

	private async fitResolved(
		document: Document,
		item: ItemCardData,
		artworkResourcePath: string | undefined,
		performanceTrace: PlanningPerformanceTrace | undefined,
		artworkFingerprint: string | undefined,
		designInput: Readonly<CardDesignProfile>,
		standardBodyFontCeiling?: number,
	): Promise<FittedItemCardPlan> {
		const design = normalizeCardDesignProfile(designInput);
		const resolvedDensity: ResolvedCardDensity = design.density === 'compact'
			? 'compact'
			: 'standard';
		const loadArtwork = () => loadArtworkOrientation(
			document,
			item,
			design.artworkSize === 'hidden' ? undefined : artworkResourcePath,
			this.artworkBounds,
			artworkFingerprint,
		);
		const artworkResult = performanceTrace
			? await performanceTrace.measureAsync('artworkBoundsAnalysis', loadArtwork)
			: await loadArtwork();
		const artworkOrientation = getReadyOrientation(artworkResult);
		const measurementRoot = createCanonicalMeasurementRoot(document);

		const artworkAvailable = artworkResult.status === 'ready';
		let lastPlan: ItemCardPage[] = [];
		let lastUnfitPageIndexes = new Set<number>();
		let lastCapacityScale: number = ITEM_CARD_FIT_CAPACITY_SCALES[0];
		const bodyCandidates = getMonotonicDensityBodyFontCandidates(
			resolvedDensity,
			standardBodyFontCeiling,
		);
		let lastBodyFontPoints = bodyCandidates.at(-1) ?? 7;
		try {
			const measurementCache: PageMeasurementCache = {
				values: new Map(),
				statPackingValues: new Map(),
				...(artworkFingerprint ? { artworkFingerprint } : {}),
			};
			const planningContext = prepareItemCardPlanningContext(item, performanceTrace);
			const planPages = createMemoizedItemCardPagePlanner(item, planningContext);
			const onMeasured = (bodyFontPoints: number, state: MeasuredFit): void => {
				lastPlan = state.pages;
				lastUnfitPageIndexes = new Set(state.unfitPageIndexes);
				lastCapacityScale = state.capacityScale;
				lastBodyFontPoints = bodyFontPoints;
			};
			const calculateMinimums = () => {
				const minimumWithoutArtwork = getMinimumPlannedPageCount(
					planPages,
					false,
					bodyCandidates,
					artworkOrientation,
					performanceTrace,
					design,
				);
				const minimumWithArtwork = artworkAvailable
					? getMinimumPlannedPageCount(
						planPages,
						true,
						bodyCandidates,
						artworkOrientation,
						performanceTrace,
						design,
					)
					: Number.POSITIVE_INFINITY;
				return { minimumWithoutArtwork, minimumWithArtwork };
			};
			const { minimumWithoutArtwork, minimumWithArtwork } = performanceTrace
				? performanceTrace.measure('initialPlanning', calculateMinimums)
				: calculateMinimums();
			const withArtwork = artworkAvailable
				? await this.fitArtworkState(
					measurementRoot,
					planPages,
					true,
					bodyCandidates,
					minimumWithArtwork,
					artworkOrientation,
					artworkResourcePath,
					measurementCache,
					onMeasured,
					performanceTrace,
					design,
				)
				: undefined;
			if (withArtwork && shouldPreserveFittedArtwork(design)) {
				return await this.finalizeFit(
					measurementRoot,
					withArtwork,
					artworkResourcePath,
					measurementCache,
					artworkResult,
					performanceTrace,
					design,
					resolvedDensity,
				);
			}
			if (withArtwork
				&& minimumWithoutArtwork <= 2
				&& withArtwork.pageCount <= minimumWithoutArtwork + MAXIMUM_ARTWORK_PAGE_PENALTY) {
				const finalized = await this.finalizeFit(
					measurementRoot,
					withArtwork,
					artworkResourcePath,
					measurementCache,
					artworkResult,
					performanceTrace,
					design,
					resolvedDensity,
				);
				return finalized;
			}

			const withoutArtwork = await this.fitArtworkState(
				measurementRoot,
				planPages,
				false,
				bodyCandidates,
				minimumWithoutArtwork,
				artworkOrientation,
				artworkResourcePath,
				measurementCache,
				onMeasured,
				performanceTrace,
				design,
			);
			const selected = chooseArtworkPriorityFit(
				withArtwork,
				withoutArtwork,
				MAXIMUM_ARTWORK_PAGE_PENALTY,
			);
			if (selected) {
				const finalized = await this.finalizeFit(
					measurementRoot,
					selected,
					artworkResourcePath,
					measurementCache,
					artworkResult,
					performanceTrace,
					design,
					resolvedDensity,
				);
				return finalized;
			}
		} finally {
			measurementRoot.remove();
		}

		return {
			pages: lastPlan,
			artworkResult,
			capacityScale: lastCapacityScale,
			bodyFontPoints: lastBodyFontPoints,
			resolvedDensity,
			unfitPageIndexes: lastUnfitPageIndexes,
		};
	}

	private fitArtworkState(
		measurementRoot: HTMLElement,
		planPages: ItemCardPagePlanner,
		showArtwork: boolean,
		bodyCandidates: readonly number[],
		minimumPageCount: number,
		artworkOrientation: ArtworkOrientation | undefined,
		artworkResourcePath: string | undefined,
		measurementCache: PageMeasurementCache,
		onMeasured: (bodyFontPoints: number, fit: MeasuredFit) => void,
		performanceTrace?: PlanningPerformanceTrace,
		design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
	): Promise<AdaptiveBodyFit<MeasuredFit> | undefined> {
		return findBestAdaptiveBodyFit(
			bodyCandidates,
			async (bodyFontPoints) => {
				const measured = await this.findMeasuredFit(
					measurementRoot,
					planPages,
					showArtwork,
					bodyFontPoints,
					artworkOrientation,
					artworkResourcePath,
					measurementCache,
					(state) => onMeasured(bodyFontPoints, state),
					performanceTrace,
					design,
				);
				return measured
					? { pageCount: measured.pages.length, value: measured }
					: undefined;
			},
			minimumPageCount <= 2 ? minimumPageCount : 0,
		);
	}

	private async findMeasuredFit(
		measurementRoot: HTMLElement,
		planPages: ItemCardPagePlanner,
		showArtwork: boolean,
		bodyFontPoints: number,
		artworkOrientation: ArtworkOrientation | undefined,
		artworkResourcePath: string | undefined,
		measurementCache: PageMeasurementCache,
		onMeasured: (fit: MeasuredFit) => void,
		performanceTrace?: PlanningPerformanceTrace,
		design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
	): Promise<MeasuredFit | undefined> {
		const artworkShares = showArtwork && design.artworkSize === 'standard'
			? ARTWORK_SHARE_CANDIDATES
			: [undefined];
		for (const artworkSharePercent of artworkShares) {
			for (const capacityScale of ITEM_CARD_FIT_CAPACITY_SCALES) {
				const planningOptions = {
					artworkOrientation,
					artworkAvailable: showArtwork,
					capacityScale,
					bodyFontPoints,
					...(artworkSharePercent !== undefined ? { artworkSharePercent } : {}),
					...(performanceTrace ? { performanceTrace } : {}),
					design: normalizeCardDesignProfile(design),
				};
				const createCandidate = () => planPages(planningOptions);
				performanceTrace?.increment('candidatePlans');
				const initialPages = performanceTrace
					? performanceTrace.measure('candidateGeneration', createCandidate)
					: createCandidate();
				const compactStatRowSpans = await this.resolveCompactStatRowPacking(
					measurementRoot,
					initialPages,
					measurementCache,
					design,
				);
				const pages = compactStatRowSpans
					? planPages({ ...planningOptions, compactStatRowSpans })
					: initialPages;
				const measurementStartedAt = performanceNow();
				const unfitPageIndexes = await this.measurePages(
					measurementRoot,
					pages,
					artworkResourcePath,
					measurementCache,
					performanceTrace,
					design,
				);
				const measurementDuration = performanceNow() - measurementStartedAt;
				performanceTrace?.addDuration('domFitMeasurement', measurementDuration);
				const measured = { pages, capacityScale, unfitPageIndexes };
				onMeasured(measured);
				if (unfitPageIndexes.size > 0) {
					continue;
				}
				if (pages.filter((page) => page.kind === 'continuation').length < 2) {
					return measured;
				}

				const compact = () => this.compactPages(
					measurementRoot,
					pages,
					artworkResourcePath,
					measurementCache,
					performanceTrace,
					design,
				);
				const compactedPages = performanceTrace
					? await performanceTrace.measureAsync('paginationCompaction', compact)
					: await compact();
				const compactedMeasurementStartedAt = performanceNow();
				const compactedUnfitPageIndexes = await this.measurePages(
					measurementRoot,
					compactedPages,
					artworkResourcePath,
					measurementCache,
					performanceTrace,
					design,
				);
				const compactedMeasurementDuration = performanceNow()
					- compactedMeasurementStartedAt;
				performanceTrace?.addDuration(
					'domFitMeasurement',
					compactedMeasurementDuration,
				);
				return compactedUnfitPageIndexes.size > 0
					? measured
					: {
						pages: compactedPages,
						capacityScale,
						unfitPageIndexes: compactedUnfitPageIndexes,
					};
			}
		}
		return undefined;
	}

	private resolveCompactStatRowPacking(
		measurementRoot: HTMLElement,
		pages: readonly ItemCardPage[],
		measurementCache: PageMeasurementCache,
		design: Readonly<CardDesignProfile>,
	): Promise<CompactStatRowSpan[] | undefined> {
		const primary = pages.find((page) =>
			page.kind === 'primary'
			&& page.showStats
			&& page.statsPresentation === 'compact',
		);
		if (!primary || primary.layout === 'portrait') {
			return Promise.resolve(undefined);
		}
		const rows = buildItemStatRows(primary.item, design);
		const candidateSpans = getCompactStatRowSpans(rows);
		const key = JSON.stringify({
			renderRevision: ITEM_CARD_MEASUREMENT_RENDER_REVISION,
			layout: primary.layout,
			resolvedDensity: primary.resolvedDensity ?? null,
			artworkSharePercent: primary.artworkSharePercent ?? null,
			rows,
			candidateSpans,
		});
		let result = measurementCache.statPackingValues.get(key);
		if (!result) {
			result = this.measureCompactStatRowPacking(
				measurementRoot,
				primary,
				candidateSpans,
				design,
			);
			measurementCache.statPackingValues.set(key, result);
			void result.catch(() => measurementCache.statPackingValues.delete(key));
		}
		return result;
	}

	private async measureCompactStatRowPacking(
		measurementRoot: HTMLElement,
		page: ItemCardPage,
		candidateSpans: readonly CompactStatRowSpan[],
		design: Readonly<CardDesignProfile>,
	): Promise<CompactStatRowSpan[]> {
		const host = measurementRoot.createDiv({
			cls: 'ttrpg-card-forge__measurement-card',
		});
		try {
			const rendered = this.renderer.render(
				host,
				{
					...page,
					blocks: [],
					showArtwork: false,
					showSource: false,
					compactStatRowSpans: [...candidateSpans],
				},
				undefined,
				undefined,
				design,
			);
			await rendered.artworkReady;
			await waitForLayout(measurementRoot.ownerDocument.defaultView);
			const cells = Array.from(rendered.element.querySelectorAll<HTMLElement>(
				'.ttrpg-card-forge-card__stats--compact > .ttrpg-card-forge-card__stat',
			));
			const widths: CompactStatCellWidth[] = candidateSpans.map((_, index) => ({
				requiredWidth: cells[index]?.scrollWidth ?? Number.POSITIVE_INFINITY,
				availableWidth: cells[index]?.clientWidth ?? 0,
			}));
			return promoteUnsafeCompactStatPairs(candidateSpans, widths);
		} finally {
			host.remove();
		}
	}

	private async compactPages(
		measurementRoot: HTMLElement,
		pages: readonly ItemCardPage[],
		artworkResourcePath: string | undefined,
		measurementCache: PageMeasurementCache,
		performanceTrace?: PlanningPerformanceTrace,
		design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
	): Promise<ItemCardPage[]> {
		const continuationCount = pages.filter(
			(page) => page.kind === 'continuation',
		).length;
		if (continuationCount < 2) {
			return [...pages];
		}

		return compactContinuationPages(
			pages,
			async (page) => !(await this.measurePageCached(
				measurementRoot,
				page,
				artworkResourcePath,
				measurementCache,
				performanceTrace,
				design,
			)),
		);
	}

	private measurePageCached(
		measurementRoot: HTMLElement,
		page: ItemCardPage,
		artworkResourcePath: string | undefined,
		measurementCache: PageMeasurementCache,
		performanceTrace?: PlanningPerformanceTrace,
		design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
	): Promise<boolean> {
		const key = createItemCardPageMeasurementKey(
			page,
			measurementCache.artworkFingerprint,
			design,
		);
		let result = measurementCache.values.get(key);
		if (!result) {
			performanceTrace?.increment('measurementCacheMisses');
			result = this.measurePage(
				measurementRoot,
				page,
				artworkResourcePath,
				measurementCache.artworkFingerprint,
				design,
			);
			measurementCache.values.set(key, result);
			void result.catch(() => measurementCache.values.delete(key));
		} else {
			performanceTrace?.increment('measurementCacheHits');
		}
		return result;
	}

	private async measurePage(
		measurementRoot: HTMLElement,
		page: ItemCardPage,
		artworkResourcePath?: string,
		artworkRevisionFingerprint?: string,
		design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
	): Promise<boolean> {
		const host = measurementRoot.createDiv({
			cls: 'ttrpg-card-forge__measurement-card',
		});
		try {
			const rendered = this.renderer.render(
				host,
				page,
				artworkResourcePath,
				artworkRevisionFingerprint,
				design,
			);
			await rendered.artworkReady;
			await waitForLayout(measurementRoot.ownerDocument.defaultView);
			return rendered.hasOverflow();
		} finally {
			host.remove();
		}
	}

	private async measurePages(
		measurementRoot: HTMLElement,
		pages: readonly ItemCardPage[],
		artworkResourcePath: string | undefined,
		measurementCache: PageMeasurementCache,
		performanceTrace?: PlanningPerformanceTrace,
		design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
	): Promise<Set<number>> {
		const unfitPageIndexes = new Set<number>();
		for (const page of pages) {
			if (await this.measurePageCached(
				measurementRoot,
				page,
				artworkResourcePath,
				measurementCache,
				performanceTrace,
				design,
			)) {
				unfitPageIndexes.add(page.pageIndex);
			}
		}
		return unfitPageIndexes;
	}

	private async finalizeFit(
		measurementRoot: HTMLElement,
		fit: AdaptiveBodyFit<MeasuredFit>,
		artworkResourcePath: string | undefined,
		measurementCache: PageMeasurementCache,
		artworkResult: ArtworkLoadResult,
		performanceTrace?: PlanningPerformanceTrace,
		design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
		resolvedDensity: ResolvedCardDensity = 'standard',
	): Promise<FittedItemCardPlan> {
		const validate = () => this.measurePages(
			measurementRoot,
			fit.value.pages,
			artworkResourcePath,
			measurementCache,
			performanceTrace,
			design,
		);
		if (performanceTrace) {
			await performanceTrace.measureAsync('finalCanonicalValidation', validate);
		} else {
			await validate();
		}
		return toFittedPlan(fit, artworkResult, resolvedDensity);
	}
}

function toFittedPlan(
	fit: AdaptiveBodyFit<MeasuredFit>,
	artworkResult: ArtworkLoadResult,
	resolvedDensity: ResolvedCardDensity,
): FittedItemCardPlan {
	return {
		...fit.value,
		artworkResult,
		bodyFontPoints: fit.bodyFontPoints,
		resolvedDensity,
	};
}

function getMinimumPlannedPageCount(
	planPages: ItemCardPagePlanner,
	showArtwork: boolean,
	bodyCandidates: readonly number[],
	artworkOrientation: ArtworkOrientation | undefined,
	performanceTrace?: PlanningPerformanceTrace,
	design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): number {
	return bodyCandidates.reduce((minimum, bodyFontPoints) => Math.min(
		minimum,
		planPages({
			artworkOrientation,
			artworkAvailable: showArtwork,
			bodyFontPoints,
			...(performanceTrace ? { performanceTrace } : {}),
			design: normalizeCardDesignProfile(design),
		}).length,
	), Number.POSITIVE_INFINITY);
}

export function createItemCardPageMeasurementKey(
	page: ItemCardPage,
	artworkFingerprint?: string,
	design: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
): string {
	return JSON.stringify({
		renderRevision: ITEM_CARD_MEASUREMENT_RENDER_REVISION,
		physicalProfile: {
			widthMm: PHYSICAL_CARD_PROFILE.widthMm,
			heightMm: PHYSICAL_CARD_PROFILE.heightMm,
			widthPx: PHYSICAL_CARD_PROFILE.widthPx,
			heightPx: PHYSICAL_CARD_PROFILE.heightPx,
			dpi: PHYSICAL_CARD_PROFILE.dpi,
		},
		artworkFingerprint: artworkFingerprint ?? null,
		layoutDesignFingerprint: createLayoutDesignFingerprint(design),
		item: {
			filePath: page.item.filePath,
			name: page.item.name,
			detail: page.item.detail ?? null,
			sourceText: page.item.sourceText ?? null,
			sourceDisplayOverride: page.item.sourceDisplayOverride ?? null,
			rarity: page.item.rarity ?? null,
			attunement: page.item.attunement ?? null,
			source: page.item.source ?? null,
			damage: page.item.damage ?? null,
			damageTwoHanded: page.item.damageTwoHanded ?? null,
			range: page.item.range ?? null,
			properties: page.item.properties ? [...page.item.properties] : null,
			mastery: page.item.mastery ?? null,
			cost: page.item.cost ?? null,
			weight: page.item.weight ?? null,
			typeText: page.item.typeText ?? null,
			rarityText: page.item.rarityText ?? null,
			attunementText: page.item.attunementText ?? null,
			structuredFieldOrigins: createStructuredItemFieldOriginsSnapshot(page.item),
			manualRuleSegments: page.item.manualRuleSegments
				? [...page.item.manualRuleSegments]
				: null,
		},
		pageIndex: page.pageIndex,
		pageCount: page.pageCount,
		kind: page.kind,
		title: page.title,
		blocks: page.blocks,
		layout: page.layout,
		bodyFontPoints: page.bodyFontPoints ?? null,
		resolvedDensity: page.resolvedDensity ?? null,
		artworkSharePercent: page.artworkSharePercent ?? null,
		showArtwork: page.showArtwork,
		showStats: page.showStats,
		statsPresentation: page.statsPresentation ?? null,
		compactStatRowSpans: page.compactStatRowSpans ?? null,
		showSource: page.showSource,
		artworkOrientation: page.artworkOrientation ?? null,
		hasUnsplitOverflow: page.hasUnsplitOverflow,
	});
}

function loadArtworkOrientation(
	document: Document,
	item: ItemCardData,
	artworkResourcePath?: string,
	artworkBounds: ArtworkBoundsService = new ArtworkBoundsService(),
	artworkRevisionFingerprint?: string,
): Promise<ArtworkLoadResult> {
	if (!item.hasImage || !artworkResourcePath) {
		return Promise.resolve({ status: 'not-rendered' });
	}

	const image = document.body.createEl('img', {
		cls: 'ttrpg-card-forge__orientation-probe',
		attr: { 'aria-hidden': 'true' },
	});
	image.loading = 'eager';
	return new Promise((resolve) => {
		image.addEventListener('load', () => {
			void artworkBounds.getBounds(
				image,
				artworkResourcePath,
				artworkRevisionFingerprint,
			).then((bounds) => {
				const width = image.naturalWidth;
				const height = image.naturalHeight;
				if (width <= 0 || height <= 0) {
					image.remove();
					resolve({ status: 'invalid-dimensions' });
					return;
				}
				const orientation = classifyArtworkOrientation(
					bounds?.width ?? width,
					bounds?.height ?? height,
				);
				if (!orientation) {
					image.remove();
					resolve({ status: 'invalid-dimensions' });
					return;
				}
				image.remove();
				resolve({ status: 'ready', orientation });
			});
		}, { once: true });
		image.addEventListener('error', () => {
			image.remove();
			resolve({ status: 'error' });
		}, { once: true });
		image.src = artworkResourcePath;
	});
}

function getReadyOrientation(
	result: ArtworkLoadResult,
): ArtworkOrientation | undefined {
	return result.status === 'ready' ? result.orientation : undefined;
}

async function waitForLayout(view: Window | null): Promise<void> {
	if (!view) {
		return;
	}
	await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
	await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
}

function performanceNow(): number {
	return typeof performance === 'undefined' ? Date.now() : performance.now();
}
