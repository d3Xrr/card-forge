import type { App, TFile } from 'obsidian';

import type { ItemCardData } from '../models/item';
import { normalizeVaultPath } from '../parsers/item-parser';

const SUPPORTED_ARTWORK_EXTENSIONS = new Set([
	'avif',
	'bmp',
	'gif',
	'jpeg',
	'jpg',
	'png',
	'webp',
]);

export function resolveArtworkFile(app: App, item: ItemCardData): TFile | null {
	if (!item.imagePath) {
		return null;
	}

	const imagePath = normalizeVaultPath(item.imagePath);
	const exactFile = app.vault.getFileByPath(imagePath);
	if (exactFile && isSupportedArtworkFile(exactFile)) {
		return exactFile;
	}

	const linkedFile = app.metadataCache.getFirstLinkpathDest(imagePath, item.filePath);
	return linkedFile && isSupportedArtworkFile(linkedFile) ? linkedFile : null;
}

export function getArtworkResourcePath(app: App, item: ItemCardData): string | undefined {
	const file = resolveArtworkFile(app, item);
	return file ? app.vault.getResourcePath(file) : undefined;
}

export function isSupportedArtworkPath(path: string): boolean {
	const extension = normalizeVaultPath(path).split('.').at(-1)?.toLocaleLowerCase();
	return extension ? SUPPORTED_ARTWORK_EXTENSIONS.has(extension) : false;
}

function isSupportedArtworkFile(file: TFile): boolean {
	return SUPPORTED_ARTWORK_EXTENSIONS.has(file.extension.toLocaleLowerCase());
}
