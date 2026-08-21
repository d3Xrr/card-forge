export const CARD_FORGE_ASSET_FOLDER = 'Card Forge Assets';

const INVALID_VAULT_PATH_CHARACTER = /[<>:"|?*]/u;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:/u;

export interface ArtworkAssetVault {
	getAbstractFileByPath(path: string): unknown;
	createFolder(path: string): Promise<unknown>;
	createBinary(path: string, data: ArrayBuffer): Promise<unknown>;
}

export interface ArtworkImportPayload {
	data: ArrayBuffer;
	fileName: string;
	mimeType?: string;
}

export async function storeImportedArtwork(
	vault: ArtworkAssetVault,
	payload: ArtworkImportPayload,
	folderSetting = CARD_FORGE_ASSET_FOLDER,
): Promise<string> {
	const folder = normalizeArtworkAssetFolder(folderSetting);
	await ensureArtworkAssetFolder(vault, folder);
	const fileName = sanitizeArtworkFileName(payload.fileName);
	const extensionIndex = fileName.lastIndexOf('.');
	const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
	const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : '.png';
	let candidate = joinVaultPath(folder, `${stem}${extension}`);
	let suffix = 2;
	while (vault.getAbstractFileByPath(candidate)) {
		candidate = joinVaultPath(folder, `${stem}-${suffix}${extension}`);
		suffix += 1;
	}
	await vault.createBinary(candidate, payload.data);
	return candidate;
}

export function normalizeArtworkAssetFolder(folderSetting: string): string {
	const trimmed = folderSetting.trim();
	if (!trimmed) {
		return CARD_FORGE_ASSET_FOLDER;
	}
	if (WINDOWS_ABSOLUTE_PATH.test(trimmed)) {
		throw new Error('Card Forge Assets folder must be a vault-relative path.');
	}

	const parts = trimmed
		.replaceAll('\\', '/')
		.split('/')
		.map((part) => part.trim())
		.filter(Boolean);
	const normalizedParts: string[] = [];
	for (const part of parts) {
		if (part === '..') {
			throw new Error('Card Forge Assets folder cannot contain “..” path traversal.');
		}
		if (part === '.') {
			continue;
		}
		if (
			INVALID_VAULT_PATH_CHARACTER.test(part)
			|| [...part].some((character) => (character.codePointAt(0) ?? 0) < 32)
		) {
			throw new Error('Card Forge Assets folder contains characters that are not valid in a vault path.');
		}
		normalizedParts.push(part);
	}
	return normalizedParts.join('/');
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

async function ensureArtworkAssetFolder(
	vault: ArtworkAssetVault,
	folder: string,
): Promise<void> {
	let current = '';
	for (const part of folder.split('/').filter(Boolean)) {
		current = joinVaultPath(current, part);
		const existing = vault.getAbstractFileByPath(current);
		if (existing) {
			if (!isFolderLike(existing)) {
				throw new Error(`Card Forge Assets path is not a folder: ${current}`);
			}
			continue;
		}
		await vault.createFolder(current);
	}
}

function isFolderLike(value: unknown): boolean {
	return typeof value === 'object'
		&& value !== null
		&& Array.isArray((value as { children?: unknown }).children);
}

function joinVaultPath(folder: string, name: string): string {
	return folder ? `${folder}/${name}` : name;
}
