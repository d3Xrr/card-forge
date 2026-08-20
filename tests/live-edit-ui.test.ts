import assert from 'node:assert/strict';
import test from 'node:test';

import { createCardOverridesFingerprint } from '../src/services/card-overrides';
import { resetDraftField } from '../src/services/card-editor-draft';
import {
	createMissingArtworkWarning,
	createPreviewModeState,
	createPreviewStatusChips,
	createTemporaryArtworkStatus,
	createVariantPreservationNotice,
	getArtworkEditorPresentation,
	isArtworkUseKey,
	resolveRulesDraftOverride,
	validateVaultArtworkPath,
} from '../src/services/live-edit-ui';

void test('variant preservation notice uses the approved copy and clears with canonical text', () => {
	assert.deepEqual(createVariantPreservationNotice('Warhammer', true), {
		title: 'Variant changed',
		message: 'Custom card text was preserved.',
		actionLabel: 'Use Warhammer text',
	});
	assert.equal(createVariantPreservationNotice('Warhammer', false), undefined);
	assert.equal(resolveRulesDraftOverride('Variant rules', 'Variant rules'), undefined);
	assert.equal(resolveRulesDraftOverride('Custom rules', 'Variant rules'), 'Custom rules');
	assert.deepEqual(resetDraftField({
		variant: { id: 'warhammer' },
		rulesMarkdown: 'Custom rules',
	}, 'rulesMarkdown'), {
		variant: { id: 'warhammer' },
	});
});

void test('artwork modes expose only their contextual inputs and application action', () => {
	assert.deepEqual(getArtworkEditorPresentation('source'), {
		showVaultPath: false,
		showLocalFile: false,
		showHttpsUrl: false,
		showPersistenceChoice: false,
		applyAction: 'none',
	});
	assert.deepEqual(getArtworkEditorPresentation('none'), getArtworkEditorPresentation('source'));
	assert.equal(getArtworkEditorPresentation('vault').applyAction, 'valid-path');
	assert.equal(getArtworkEditorPresentation('vault').showVaultPath, true);
	assert.equal(getArtworkEditorPresentation('local').applyAction, 'file-selection');
	assert.equal(getArtworkEditorPresentation('local').showLocalFile, true);
	assert.equal(getArtworkEditorPresentation('https').applyAction, 'explicit-use');
	assert.equal(getArtworkEditorPresentation('https').showHttpsUrl, true);
	assert.equal(getArtworkEditorPresentation('https').showPersistenceChoice, true);
});

void test('vault paths apply only when valid and HTTPS applies only on Enter or button use', () => {
	const available = new Set(['Card Forge Assets/warhammer.png']);
	assert.deepEqual(
		validateVaultArtworkPath('\\Card Forge Assets\\warhammer.png', (path) => available.has(path)),
		{ path: 'Card Forge Assets/warhammer.png', valid: true },
	);
	assert.equal(validateVaultArtworkPath('missing.png', (path) => available.has(path)).valid, false);
	assert.equal(validateVaultArtworkPath('', (path) => available.has(path)).message, 'Choose an image from the vault.');
	assert.equal(isArtworkUseKey('Enter'), true);
	assert.equal(isArtworkUseKey('a'), false);
});

void test('missing temporary artwork exposes recovery without changing queue identity', () => {
	assert.deepEqual(createMissingArtworkWarning(true, true), {
		title: 'Artwork missing',
		message: 'This temporary image was only available for the previous session.',
		showChooseAgain: true,
		showUseSourceArtwork: true,
	});
	assert.equal(createMissingArtworkWarning(false, true), undefined);
	assert.equal(createMissingArtworkWarning(true, false)?.showUseSourceArtwork, false);
	assert.equal(
		createTemporaryArtworkStatus('warhammer.png'),
		'Temporary artwork · available until restart · warhammer.png',
	);
});

void test('preview toolbar chips are concise UI state and do not enter override fingerprints', () => {
	const overrides = { title: 'Warhammer +1' };
	const before = createCardOverridesFingerprint(overrides);
	assert.deepEqual(createPreviewStatusChips({
		variantLabel: 'Warhammer',
		edited: true,
		unsaved: true,
		artworkMissing: true,
	}), [
		{ label: 'Warhammer', tone: 'variant' },
		{ label: 'Edited', tone: 'edited' },
		{ label: 'Unsaved changes', tone: 'unsaved' },
		{ label: 'Artwork missing', tone: 'warning' },
	]);
	assert.equal(createCardOverridesFingerprint(overrides), before);
	assert.deepEqual(createPreviewModeState(false), {
		previewActive: true,
		editActive: false,
	});
	assert.deepEqual(createPreviewModeState(true), {
		previewActive: false,
		editActive: true,
	});
});
