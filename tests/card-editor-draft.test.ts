import assert from 'node:assert/strict';
import test from 'node:test';

import type { CardOverrides } from '../src/models/card-overrides';
import type { ItemCardData } from '../src/models/item';
import {
	getCardEditorActions,
	hasExplicitDraftField,
	resetDraftField,
	resetDraftStatField,
	selectDraftVariant,
} from '../src/services/card-editor-draft';
import { applyCardOverrides } from '../src/services/card-overrides';

const variantA = item('Variant A', 'Variant A rules', '1d8');
const variantB = item('Variant B', 'Variant B rules', '1d10');

void test('variant selection replaces untouched defaults', () => {
	const draft = selectDraftVariant(undefined, 'variant-a');
	assert.deepEqual(draft, { variant: { id: 'variant-a' } });
	assert.equal(effective(draft, variantA).description, 'Variant A rules');
	assert.equal(effective(draft, variantA).damage, '1d8');
});

void test('custom Rules survive a variant change while untouched fields update', () => {
	const edited: CardOverrides = { rulesMarkdown: 'Custom rules' };
	const draft = selectDraftVariant(edited, 'variant-a');
	const result = effective(draft, variantA);
	assert.equal(result.description, 'Custom rules');
	assert.equal(result.name, 'Variant A');
	assert.equal(result.damage, '1d8');
	assert.equal(hasExplicitDraftField(draft, 'rulesMarkdown'), true);
});

void test('reset Rules adopts the currently selected variant canonical Rules', () => {
	let draft = selectDraftVariant(
		{ variant: { id: 'variant-a' }, rulesMarkdown: 'Custom rules' },
		'variant-b',
	);
	assert.equal(effective(draft, variantB).description, 'Custom rules');
	draft = resetDraftField(draft, 'rulesMarkdown');
	assert.equal(effective(draft, variantB).description, 'Variant B rules');
	assert.equal(hasExplicitDraftField(draft, 'rulesMarkdown'), false);
});

void test('a custom title survives variant changes while Rules and stats follow defaults', () => {
	const draft = selectDraftVariant({ title: 'Table Sword' }, 'variant-b');
	const result = effective(draft, variantB);
	assert.equal(result.name, 'Table Sword');
	assert.equal(result.description, 'Variant B rules');
	assert.equal(result.damage, '1d10');
});

void test('clean A to B variant change updates all relevant defaults', () => {
	const fromA = selectDraftVariant(undefined, 'variant-a');
	const toB = selectDraftVariant(fromA, 'variant-b');
	assert.deepEqual(effective(toB, variantB), variantB);
});

void test('individual stat reset removes only that explicit override', () => {
	const draft = resetDraftStatField({
		title: 'Custom title',
		stats: { damage: '2d6', range: '20/60' },
	}, 'damage');
	assert.deepEqual(draft, {
		title: 'Custom title',
		stats: { range: '20/60' },
	});
});

void test('source drafts and queue entries expose distinct action semantics', () => {
	assert.deepEqual(
		getCardEditorActions('source-draft').map((action) => action.label),
		['Reset edits', 'Add to print queue'],
	);
	assert.deepEqual(
		getCardEditorActions('queue-entry').map((action) => action.label),
		['Save changes', 'Discard changes', 'Reset to source'],
	);
	assert.equal(
		getCardEditorActions('source-draft').some((action) => /apply|discard/iu.test(action.label)),
		false,
	);
});

function effective(overrides: CardOverrides | undefined, base: ItemCardData): ItemCardData {
	return applyCardOverrides(base, overrides).item;
}

function item(name: string, description: string, damage: string): ItemCardData {
	return {
		filePath: `items/${name}.md`,
		name,
		description,
		damage,
		hasImage: false,
		rawTags: [],
	};
}
