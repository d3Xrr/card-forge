import {
	normalizeArtworkFraming,
	type ArtworkFraming,
} from '../models/card-design';

export interface ArtworkFramingStyle {
	objectFit: 'contain' | 'cover';
	objectPosition: string;
	transform: string;
	transformOrigin: string;
}

/** Pure CSS projection of the bounded persisted framing model. */
export function createArtworkFramingStyle(
	framingInput: Readonly<ArtworkFraming>,
): ArtworkFramingStyle {
	const framing = normalizeArtworkFraming(framingInput);
	return {
		objectFit: framing.fitMode === 'fill' ? 'cover' : 'contain',
		objectPosition: 'center',
		transform: `translate(${formatNumber(framing.panX / 4)}%, ${formatNumber(framing.panY / 4)}%) scale(${formatNumber(framing.zoom)})`,
		transformOrigin: 'center',
	};
}

export function applyArtworkFraming(
	element: HTMLImageElement | HTMLCanvasElement,
	framingInput: Readonly<ArtworkFraming>,
): void {
	const framing = normalizeArtworkFraming(framingInput);
	const style = createArtworkFramingStyle(framing);
	element.dataset.fitMode = framing.fitMode;
	element.dataset.zoom = formatNumber(framing.zoom);
	element.dataset.panX = formatNumber(framing.panX);
	element.dataset.panY = formatNumber(framing.panY);
	element.style.objectFit = style.objectFit;
	element.style.objectPosition = style.objectPosition;
	element.style.transform = style.transform;
	element.style.transformOrigin = style.transformOrigin;
}

function formatNumber(value: number): string {
	return Number(value.toFixed(2)).toString();
}
