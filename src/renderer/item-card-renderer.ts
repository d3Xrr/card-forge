import type { ItemCardData } from '../models/item';
import {
	classifyArtworkOrientation,
	type ArtworkOrientation,
} from './artwork-orientation';
import {
	formatLayoutName,
	getItemCardLayoutProfile,
	selectItemCardLayout,
	type ItemCardLayout,
} from './item-card-layout';
import { renderSafeMarkdown } from './safe-markdown-renderer';
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
		item: ItemCardData,
		artworkResourcePath?: string,
	): RenderedItemCard {
		container.replaceChildren();
		const layout = selectItemCardLayout(item);
		const layoutProfile = getItemCardLayoutProfile(layout);
		const card = appendElement(container, 'article', 'ttrpg-card-forge-card');
		card.dataset.layout = layout;
		card.dataset.rarity = item.rarity ?? 'unknown';
		card.style.setProperty(
			'--ttrpg-card-artwork-share',
			`${layoutProfile.artworkSharePercent}%`,
		);
		card.style.setProperty(
			'--ttrpg-card-body-font-size',
			`${layoutProfile.bodyFontCqw}cqw`,
		);
		card.setAttribute('aria-label', `${item.name} item card preview`);

		const header = appendElement(card, 'header', 'ttrpg-card-forge-card__header');
		appendElement(header, 'h3', 'ttrpg-card-forge-card__name', item.name);
		const identity = buildIdentityLine(item);
		if (identity) {
			appendElement(header, 'div', 'ttrpg-card-forge-card__identity', identity);
		}

		const artworkReady = layout !== 'text' && artworkResourcePath
			? renderArtwork(card, item, artworkResourcePath)
			: Promise.resolve<ArtworkLoadResult>({ status: 'not-rendered' });

		const body = appendElement(card, 'section', 'ttrpg-card-forge-card__body');
		const description = appendElement(body, 'div', 'ttrpg-card-forge-card__description');
		if (item.description.length > 0) {
			renderSafeMarkdown(item.description, description);
		} else {
			appendElement(
				description,
				'p',
				'ttrpg-card-forge-card__empty-description',
				'No rules description was found.',
			);
		}

		if (layout !== 'text') {
			const metrics = buildMetricLine(item);
			if (metrics) {
				appendElement(body, 'div', 'ttrpg-card-forge-card__metrics', metrics);
			}
		}

		const footer = appendElement(card, 'footer', 'ttrpg-card-forge-card__footer');
		appendElement(footer, 'span', 'ttrpg-card-forge-card__mark', 'CARD FORGE');
		const sourceDisplay = formatSourceDisplay(item.source, item.sourceText);
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
	card: HTMLElement,
	item: ItemCardData,
	artworkResourcePath: string,
): Promise<ArtworkLoadResult> {
	const artwork = appendElement(card, 'figure', 'ttrpg-card-forge-card__artwork');
	const image = appendElement(artwork, 'img');
	image.alt = `${item.name} artwork`;
	image.loading = 'lazy';
	image.draggable = false;

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
