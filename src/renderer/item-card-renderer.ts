import type { ItemCardData } from '../models/item';
import type { ItemCardPage } from '../models/item-card-page';
import { ArtworkBoundsService } from './artwork-bounds';
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
import {
	formatPrintPointsAsCqw,
	PRINT_TYPOGRAPHY,
} from './print-typography';
import { renderSafeMarkdownBlocks } from './safe-markdown-renderer';
import { resolveSourceDisplay } from './source-formatter';
import { renderItemStats } from './structured-item-stats';
import { isUnknownRarityText } from '../services/item-identity';

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
	constructor(private readonly artworkBounds: ArtworkBoundsService = new ArtworkBoundsService()) {}

	render(
		container: HTMLElement,
		page: ItemCardPage,
		artworkResourcePath?: string,
		artworkRevisionFingerprint?: string,
	): RenderedItemCard {
		container.replaceChildren();
		const { item, layout } = page;
		const layoutProfile = getItemCardLayoutProfile(
			layout,
			page.bodyFontPoints,
			page.statsPresentation === 'compact',
			page.artworkSharePercent,
		);
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
		const usesCompactHeader = page.kind !== 'primary';
		card.style.setProperty(
			'--ttrpg-card-title-font-size',
			formatPrintPointsAsCqw(usesCompactHeader
				? PRINT_TYPOGRAPHY.continuationTitle.targetPoints
				: PRINT_TYPOGRAPHY.title.targetPoints),
		);
		card.style.setProperty(
			'--ttrpg-card-subtitle-font-size',
			formatPrintPointsAsCqw(usesCompactHeader
				? PRINT_TYPOGRAPHY.continuationSubtitle.targetPoints
				: PRINT_TYPOGRAPHY.subtitle.targetPoints),
		);
		card.style.setProperty(
			'--ttrpg-card-stats-font-size',
			formatPrintPointsAsCqw(PRINT_TYPOGRAPHY.stats.targetPoints),
		);
		card.style.setProperty(
			'--ttrpg-card-stat-label-font-size',
			formatPrintPointsAsCqw(PRINT_TYPOGRAPHY.statLabel.targetPoints),
		);
		card.style.setProperty(
			'--ttrpg-card-small-font-size',
			formatPrintPointsAsCqw(PRINT_TYPOGRAPHY.source.targetPoints),
		);
		card.style.setProperty(
			'--ttrpg-card-page-number-font-size',
			formatPrintPointsAsCqw(PRINT_TYPOGRAPHY.pageNumber.targetPoints),
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
		const subtitleLines = buildPageSubtitleLines(page);
		if (subtitleLines.length > 0) {
			const identity = appendElement(header, 'div', 'ttrpg-card-forge-card__identity');
			for (const line of subtitleLines) {
				appendElement(identity, 'span', 'ttrpg-card-forge-card__identity-line', line);
			}
		}

		const content = appendElement(card, 'div', 'ttrpg-card-forge-card__content');
		const artworkReady = page.showArtwork && artworkResourcePath
			? renderArtwork(
				content,
				card,
				item,
				artworkResourcePath,
				this.artworkBounds,
				artworkRevisionFingerprint,
			)
			: Promise.resolve<ArtworkLoadResult>({ status: 'not-rendered' });

		const body = appendElement(content, 'section', 'ttrpg-card-forge-card__body');
		const renderableBlocks = getRenderablePageBlocks(page);
		let description: HTMLElement | undefined;
		if (renderableBlocks.length > 0) {
			description = appendElement(body, 'div', 'ttrpg-card-forge-card__description');
			renderSafeMarkdownBlocks(renderableBlocks, description);
		} else if (!page.showStats) {
			description = appendElement(body, 'div', 'ttrpg-card-forge-card__description');
			appendElement(
				description,
				'p',
				'ttrpg-card-forge-card__empty-description',
				'No rules description was found.',
			);
		}

		if (page.showStats && page.statsPresentation) {
			renderItemStats(body, item, page.statsPresentation, layout);
		}

		const sourceDisplay = page.showSource
			? resolveSourceDisplay(
				item.source,
				item.sourceText,
				item.sourceDisplayOverride,
			)
			: undefined;
		if (sourceDisplay) {
			const footer = appendElement(card, 'footer', 'ttrpg-card-forge-card__footer');
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
				Boolean(description
					&& description.scrollHeight > description.clientHeight + 1)
				|| card.scrollHeight > card.clientHeight + 1,
		};
	}
}

