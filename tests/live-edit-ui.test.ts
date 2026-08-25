import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ItemCardData } from '../src/models/item';
import { createCardOverridesFingerprint } from '../src/services/card-overrides';
import { resetDraftField } from '../src/services/card-editor-draft';
import {
	createMissingArtworkWarning,
	createPreviewModeState,
	createPreviewStatusChips,
	createQueueProvenanceLabel,
	createQueueSummaryPresentation,
	createTemporaryArtworkStatus,
	createVariantPreservationNotice,
	getArtworkEditorPresentation,
	isArtworkUseKey,
	resolveRulesDraftOverride,
	validateVaultArtworkPath,
} from '../src/services/live-edit-ui';

const queueSource: ItemCardData = {
	filePath: 'items/plus-one-weapon.md',
	name: '+1 Weapon',
	description: 'Source rules',
	hasImage: false,
	rawTags: [],
};

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
	assert.equal(createTemporaryArtworkStatus(), 'Temporary until restart');
});

void test('temporary artwork uses one concise accessible persistence row', () => {
	const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
	assert.match(view, /ttrpg-card-forge__artwork-persistence/u);
	assert.match(view, /ttrpg-card-forge__artwork-persist-checkbox/u);
	assert.match(view, /createTemporaryArtworkStatus\(\)/u);
	assert.match(view, /Save to vault/u);
	assert.match(view, /title: 'Save imported artwork to the vault/u);
	assert.doesNotMatch(view, /Keeps this artwork after Obsidian restarts/u);
	assert.doesNotMatch(view, /Load image/u);
	assert.match(view, /text: 'Use image'/u);
});

void test('temporary artwork checkbox is excluded from full-width editor inputs', () => {
	const css = readFileSync('styles.css', 'utf8');
	const persistence = getCssRule(css, '.ttrpg-card-forge__artwork-persistence');
	const label = getCssRule(css, '.ttrpg-card-forge__artwork-persist');
	const checkbox = getCssRule(css, '.ttrpg-card-forge__artwork-persist-checkbox');

	assert.match(persistence, /display:\s*flex/iu);
	assert.match(persistence, /justify-content:\s*space-between/iu);
	assert.match(persistence, /flex-wrap:\s*wrap/iu);
	assert.match(label, /white-space:\s*nowrap/iu);
	assert.match(checkbox, /width:\s*var\(--checkbox-size\)/iu);
	assert.match(checkbox, /flex:\s*0\s+0\s+auto/iu);
	assert.doesNotMatch(checkbox, /width:\s*100%/iu);
	assert.match(css, /editor-field input:not\(\[type="checkbox"\]\)/u);
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
	assert.deepEqual(createPreviewModeState('preview'), {
		previewActive: true,
		editActive: false,
		designActive: false,
		sourceActive: false,
		showCard: true,
		showEditor: false,
		showDesign: false,
		showSourceNote: false,
		showGlobalPreviewActions: true,
	});
	assert.deepEqual(createPreviewModeState('edit'), {
		previewActive: false,
		editActive: true,
		designActive: false,
		sourceActive: false,
		showCard: true,
		showEditor: true,
		showDesign: false,
		showSourceNote: false,
		showGlobalPreviewActions: false,
	});
	assert.deepEqual(createPreviewModeState('design'), {
		previewActive: false,
		editActive: false,
		designActive: true,
		sourceActive: false,
		showCard: true,
		showEditor: false,
		showDesign: true,
		showSourceNote: false,
		showGlobalPreviewActions: false,
	});
	assert.deepEqual(createPreviewModeState('source-note'), {
		previewActive: false,
		editActive: false,
		designActive: false,
		sourceActive: true,
		showCard: false,
		showEditor: false,
		showDesign: false,
		showSourceNote: true,
		showGlobalPreviewActions: false,
	});
});

void test('queue provenance is reserved for explicit title edits and omits paths', () => {
	assert.equal(createQueueProvenanceLabel(queueSource, queueSource, undefined), undefined);
	assert.equal(createQueueProvenanceLabel(
		queueSource,
		{ ...queueSource, name: '+1 Quarterstaff' },
		{ variant: { id: 'quarterstaff' } },
	), undefined);
	assert.equal(createQueueProvenanceLabel(
		queueSource,
		{ ...queueSource, name: 'The Spindle' },
		{ title: 'The Spindle' },
	), 'from +1 Weapon');
	assert.equal(createQueueProvenanceLabel(
		queueSource,
		{ ...queueSource, name: '+1 Weapon' },
		{ title: ' +1 Weapon ' },
	), undefined);
	assert.equal(createQueueProvenanceLabel(undefined, undefined, { title: 'The Spindle' }), undefined);
});

void test('queue summary keeps physical cards and A4 visible while retaining details in metadata', () => {
	assert.deepEqual(createQueueSummaryPresentation({
		itemTypes: 5,
		copies: 5,
		physicalCards: 11,
		a4Pages: 2,
	}), {
		visible: '11 cards · 2 A4',
		detail: '5 item types · 5 copies · 11 physical cards · 2 A4 pages',
	});
	assert.deepEqual(createQueueSummaryPresentation({
		itemTypes: 1,
		copies: 1,
		physicalCards: 1,
		a4Pages: 1,
	}), {
		visible: '1 cards · 1 A4',
		detail: '1 item type · 1 copy · 1 physical card · 1 A4 page',
	});
});

void test('queue provenance is rendered inside one wrapping title row', () => {
	const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
	const css = readFileSync('styles.css', 'utf8');
	const titleRowIndex = view.indexOf("cls: 'ttrpg-card-forge__queue-entry-title'");
	const nameIndex = view.indexOf("cls: 'ttrpg-card-forge__queue-entry-name'", titleRowIndex);
	const provenanceIndex = view.indexOf("cls: 'ttrpg-card-forge__queue-entry-provenance'", nameIndex);
	const badgeIndex = view.indexOf("cls: 'ttrpg-card-forge__edited-badge'", provenanceIndex);
	assert.ok(titleRowIndex >= 0 && nameIndex > titleRowIndex);
	assert.ok(provenanceIndex > nameIndex && badgeIndex > provenanceIndex);
	const titleRow = getCssRule(css, '.ttrpg-card-forge__queue-entry-title');
	assert.match(titleRow, /display:\s*flex/iu);
	assert.match(titleRow, /flex-wrap:\s*wrap/iu);
	assert.doesNotMatch(getCssRule(css, '.ttrpg-card-forge__queue-entry-provenance'), /margin-block-start/iu);
});

void test('Edit mode uses one responsive preview container without changing canonical card sizing', () => {
	const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
	const css = readFileSync('styles.css', 'utf8');
	const contentIndex = view.indexOf("cls: 'ttrpg-card-forge__preview-content'");
	const editorIndex = view.indexOf("cls: 'ttrpg-card-forge__editor'", contentIndex);
	const regionIndex = view.indexOf("cls: 'ttrpg-card-forge__card-preview-region'");
	const blockIndex = view.indexOf("cls: 'ttrpg-card-forge__card-preview-block'", regionIndex);
	const hostIndex = view.indexOf("cls: 'ttrpg-card-forge__card-host'", blockIndex);
	const viewportIndex = view.indexOf("cls: 'ttrpg-card-forge__scaled-card-viewport'", hostIndex);
	const scaledCardIndex = view.indexOf("cls: 'ttrpg-card-forge__scaled-card'", viewportIndex);
	const diagnosticsIndex = view.indexOf("cls: 'ttrpg-card-forge__diagnostics'", hostIndex);
	assert.ok(contentIndex >= 0 && editorIndex > contentIndex && regionIndex > editorIndex);
	assert.ok(blockIndex > regionIndex);
	assert.ok(hostIndex > blockIndex && viewportIndex > hostIndex && scaledCardIndex > viewportIndex);
	assert.ok(diagnosticsIndex > hostIndex);
	assert.match(getCssRule(css, '.ttrpg-card-forge__preview'), /container-name:\s*ttrpg-card-forge-preview/iu);
	assert.match(getCssRule(css, '.ttrpg-card-forge__preview-content'), /min-width:\s*0/iu);
	assert.match(getCssRule(css, '.ttrpg-card-forge__preview-content'), /min-height:\s*min-content/iu);
	assert.match(
		getCssRule(css, '.ttrpg-card-forge__preview.is-editing .ttrpg-card-forge__preview-content'),
		/grid-template-columns:\s*minmax\(16rem,\s*0\.8fr\)\s+minmax\(18rem,\s*1fr\)/iu,
	);
	assert.match(
		css,
		/@container ttrpg-card-forge-preview \(max-width:\s*44rem\)\s*\{[^}]*flex:\s*0\s+0\s+auto[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*grid-template-rows:\s*auto\s+auto/su,
	);
	assert.match(
		css,
		/@container ttrpg-card-forge-preview \(max-width:\s*44rem\)[\s\S]*ttrpg-card-forge__editor[^}]*grid-row:\s*1[\s\S]*ttrpg-card-forge__card-preview-region[^}]*grid-row:\s*2/iu,
	);
	assert.doesNotMatch(css, /@media[^}]*ttrpg-card-forge__preview/isu);
	assert.match(
		getCssRule(css, '.ttrpg-card-forge__card-preview-block'),
		/width:\s*min\(100%,\s*25rem\)/u,
	);
	assert.doesNotMatch(
		getCssRule(css, '.ttrpg-card-forge__card-host'),
		/750|1050|transform|scale/u,
	);
	const viewport = getCssRule(css, '.ttrpg-card-forge__scaled-card-viewport');
	assert.match(viewport, /position:\s*relative/iu);
	assert.match(viewport, /aspect-ratio:\s*5\s*\/\s*7/iu);
	assert.match(viewport, /overflow:\s*hidden/iu);
	assert.doesNotMatch(css, /margin-(?:block-)?start:\s*(?:[2-9]\d{2,}|\d{4,})px/iu);
	assert.match(view, /applyCanonicalCardSize\(physicalHost\)/u);
});

void test('workspace reflows before three columns squeeze the preview pane', () => {
	const css = readFileSync('styles.css', 'utf8');
	assert.match(
		getCssRule(css, '.ttrpg-card-forge__workspace'),
		/grid-template-columns:\s*minmax\(13rem,\s*18rem\)\s+minmax\(36rem,\s*1fr\)\s+minmax\(18rem,\s*22rem\)/iu,
	);
	assert.match(
		css,
		/@container ttrpg-card-forge \(max-width:\s*80rem\)[\s\S]*grid-template-columns:\s*minmax\(14rem,\s*18rem\)\s+minmax\(0,\s*1fr\)[\s\S]*ttrpg-card-forge__queue[^}]*grid-column:\s*1\s*\/\s*-1/iu,
	);
	assert.match(
		css,
		/@container ttrpg-card-forge \(max-width:\s*52rem\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)[\s\S]*ttrpg-card-forge__browser[^}]*max-height:\s*42vh/iu,
	);
});

function getCssRule(css: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'u'))?.[1] ?? '';
}
