import { normalizePath, TFile, TFolder, type App } from 'obsidian';

export const DEFAULT_PDF_EXPORT_FOLDER = 'Card Forge Exports';

export interface SavedPdf {
	file: TFile;
	fileName: string;
	path: string;
}

export async function savePdfToVault(
	app: App,
	folderSetting: string,
	bytes: Uint8Array,
	date = new Date(),
): Promise<SavedPdf> {
	const folder = normalizeExportFolder(folderSetting);
	await ensureVaultFolder(app, folder);
	const baseName = formatExportBaseName(date);
	const path = findAvailablePdfPath(app, folder, baseName);
	const binary = new Uint8Array(bytes).buffer;
	const file = await app.vault.createBinary(path, binary);
	return { file, fileName: file.name, path: file.path };
}

export function normalizeExportFolder(folderSetting: string): string {
	const trimmed = folderSetting.trim();
	return normalizePath(trimmed || DEFAULT_PDF_EXPORT_FOLDER).replace(/^\/+|\/+$/gu, '');
}

export function formatExportBaseName(date: Date): string {
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hours = pad(date.getHours());
	const minutes = pad(date.getMinutes());
	return `card-forge-${year}-${month}-${day}-${hours}${minutes}`;
}

async function ensureVaultFolder(app: App, folder: string): Promise<void> {
	let current = '';
	for (const part of folder.split('/').filter(Boolean)) {
		current = current ? `${current}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(current);
		if (existing instanceof TFolder) {
			continue;
		}
		if (existing) {
			throw new Error(`PDF export path is not a folder: ${current}`);
		}
		await app.vault.createFolder(current);
	}
}

function findAvailablePdfPath(app: App, folder: string, baseName: string): string {
	let suffix = 1;
	while (true) {
		const fileName = suffix === 1 ? `${baseName}.pdf` : `${baseName}-${suffix}.pdf`;
		const path = normalizePath(`${folder}/${fileName}`);
		if (!app.vault.getAbstractFileByPath(path)) {
			return path;
		}
		suffix += 1;
	}
}

function pad(value: number): string {
	return value.toString().padStart(2, '0');
}
