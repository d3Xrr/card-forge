import {
	LEGACY_CARD_DESIGN_PROFILE,
	normalizeCardDesignProfile,
	type CardDesignProfile,
} from '../models/card-design';
import type { ItemCardPage } from '../models/item-card-page';
import { ArtworkBoundsService } from './artwork-bounds';
import { applyArtworkFraming } from './artwork-framing';
import type { ArtworkLoadResult } from './item-card-renderer';

export interface RenderedCardBack {
	element: HTMLElement;
	artworkReady: Promise<ArtworkLoadResult>;
}

export interface CardBackPresentation {
	printed: boolean;
	usesArtwork: boolean;
	title: string;
	subtitle: string;
}

export class CardBackRenderer {
	constructor(private readonly artworkBounds: ArtworkBoundsService = new ArtworkBoundsService()) {}

	render(
		container: HTMLElement,
		page: ItemCardPage,
		artworkResourcePath?: string,
		artworkRevisionFingerprint?: string,
		designInput: Readonly<CardDesignProfile> = LEGACY_CARD_DESIGN_PROFILE,
	): RenderedCardBack {
		container.replaceChildren();
		const design = normalizeCardDesignProfile(designInput);
		const { item } = page;
		const card = appendElement(
			container,
			'article',
			'ttrpg-card-forge-card ttrpg-card-forge-card--back',
		);
		card.dataset.theme = design.theme;
		card.dataset.rarity = item.rarity ?? 'unknown';
		card.dataset.backStyle = design.back.style;
		if (design.back.style === 'item-type') {
			card.dataset.itemType = resolveItemTypeCategory(page);
		}
		card.setAttribute('aria-label', `${item.name} item card back preview`);

		let artworkReady = Promise.resolve<ArtworkLoadResult>({ status: 'not-rendered' });
		if (
			(design.back.style === 'artwork' || design.back.style === 'custom-image')
			&& artworkResourcePath
		) {
			artworkReady = renderBackArtwork(
				card,
				page,
				artworkResourcePath,
				artworkRevisionFingerprint,
				design,
				this.artworkBounds,
			);
		} else {
			renderBackIdentity(card, page, design);
		}

		return { element: card, artworkReady };
	}
}

function renderBackIdentity(
	card: HTMLElement,
	page: ItemCardPage,
	design: Readonly<CardDesignProfile>,
): void {
	const presentation = createCardBackPresentation(page, design, false);
	const field = appendElement(card, 'div', 'ttrpg-card-forge-card__back-field');
	appendElement(field, 'div', 'ttrpg-card-forge-card__back-ornament', '◆');
	appendElement(field, 'div', 'ttrpg-card-forge-card__back-kicker', 'TTRPG');
	if (design.back.style === 'none') {
		card.classList.add('ttrpg-card-forge-card--no-back');
	} else if (presentation.usesArtwork) {
		card.classList.add('ttrpg-card-forge-card--artwork-unavailable');
	}
	appendElement(field, 'div', 'ttrpg-card-forge-card__back-title', presentation.title);
	appendElement(field, 'div', 'ttrpg-card-forge-card__back-subtitle', presentation.subtitle);
	appendElement(field, 'div', 'ttrpg-card-forge-card__back-ornament', '◆');
}

function renderBackArtwork(
	card: HTMLElement,
	page: ItemCardPage,
	resourcePath: string,
	revisionFingerprint: string | undefined,
	design: Readonly<CardDesignProfile>,
	artworkBounds: ArtworkBoundsService,
): Promise<ArtworkLoadResult> {
	const figure = appendElement(card, 'figure', 'ttrpg-card-forge-card__back-artwork');
	const image = appendElement(figure, 'img');
	image.alt = `${page.item.name} card back artwork`;
	image.loading = 'eager';
	image.draggable = false;
	applyArtworkFraming(image, design.back.artworkFraming);
	const label = appendElement(
		card,
		'div',
		'ttrpg-card-forge-card__back-artwork-label',
		'Card Forge',
	);

	return new Promise((resolve) => {
		image.addEventListener('load', () => {
			void artworkBounds.getBounds(image, resourcePath, revisionFingerprint).then((bounds) => {
				const normalized = card.closest('.ttrpg-card-forge__measurement') === null
					&& artworkBounds.applyVisibleBounds(image, figure, bounds);
				const canvas = figure.querySelector<HTMLCanvasElement>(
					'.ttrpg-card-forge-card__normalized-artwork',
				);
				if (canvas) {
					applyArtworkFraming(canvas, design.back.artworkFraming);
				}
				card.toggleClass('ttrpg-card-forge-card--artwork-normalized', normalized);
				resolve({ status: 'ready', orientation: 'square' });
			});
		}, { once: true });
		image.addEventListener('error', () => {
			figure.remove();
			label.remove();
			card.classList.add('ttrpg-card-forge-card--artwork-unavailable');
			renderBackIdentity(card, page, design);
			resolve({ status: 'error' });
		}, { once: true });
		image.src = resourcePath;
	});
}

export function createCardBackPresentation(
	page: ItemCardPage,
	designInput: Readonly<CardDesignProfile>,
	hasArtwork: boolean,
): CardBackPresentation {
	const design = normalizeCardDesignProfile(designInput);
	switch (design.back.style) {
		case 'none':
			return {
				printed: false,
				usesArtwork: false,
				title: 'No back',
				subtitle: 'This position remains blank when backs are exported',
			};
		case 'rarity':
			return {
				printed: true,
				usesArtwork: false,
				title: humanize(page.item.rarityText ?? page.item.rarity ?? 'Unspecified rarity'),
				subtitle: 'Item rarity',
			};
		case 'item-type':
			return {
				printed: true,
				usesArtwork: false,
				title: resolveItemType(page),
				subtitle: 'Item type',
			};
		case 'artwork':
		case 'custom-image':
			return hasArtwork
				? {
					printed: true,
					usesArtwork: true,
					title: 'Card Forge',
					subtitle: 'Artwork back',
				}
				: {
					printed: true,
					usesArtwork: true,
					title: 'Artwork unavailable',
					subtitle: design.back.style === 'custom-image'
						? 'Choose a valid vault image'
						: 'This item has no resolved artwork',
				};
		case 'generic':
			return {
				printed: true,
				usesArtwork: false,
				title: 'Card Forge',
				subtitle: 'Printable item card',
			};
	}
}

function resolveItemType(page: ItemCardPage): string {
	const explicit = page.item.typeText?.trim();
	if (explicit) {
		return explicit;
	}
	const detailType = page.item.detail?.split(',')[0]?.trim();
	return detailType || 'Item';
}

export function resolveItemTypeCategory(page: ItemCardPage): string {
	const value = resolveItemType(page).toLocaleLowerCase();
	for (const category of [
		'weapon',
		'armor',
		'potion',
		'ring',
		'rod',
		'staff',
		'wand',
		'scroll',
		'tool',
	] as const) {
		if (value.includes(category)) {
			return category;
		}
	}
	return value.includes('wondrous') ? 'wondrous-item' : 'other';
}

function humanize(value: string): string {
	return value
		.split(/[-_\s]+/u)
		.filter(Boolean)
		.map((part) => `${part[0]?.toLocaleUpperCase() ?? ''}${part.slice(1)}`)
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
