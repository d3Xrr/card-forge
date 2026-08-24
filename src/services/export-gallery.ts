export interface ExportGalleryFileInfo {
	path: string;
	name: string;
	modifiedTime: number;
	size: number;
}

export type ExportFolderSnapshot =
	| { status: 'missing' | 'unreadable' }
	| { status: 'ready'; files: readonly ExportGalleryFileInfo[] };

export interface ExportGalleryState {
	status: ExportFolderSnapshot['status'];
	entries: ExportGalleryFileInfo[];
}

const CARD_FORGE_PDF_NAME = /^card-forge-\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])-(?:[01]\d|2[0-3])[0-5]\d(?:-(?:[2-9]|\d{2,}))?\.pdf$/u;

export function isCardForgeExportFileName(name: string): boolean {
	return CARD_FORGE_PDF_NAME.test(name);
}

export function buildExportGalleryState(
	snapshot: ExportFolderSnapshot,
): ExportGalleryState {
	if (snapshot.status !== 'ready') {
		return { status: snapshot.status, entries: [] };
	}
	return {
		status: 'ready',
		entries: snapshot.files
			.filter((file) => isCardForgeExportFileName(file.name))
			.map((file) => ({ ...file }))
			.sort((left, right) =>
				right.modifiedTime - left.modifiedTime
				|| left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
			),
	};
}

export async function openGalleryExport(
	entry: ExportGalleryFileInfo,
	openFile: (path: string) => Promise<void>,
): Promise<boolean> {
	if (!isCardForgeExportFileName(entry.name)) {
		return false;
	}
	await openFile(entry.path);
	return true;
}

export async function deleteGalleryExport(
	entry: ExportGalleryFileInfo,
	confirmed: boolean,
	trashFile: (path: string) => Promise<void>,
): Promise<boolean> {
	if (!confirmed || !isCardForgeExportFileName(entry.name)) {
		return false;
	}
	await trashFile(entry.path);
	return true;
}
