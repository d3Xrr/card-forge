import type { CardOverrides, CardStatOverrides } from '../models/card-overrides';
import { normalizeCardOverrides } from './card-overrides';

export type CardEditorTopLevelField = Exclude<keyof CardOverrides, 'stats' | 'variant'>;

export type CardEditorActionId =
	| 'reset-edits'
	| 'add-to-queue'
	| 'save-changes'
	| 'discard-changes'
	| 'reset-to-source';

export interface CardEditorAction {
	id: CardEditorActionId;
	label: string;
	primary?: boolean;
}

export function getCardEditorActions(
	context: 'source-draft' | 'queue-entry',
): readonly CardEditorAction[] {
	return context === 'source-draft'
		? [
			{ id: 'reset-edits', label: 'Reset edits' },
			{ id: 'add-to-queue', label: 'Add to print queue', primary: true },
		]
		: [
			{ id: 'save-changes', label: 'Save changes', primary: true },
			{ id: 'discard-changes', label: 'Discard changes' },
			{ id: 'reset-to-source', label: 'Reset to source' },
		];
}

/** Changes only the selected default provider; explicit field overrides remain intact. */
export function selectDraftVariant(
	value: CardOverrides | undefined,
	variantId: string | undefined,
): CardOverrides | undefined {
	const draft = structuredClone(value ?? {});
	if (variantId?.trim()) {
		draft.variant = { id: variantId.trim() };
	} else {
		delete draft.variant;
	}
	return normalizeCardOverrides(draft);
}

/** Restores one field to the current source/variant default. */
export function resetDraftField(
	value: CardOverrides | undefined,
	field: CardEditorTopLevelField,
): CardOverrides | undefined {
	const draft = structuredClone(value ?? {});
	delete draft[field];
	return normalizeCardOverrides(draft);
}

export function resetDraftStatField(
	value: CardOverrides | undefined,
	field: keyof CardStatOverrides,
): CardOverrides | undefined {
	const draft = structuredClone(value ?? {});
	if (draft.stats) {
		delete draft.stats[field];
		if (Object.keys(draft.stats).length === 0) {
			delete draft.stats;
		}
	}
	return normalizeCardOverrides(draft);
}

export function hasExplicitDraftField(
	value: CardOverrides | undefined,
	field: CardEditorTopLevelField,
): boolean {
	return Boolean(value && Object.prototype.hasOwnProperty.call(value, field));
}

export function hasExplicitDraftStatField(
	value: CardOverrides | undefined,
	field: keyof CardStatOverrides,
): boolean {
	return Boolean(value?.stats && Object.prototype.hasOwnProperty.call(value.stats, field));
}
