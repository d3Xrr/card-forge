export interface PhysicalCardProfile {
	widthMm: number;
	heightMm: number;
	widthPx: number;
	heightPx: number;
	dpi: number;
}

export const PHYSICAL_CARD_PROFILE: Readonly<PhysicalCardProfile> = Object.freeze({
	widthMm: 63.5,
	heightMm: 88.9,
	widthPx: 750,
	heightPx: 1050,
	dpi: 300,
});

export const PHYSICAL_CARD_ASPECT_RATIO = 5 / 7;

export function createCanonicalMeasurementRoot(document: Document): HTMLElement {
	const root = document.body.createDiv({ cls: 'ttrpg-card-forge__measurement' });
	root.setAttribute('aria-hidden', 'true');
	root.style.width = `${PHYSICAL_CARD_PROFILE.widthPx}px`;
	root.style.height = `${PHYSICAL_CARD_PROFILE.heightPx}px`;
	return root;
}

export function applyCanonicalCardSize(element: HTMLElement): void {
	element.style.width = `${PHYSICAL_CARD_PROFILE.widthPx}px`;
	element.style.height = `${PHYSICAL_CARD_PROFILE.heightPx}px`;
}
