import type { ItemCardData } from '../models/item';
import type { ArtworkOrientation, ItemCardPage } from '../models/item-card-page';
import { createCanonicalMeasurementRoot } from '../models/physical-card-profile';
import { ArtworkBoundsService } from './artwork-bounds';
import { classifyArtworkOrientation } from './artwork-orientation';
import { compactContinuationPages } from './item-card-compactor';
import { getAdaptiveBodyFontCandidates } from './item-card-layout';
import {
	ItemCardRenderer,
	type ArtworkLoadResult,
} from './item-card-renderer';
import { planItemCardPages } from './item-card-planner';

export interface FittedItemCardPlan {
	pages: ItemCardPage[];
	artworkResult: ArtworkLoadResult;
	capacityScale: number;
	bodyFontPoints: number;
	unfitPageIndexes: ReadonlySet<number>;
}

const CAPACITY_SCALES = [1, 0.88, 0.76, 0.66, 0.55] as const;

export interface AdaptiveBodyFit<T> {
	bodyFontPoints: number;
	pageCount: number;
	value: T;
}

export async function findBestAdaptiveBodyFit<T>(
	bodyFontPoints: readonly number[],
	attempt: (points: number) => Promise<{ pageCount: number; value: T } | undefined>,
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
	}
	return best;
}

interface MeasuredFit {
	pages: ItemCardPage[];
	capacityScale: number;
	unfitPageIndexes: ReadonlySet<number>;
}

export class ItemCardFitService {
	constructor(
		private readonly renderer: ItemCardRenderer,
		private readonly artworkBounds: ArtworkBoundsService = new ArtworkBoundsService(),
	) {}

	async fit(
		document: Document,
		item: ItemCardData,
		artworkResourcePath?: string,
	): Promise<FittedItemCardPlan> {
		const artworkResult = await loadArtworkOrientation(
			document,
			item,
			artworkResourcePath,
			this.artworkBounds,
		);
		const artworkOrientation = getReadyOrientation(artworkResult);
		const measurementRoot = createCanonicalMeasurementRoot(document);

		const artworkAvailable = artworkResult.status === 'ready';
		let lastPlan: ItemCardPage[] = [];
		let lastUnfitPageIndexes = new Set<number>();
		let lastCapacityScale: number = CAPACITY_SCALES[0];
		let lastBodyFontPoints = getAdaptiveBodyFontCandidates().at(-1) ?? 7;
		try {
			const bodyCandidates = getAdaptiveBodyFontCandidates();
			const artworkStates = artworkAvailable ? [true, false] : [false];
			for (const showArtwork of artworkStates) {
				const fitted = await findBestAdaptiveBodyFit(
					bodyCandidates,
					async (bodyFontPoints) => {
						const measured = await this.findMeasuredFit(
							measurementRoot,
							item,
							showArtwork,
							bodyFontPoints,
							artworkOrientation,
							artworkResourcePath,
							(state) => {
								lastPlan = state.pages;
								lastUnfitPageIndexes = new Set(state.unfitPageIndexes);
								lastCapacityScale = state.capacityScale;
								lastBodyFontPoints = bodyFontPoints;
							},
						);
						return measured
							? { pageCount: measured.pages.length, value: measured }
							: undefined;
					},
				);
				if (fitted) {
					return {
						...fitted.value,
						artworkResult,
						bodyFontPoints: fitted.bodyFontPoints,
					};
				}
			}
		} finally {
			measurementRoot.remove();
		}

		return {
			pages: lastPlan,
			artworkResult,
			capacityScale: lastCapacityScale,
			bodyFontPoints: lastBodyFontPoints,
			unfitPageIndexes: lastUnfitPageIndexes,
		};
	}

	private async findMeasuredFit(
		measurementRoot: HTMLElement,
		item: ItemCardData,
		showArtwork: boolean,
		bodyFontPoints: number,
		artworkOrientation: ArtworkOrientation | undefined,
		artworkResourcePath: string | undefined,
		onMeasured: (fit: MeasuredFit) => void,
	): Promise<MeasuredFit | undefined> {
		for (const capacityScale of CAPACITY_SCALES) {
			const pages = planItemCardPages(item, {
				artworkOrientation,
				artworkAvailable: showArtwork,
				capacityScale,
				bodyFontPoints,
			});
			const unfitPageIndexes = await this.measurePages(
				measurementRoot,
				pages,
				artworkResourcePath,
			);
			const measured = { pages, capacityScale, unfitPageIndexes };
			onMeasured(measured);
			if (unfitPageIndexes.size > 0) {
				continue;
			}
			if (pages.filter((page) => page.kind === 'continuation').length < 2) {
				return measured;
			}

			const compactedPages = await this.compactPages(
				measurementRoot,
				pages,
				artworkResourcePath,
			);
			const compactedUnfitPageIndexes = await this.measurePages(
				measurementRoot,
				compactedPages,
				artworkResourcePath,
			);
			return compactedUnfitPageIndexes.size > 0
				? measured
				: {
					pages: compactedPages,
					capacityScale,
					unfitPageIndexes: compactedUnfitPageIndexes,
				};
		}
		return undefined;
	}

	private async compactPages(
		measurementRoot: HTMLElement,
		pages: readonly ItemCardPage[],
		artworkResourcePath?: string,
	): Promise<ItemCardPage[]> {
		const continuationCount = pages.filter(
			(page) => page.kind === 'continuation',
		).length;
		if (continuationCount < 2) {
			return [...pages];
		}

		return compactContinuationPages(
			pages,
			async (page) => !(await this.measurePage(
				measurementRoot,
				page,
				artworkResourcePath,
			)),
		);
	}

	private async measurePage(
		measurementRoot: HTMLElement,
		page: ItemCardPage,
		artworkResourcePath?: string,
	): Promise<boolean> {
		const host = measurementRoot.createDiv({
			cls: 'ttrpg-card-forge__measurement-card',
		});
		try {
			const rendered = this.renderer.render(host, page, artworkResourcePath);
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
		artworkResourcePath?: string,
	): Promise<Set<number>> {
		const unfitPageIndexes = new Set<number>();
		for (const page of pages) {
			if (await this.measurePage(measurementRoot, page, artworkResourcePath)) {
				unfitPageIndexes.add(page.pageIndex);
			}
		}
		return unfitPageIndexes;
	}
}

function loadArtworkOrientation(
	document: Document,
	item: ItemCardData,
	artworkResourcePath?: string,
	artworkBounds: ArtworkBoundsService = new ArtworkBoundsService(),
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
			void artworkBounds.getBounds(image, artworkResourcePath).then((bounds) => {
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
