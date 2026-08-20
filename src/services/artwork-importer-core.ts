export const CARD_FORGE_ASSET_FOLDER = 'Card Forge Assets';

export interface ArtworkAssetVault {
	getAbstractFileByPath(path: string): unknown;
	createFolder(path: string): Promise<unknown>;
	createBinary(path: string, data: ArrayBuffer): Promise<unknown>;
}

export interface ArtworkImportPayload {
	data: ArrayBuffer;
	fileName: string;
}

export async function storeImportedArtwork(
	vault: ArtworkAssetVault,
	payload: ArtworkImportPayload,
): Promise<string> {
	if (!vault.getAbstractFileByPath(CARD_FORGE_ASSET_FOLDER)) {
		await vault.createFolder(CARD_FORGE_ASSET_FOLDER);
	}
	const fileName = sanitizeArtworkFileName(payload.fileName);
	const extensionIndex = fileName.lastIndexOf('.');
	const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
	const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : '.png';
	let candidate = `${CARD_FORGE_ASSET_FOLDER}/${stem}${extension}`;
	let suffix = 2;
	while (vault.getAbstractFileByPath(candidate)) {
		candidate = `${CARD_FORGE_ASSET_FOLDER}/${stem}-${suffix}${extension}`;
		suffix += 1;
	}
	await vault.createBinary(candidate, payload.data);
	return candidate;
}

export function sanitizeArtworkFileName(fileName: string): string {
	const extensionMatch = fileName.match(/\.(avif|bmp|gif|jpe?g|png|webp)$/iu);
	const extension = extensionMatch?.[0].toLocaleLowerCase() ?? '.png';
	const sourceStem = extensionMatch
		? fileName.slice(0, -extensionMatch[0].length)
		: fileName;
	const normalized = sourceStem
		.normalize('NFKD')
		.replace(/[^a-zA-Z0-9_-]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.toLocaleLowerCase();
	return `${normalized || 'artwork'}${extension}`;
}

export function validateHttpsArtworkUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== 'https:') {
		throw new Error('Artwork URLs must use HTTPS.');
	}
	return url;
}
