import type { ItemCardData } from '../models/item';
import type { ItemCardPage } from '../models/item-card-page';
import {
	classifyArtworkOrientation,
	ITEM_ARTWORK_FIT_MODE,
	type ArtworkOrientation,
} from './artwork-orientation';
import {
	formatLayoutName,
	getItemCardLayoutProfile,
	type ItemCardLayout,
} from './item-card-layout';
import { renderSafeMarkdownBlocks } from './safe-markdown-renderer';
import { formatSourceDisplay } from './source-formatter';

export type ArtworkLoadResult =
	| { status: 'ready'; orientation: ArtworkOrientation }
	| { status: 'invalid-dimensions' }
	| { status: 'error' }
	| { status: 'not-rendered' };

export interface RenderedItemCard {
	element: HTMLElement;
	layout: ItemCardLayout;
	printFontPoints: number;
	artworkReady: Promise<ArtworkLoadResult>;
	hasOverflow: () => boolean;
}

export class ItemCardRenderer {
	render(
		container: HTMLElement,
		page: ItemCardPage,
		artworkResourcePath?: string,
	): RenderedItemCard {
		container.replaceChildren();
		const { item, layout } = page;
		const layoutProfile = getItemCardLayoutProfile(layout);
		const card = appendElement(container, 'article', 'ttrpg-card-forge-card');
		card.dataset.layout = layout;
		card.dataset.pageKind = page.kind;
		card.dataset.rarity = item.rarity ?? 'unknown';
		if (page.artworkOrientation) {
			card.dataset.artworkOrientation = page.artworkOrientation;
		}
		card.style.setProperty(
			'--ttrpg-card-artwork-share',
			`${layoutProfile.artworkSharePercent}%`,
		);
		card.style.setProperty(
			'--ttrpg-card-body-font-size',
			`${layoutProfile.bodyFontCqw}cqw`,
		);
		card.setAttribute(
			'aria-label',
			page.pageCount > 1
				? `${item.name} item card, page ${page.pageIndex + 1} of ${page.pageCount}`
				: `${item.name} item card preview`,
		);

		const header = appendElement(card, 'header', 'ttrpg-card-forge-card__header');
		const titleRow = appendElement(header, 'div', 'ttrpg-card-forge-card__title-row');
		appendElement(titleRow, 'h3', 'ttrpg-card-forge-card__name', page.title);
		if (page.pageCount > 1) {
			appendElement(
				titleRow,
				'span',
				'ttrpg-card-forge-card__page-number',
				`${page.pageIndex + 1} / ${page.pageCount}`,
			);
		}
		const subtitle = buildPageSubtitle(page);
		if (subtitle) {
			appendElement(header, 'div', 'ttrpg-card-forge-card__identity', subtitle);
		}

		const content = appendElement(card, 'div', 'ttrpg-card-forge-card__content');
		const artworkReady = page.showArtwork && artworkResourcePath
			? renderArtwork(content, card, item, artworkResourcePath)
			: Promise.resolve<ArtworkLoadResult>({ status: 'not-rendered' });

		const body = appendElement(content, 'section', 'ttrpg-card-forge-card__body');
		const description = appendElement(body, 'div', 'ttrpg-card-forge-card__description');
		if (page.blocks.length > 0) {
			renderSafeMarkdownBlocks(page.blocks, description);
		} else {
			appendElement(
				description,
				'p',
				'ttrpg-card-forge-card__empty-description',
				'No rules description was found.',
			);
		}

		if (page.kind === 'primary' && layout !== 'text') {
			const metrics = buildMetricLine(item);
			if (metrics) {
				appendElement(body, 'div', 'ttrpg-card-forge-card__metrics', metrics);
			}
		}

		const footer = appendElement(card, 'footer', 'ttrpg-card-forge-card__footer');
		appendElement(footer, 'span', 'ttrpg-card-forge-card__mark', 'CARD FORGE');
		const sourceDisplay = page.showSource
			? formatSourceDisplay(item.source, item.sourceText)
			: undefined;
		if (sourceDisplay) {
			appendElement(
				footer,
				'span',
				'ttrpg-card-forge-card__source',
				sourceDisplay,
			);
		}

		card.title = `Layout: ${formatLayoutName(layout)}`;
		return {
			element: card,
			layout,
			printFontPoints: layoutProfile.printFontPoints,
			artworkReady,
			hasOverflow: () =>
				description.scrollHeight > description.clientHeight + 1
				|| card.scrollHeight > card.clientHeight + 1,
		};
	}
}

function renderArtwork(
	content: HTMLElement,
	card: HTMLElement,
	item: ItemCardData,
	artworkResourcePath: string,
): Promise<ArtworkLoadResult> {
	const artwork = appendElement(content, 'figure', 'ttrpg-card-forge-card__artwork');
	const image = appendElement(artwork, 'img');
	image.alt = `${item.name} artwork`;
	image.loading = 'eager';
	image.draggable = false;
	image.dataset.fitMode = ITEM_ARTWORK_FIT_MODE;

	return new Promise((resolve) => {
		image.addEventListener('load', () => {
			const orientation = classifyArtworkOrientation(image.naturalWidth, image.naturalHeight);
			if (!orientation) {
				card.dataset.artworkOrientation = 'unknown';
				resolve({ status: 'invalid-dimensions' });
				return;
			}

			card.dataset.artworkOrientation = orientation;
			resolve({ status: 'ready', orientation });
		}, { once: true });
		image.addEventListener('error', () => {
			artwork.remove();
			card.classList.add('ttrpg-card-forge-card--artwork-unavailable');
			resolve({ status: 'error' });
		}, { once: true });
		image.src = artworkResourcePath;
	});
}

function buildPageSubtitle(page: ItemCardPage): string | undefined {
	if (page.kind === 'continuation') {
		return 'Continued';
	}
	if (page.kind === 'crafting') {
		return 'Crafting';
	}
	return buildIdentityLine(page.item);
}

function buildIdentityLine(item: ItemCardData): string | undefined {
	if (item.detail) {
		return item.detail;
	}

	const parts: string[] = [];
	if (item.rarity) {
		parts.push(humanizeSlug(item.rarity));
	}
	if (item.attunement) {
		parts.push('Requires attunement');
	}
	return parts.length > 0 ? parts.join(' · ') : undefined;
}

function buildMetricLine(item: ItemCardData): string | undefined {
	const parts: string[] = [];
	if (item.damage) {
		parts.push(item.damage);
	}
	if (item.mastery) {
		parts.push(`Mastery: ${item.mastery}`);
	}
	return parts.length > 0 ? parts.join(' · ') : undefined;
}

function humanizeSlug(value: string): string {
	return value
		.split('-')
		.map((part) => part.length > 0
			? `${part[0]?.toLocaleUpperCase()}${part.slice(1)}`
			: part)
		.join(' ');
}

function appendElement<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tagName: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const element = parent.createEl(tagName);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}