export function getRenderablePageBlocks(page: ItemCardPage): ItemCardPage['blocks'] {
	const firstBlock = page.blocks[0];
	if (
		page.kind === 'crafting'
		&& firstBlock?.type === 'heading'
		&& firstBlock.level === 2
		&& firstBlock.markdown.trim().toLocaleLowerCase() === 'crafting'
	) {
		return page.blocks.slice(1);
	}
	return page.blocks;
}

function renderArtwork(
	content: HTMLElement,
	card: HTMLElement,
	item: ItemCardData,
	artworkResourcePath: string,
	artworkBounds: ArtworkBoundsService,
	artworkRevisionFingerprint?: string,
): Promise<ArtworkLoadResult> {
	const artwork = appendElement(content, 'figure', 'ttrpg-card-forge-card__artwork');
	const image = appendElement(artwork, 'img');
	image.alt = `${item.name} artwork`;
	image.loading = 'eager';
	image.draggable = false;
	image.dataset.fitMode = ITEM_ARTWORK_FIT_MODE;

	return new Promise((resolve) => {
		image.addEventListener('load', () => {
			void artworkBounds.getBounds(
				image,
				artworkResourcePath,
				artworkRevisionFingerprint,
			).then((bounds) => {
				const normalized = card.closest('.ttrpg-card-forge__measurement') === null
					&& artworkBounds.applyVisibleBounds(image, artwork, bounds);
				card.toggleClass('ttrpg-card-forge-card--artwork-normalized', normalized);
				const orientation = classifyArtworkOrientation(
					bounds?.width ?? image.naturalWidth,
					bounds?.height ?? image.naturalHeight,
				);
				if (!orientation) {
					card.dataset.artworkOrientation = 'unknown';
					resolve({ status: 'invalid-dimensions' });
					return;
				}

				card.dataset.artworkOrientation = orientation;
				resolve({ status: 'ready', orientation });
			});
		}, { once: true });
		image.addEventListener('error', () => {
			artwork.remove();
			card.classList.add('ttrpg-card-forge-card--artwork-unavailable');
			resolve({ status: 'error' });
		}, { once: true });
		image.src = artworkResourcePath;
	});
}

function buildPageSubtitleLines(page: ItemCardPage): string[] {
	if (page.kind === 'continuation') {
		return ['Continued'];
	}
	if (page.kind === 'crafting') {
		return ['Crafting'];
	}
	return buildItemIdentityLines(page.item);
}

export function buildItemIdentityLines(item: ItemCardData): string[] {
	if (
		item.typeText !== undefined
		|| item.rarityText !== undefined
		|| item.attunementText !== undefined
	) {
		const primary = item.typeText?.trim();
		const metadata = [
			isUnknownRarityText(item.rarityText) ? undefined : item.rarityText,
			item.attunementText,
		]
			.map((value) => value?.trim())
			.filter((value): value is string => Boolean(value));
		return [
			...(primary ? [primary] : []),
			...(metadata.length > 0 ? [metadata.join(' · ')] : []),
		];
	}
	if (item.detail) {
		const detailSegments = splitDetailSegments(item.detail);
		const primary = detailSegments.shift();
		let metadata = detailSegments.join(', ').trim();
		const exactAttunement = /\s*\(\s*requires attunement\s*\)\s*/iu;
		const detailMentionsAttunement = /requires attunement/iu.test(metadata);
		const removedExactAttunement = exactAttunement.test(metadata);
		metadata = metadata.replace(exactAttunement, '').trim();
		if (isUnknownRarityText(metadata)) {
			metadata = '';
		}
		const metadataParts = [
			...(metadata ? [capitalizeFirst(metadata)] : []),
			...(item.attunement && (removedExactAttunement || !detailMentionsAttunement)
				? ['Requires attunement']
				: []),
		];
		return [
			...(primary ? [primary] : []),
			...(metadataParts.length > 0 ? [metadataParts.join(' · ')] : []),
		];
	}

	const parts: string[] = [];
	if (item.rarity && !isUnknownRarityText(item.rarity)) {
		parts.push(humanizeSlug(item.rarity));
	}
	if (item.attunement) {
		parts.push('Requires attunement');
	}
	return parts.length > 0 ? [parts.join(' · ')] : [];
}

function splitDetailSegments(detail: string): string[] {
	const segments: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < detail.length; index += 1) {
		const character = detail[index];
		if (character === '(') {
			depth += 1;
		} else if (character === ')') {
			depth = Math.max(0, depth - 1);
		} else if (character === ',' && depth === 0) {
			segments.push(detail.slice(start, index).trim());
			start = index + 1;
		}
	}
	segments.push(detail.slice(start).trim());
	return segments.filter(Boolean);
}

function capitalizeFirst(value: string): string {
	return value.length > 0
		? `${value[0]?.toLocaleUpperCase()}${value.slice(1)}`
		: value;
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
