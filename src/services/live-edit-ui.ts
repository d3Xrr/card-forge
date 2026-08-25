import type { CardOverrides } from '../models/card-overrides';
import type { ItemCardData } from '../models/item';
import type { PrintQueueSummary } from './print-queue-planner';

export type ArtworkEditorMode = 'source' | 'none' | 'vault' | 'local' | 'https';

export interface VariantPreservationNotice {
	title: 'Variant changed';
	message: 'Custom card text was preserved.';
	actionLabel: string;
}

export interface ArtworkEditorPresentation {
	showVaultPath: boolean;
	showLocalFile: boolean;
	showHttpsUrl: boolean;
	showPersistenceChoice: boolean;
	applyAction: 'none' | 'valid-path' | 'file-selection' | 'explicit-use';
}

export interface VaultArtworkValidation {
	path: string;
	valid: boolean;
	message?: string;
}

export interface MissingArtworkWarning {
	title: 'Artwork missing';
	message: string;
	showChooseAgain: true;
	showUseSourceArtwork: boolean;
}

export interface PreviewStatusChip {
	label: string;
	tone: 'variant' | 'edited' | 'unsaved' | 'warning';
}

export interface PreviewModeState {
	previewActive: boolean;
	editActive: boolean;
	designActive: boolean;
	sourceActive: boolean;
	showCard: boolean;
	showEditor: boolean;
	showDesign: boolean;
	showSourceNote: boolean;
	showGlobalPreviewActions: boolean;
}

export type PreviewMode = 'preview' | 'edit' | 'design' | 'source-note';

export function createVariantPreservationNotice(
	variantLabel: string,
	customTextWasPreserved: boolean,
): VariantPreservationNotice | undefined {
	return customTextWasPreserved
		? {
			title: 'Variant changed',
			message: 'Custom card text was preserved.',
			actionLabel: `Use ${variantLabel} text`,
		}
		: undefined;
}

export function getArtworkEditorPresentation(
	mode: ArtworkEditorMode,
): ArtworkEditorPresentation {
	return {
		showVaultPath: mode === 'vault',
		showLocalFile: mode === 'local',
		showHttpsUrl: mode === 'https',
		showPersistenceChoice: mode === 'local' || mode === 'https',
		applyAction: mode === 'vault'
			? 'valid-path'
			: mode === 'local'
				? 'file-selection'
				: mode === 'https'
					? 'explicit-use'
					: 'none',
	};
}

export function validateVaultArtworkPath(
	input: string,
	isAvailableImage: (path: string) => boolean,
): VaultArtworkValidation {
	const path = input.trim().replaceAll('\\', '/').replace(/^\/+/, '');
	if (!path) {
		return {
			path,
			valid: false,
			message: 'Choose an image from the vault.',
		};
	}
	if (!isAvailableImage(path)) {
		return {
			path,
			valid: false,
			message: 'Choose an existing supported image from the vault.',
		};
	}
	return { path, valid: true };
}

export function isArtworkUseKey(key: string): boolean {
	return key === 'Enter';
}

export function createMissingArtworkWarning(
	isMissing: boolean,
	hasSourceArtwork: boolean,
): MissingArtworkWarning | undefined {
	return isMissing
		? {
			title: 'Artwork missing',
			message: 'This temporary image was only available for the previous session.',
			showChooseAgain: true,
			showUseSourceArtwork: hasSourceArtwork,
		}
		: undefined;
}

export function createTemporaryArtworkStatus(): string {
	return 'Temporary until restart';
}

export function createPreviewModeState(mode: PreviewMode): PreviewModeState {
	return {
		previewActive: mode === 'preview',
		editActive: mode === 'edit',
		designActive: mode === 'design',
		sourceActive: mode === 'source-note',
		showCard: mode !== 'source-note',
		showEditor: mode === 'edit',
		showDesign: mode === 'design',
		showSourceNote: mode === 'source-note',
		showGlobalPreviewActions: mode === 'preview',
	};
}

export function createPreviewStatusChips(input: {
	variantLabel?: string;
	edited: boolean;
	unsaved: boolean;
	artworkMissing: boolean;
}): readonly PreviewStatusChip[] {
	return [
		...(input.variantLabel
			? [{ label: input.variantLabel, tone: 'variant' as const }]
			: []),
		...(input.edited
			? [{ label: 'Edited', tone: 'edited' as const }]
			: []),
		...(input.unsaved
			? [{ label: 'Unsaved changes', tone: 'unsaved' as const }]
			: []),
		...(input.artworkMissing
			? [{ label: 'Artwork missing', tone: 'warning' as const }]
			: []),
	];
}

export function resolveRulesDraftOverride(
	value: string,
	currentDefault: string,
): string | undefined {
	return value === currentDefault ? undefined : value;
}

export interface QueueSummaryPresentation {
	visible: string;
	detail: string;
}

export function createQueueProvenanceLabel(
	source: ItemCardData | undefined,
	effective: ItemCardData | undefined,
	overrides: CardOverrides | undefined,
): string | undefined {
	const explicitTitle = overrides?.title?.trim();
	if (!source || !effective || !explicitTitle) {
		return undefined;
	}
	if (
		normalizeTitle(explicitTitle) === normalizeTitle(source.name)
		|| normalizeTitle(effective.name) === normalizeTitle(source.name)
	) {
		return undefined;
	}
	return `from ${source.name}`;
}

export function createQueueSummaryPresentation(
	summary: Pick<PrintQueueSummary, 'itemTypes' | 'copies' | 'physicalCards' | 'a4Pages'>,
): QueueSummaryPresentation {
	return {
		visible: `${summary.physicalCards} cards · ${summary.a4Pages} A4`,
		detail: `${summary.itemTypes} item ${summary.itemTypes === 1 ? 'type' : 'types'} · ${summary.copies} ${summary.copies === 1 ? 'copy' : 'copies'} · ${summary.physicalCards} physical ${summary.physicalCards === 1 ? 'card' : 'cards'} · ${summary.a4Pages} A4 ${summary.a4Pages === 1 ? 'page' : 'pages'}`,
	};
}

function normalizeTitle(value: string): string {
	return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}
