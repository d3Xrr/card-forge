import type { ItemCardData } from '../models/item';
import type { ArtworkOrientation, ItemCardPage } from '../models/item-card-page';
import { classifyArtworkOrientation } from './artwork-orientation';
import {
	ItemCardRenderer,
	type ArtworkLoadResult,
} from './item-card-renderer';
import { planItemCardPages } from './item-card-planner';

export interface FittedItemCardPlan {
	pages: ItemCardPage[];
	artworkResult: ArtworkLoadResult;
	capacityScale: number;
	unfitPageIndexes: ReadonlySet<number>;
}

const CAPACITY_SCALES = [1, 0.88, 0.76, 0.66, 0.55] as const;

export class ItemCardFitService {
	constructor(private readonly renderer: ItemCardRenderer) {}

	async fit(
		measurementContainer: HTMLElement,
		item: ItemCardData,
		artworkResourcePath?: string,
	): Promise<FittedItemCardPlan> {
		const artworkResult = await loadArtworkOrientation(
			measurementContainer.ownerDocument,
			item,
			artworkResourcePath,
		);
		const artworkOrientation = getReadyOrientation(artworkResult);
		const measurementRoot = measurementContainer.createDiv({
			cls: 'ttrpg-card-forge__measurement',
			attr: { 'aria-hidden': 'true' },
		});

		const artworkAvailable = artworkResult.status === 'ready';
		let lastPlan = planItemCardPages(item, {
			artworkOrientation,
			artworkAvailable,
		});
		let lastUnfitPageIndexes = new Set<number>();
		try {
			for (const capacityScale of CAPACITY_SCALES) {
				const pages = planItemCardPages(item, {
					artworkOrientation,
					artworkAvailable,
					capacityScale,
				});
				const unfitPageIndexes = await this.measurePages(
					measurementRoot,
					pages,
					artworkResourcePath,
				);
				lastPlan = pages;
				lastUnfitPageIndexes = unfitPageIndexes;
				if (unfitPageIndexes.size === 0) {
					return {
						pages,
						artworkResult,
						capacityScale,
						unfitPageIndexes,
					};
				}
			}
		} finally {
			measurementRoot.remove();
		}

		return {
			pages: lastPlan,
			artworkResult,
			capacityScale: CAPACITY_SCALES.at(-1) ?? 0.55,
			unfitPageIndexes: lastUnfitPageIndexes,
		};
	}

	private async measurePages(
		measurementRoot: HTMLElement,
		pages: readonly ItemCardPage[],
		artworkResourcePath?: string,
	): Promise<Set<number>> {
		const unfitPageIndexes = new Set<number>();
		for (const page of pages) {
			const host = measurementRoot.createDiv({
				cls: 'ttrpg-card-forge__measurement-card',
			});
			const rendered = this.renderer.render(host, page, artworkResourcePath);
			await rendered.artworkReady;
			await waitForLayout(measurementRoot.ownerDocument.defaultView);
			if (rendered.hasOverflow()) {
				unfitPageIndexes.add(page.pageIndex);
			}
			host.remove();
		}
		return unfitPageIndexes;
	}
}

function loadArtworkOrientation(
	document: Document,
	item: ItemCardData,
	artworkResourcePath?: string,
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
			const width = image.naturalWidth;
			const height = image.naturalHeight;
			if (width <= 0 || height <= 0) {
				image.remove();
				resolve({ status: 'invalid-dimensions' });
				return;
			}
			const orientation = classifyArtworkOrientation(width, height);
			if (!orientation) {
				image.remove();
				resolve({ status: 'invalid-dimensions' });
				return;
			}
			image.remove();
			resolve({ status: 'ready', orientation });
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
