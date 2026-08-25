import { toPng } from 'html-to-image';

import type { ItemCardPage } from '../models/item-card-page';
import {
	normalizeCardDesignProfile,
	type CardDesignProfile,
} from '../models/card-design';
import {
	applyCanonicalCardSize,
	PHYSICAL_CARD_PROFILE,
} from '../models/physical-card-profile';
import type { ItemCardRenderer } from '../renderer/item-card-renderer';

export class CardRasterizer {
	constructor(private readonly renderer: ItemCardRenderer) {}

	async rasterize(
		document: Document,
		page: ItemCardPage,
		artworkResourcePath?: string,
		artworkRevisionFingerprint?: string,
		designInput?: Readonly<CardDesignProfile>,
	): Promise<Uint8Array> {
		const design = normalizeCardDesignProfile(designInput);
		const root = document.body.createDiv({ cls: 'ttrpg-card-forge__export-root' });
		root.setAttribute('aria-hidden', 'true');
		const host = root.createDiv({ cls: 'ttrpg-card-forge__export-card' });
		applyCanonicalCardSize(host);

		try {
			const rendered = this.renderer.render(
				host,
				page,
				artworkResourcePath,
				artworkRevisionFingerprint,
				design,
			);
			await rendered.artworkReady;
			await document.fonts?.ready;
			await waitForLayout(document.defaultView);
			const dataUrl = await toPng(rendered.element, {
				width: PHYSICAL_CARD_PROFILE.widthPx,
				height: PHYSICAL_CARD_PROFILE.heightPx,
				canvasWidth: PHYSICAL_CARD_PROFILE.widthPx,
				canvasHeight: PHYSICAL_CARD_PROFILE.heightPx,
				pixelRatio: 1,
				cacheBust: false,
				skipAutoScale: true,
				skipFonts: true,
				backgroundColor: design.theme === 'dark' ? '#0d0e10' : '#ffffff',
				style: {
					width: `${PHYSICAL_CARD_PROFILE.widthPx}px`,
					height: `${PHYSICAL_CARD_PROFILE.heightPx}px`,
				},
			});
			return decodeDataUrl(dataUrl);
		} finally {
			root.remove();
		}
	}
}

function decodeDataUrl(dataUrl: string): Uint8Array {
	const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

async function waitForLayout(view: Window | null): Promise<void> {
	if (!view) {
		return;
	}
	await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
	await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()));
}
