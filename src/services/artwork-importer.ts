import { requestUrl, type App } from 'obsidian';

import {
	storeImportedArtwork,
	validateHttpsArtworkUrl,
} from './artwork-importer-core';
import { isSupportedArtworkPath } from './artwork-resolver';

const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
	'image/avif': '.avif',
	'image/bmp': '.bmp',
	'image/gif': '.gif',
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
};

export class ArtworkImporter {
	constructor(private readonly app: App) {}

	async importLocalFile(file: File): Promise<string> {
		if (!isSupportedArtworkPath(file.name)) {
			throw new Error('Choose an AVIF, BMP, GIF, JPEG, PNG, or WebP image.');
		}
		return storeImportedArtwork(this.app.vault, {
			data: await file.arrayBuffer(),
			fileName: file.name,
		});
	}

	async importWebUrl(value: string): Promise<string> {
		const url = validateHttpsArtworkUrl(value.trim());
		const response = await requestUrl({ url: url.href, method: 'GET' });
		const contentTypeHeader = Object.entries(response.headers).find(
			([name]) => name.toLocaleLowerCase() === 'content-type',
		)?.[1];
		const contentType = contentTypeHeader?.split(';')[0]?.trim().toLocaleLowerCase();
		const inferredExtension = contentType ? CONTENT_TYPE_EXTENSIONS[contentType] : undefined;
		if (contentType && !inferredExtension) {
			throw new Error('The URL did not return a supported image format.');
		}
		const requestedName = decodeURIComponent(url.pathname.split('/').at(-1) || 'web-artwork');
		const fileName = isSupportedArtworkPath(requestedName)
			? requestedName
			: inferredExtension ? `web-artwork${inferredExtension}` : '';
		if (!fileName) {
			throw new Error('The URL did not return a supported image format.');
		}
		return storeImportedArtwork(this.app.vault, {
			data: response.arrayBuffer,
			fileName,
		});
	}
}
