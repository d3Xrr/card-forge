import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ARTWORK_ORIENTATION_RATIO_THRESHOLD,
	classifyArtworkOrientation,
	ITEM_ARTWORK_FIT_MODE,
} from '../src/renderer/artwork-orientation';
import { parseDescriptionHeading } from '../src/renderer/safe-markdown-renderer';
import { formatSourceDisplay } from '../src/renderer/source-formatter';

void test('recognizes H2 and H3 description headings without accepting other lines', () => {
	assert.deepEqual(parseDescriptionHeading('## Crafting'), { level: 2, text: 'Crafting' });
	assert.deepEqual(parseDescriptionHeading('### Limitations ###'), {
		level: 3,
		text: 'Limitations',
	});
	assert.equal(parseDescriptionHeading('# Item title'), null);
	assert.equal(parseDescriptionHeading('[Animus]. Any'), null);
});

void test('classifies portrait artwork from natural dimensions', () => {
	assert.equal(classifyArtworkOrientation(600, 1000), 'portrait');
});

void test('classifies landscape artwork from natural dimensions', () => {
	assert.equal(classifyArtworkOrientation(1400, 700), 'landscape');
});

void test('classifies square-like artwork and handles invalid dimensions', () => {
	assert.equal(classifyArtworkOrientation(1000, 900), 'square');
	assert.equal(classifyArtworkOrientation(0, 900), undefined);
	assert.equal(classifyArtworkOrientation(Number.NaN, 900), undefined);
	assert.equal(ARTWORK_ORIENTATION_RATIO_THRESHOLD, 1.35);
});

void test('item artwork defaults to preserving the complete image', () => {
	assert.equal(ITEM_ARTWORK_FIT_MODE, 'contain');
});

void test('formats Monsters of Drakkenheim sources for card and browser', () => {
	const sourceText = 'Monsters of Drakkenheim p. 395';
	assert.equal(
		formatSourceDisplay('monstersofdrakkenheim', sourceText),
		'Monsters of Drakkenheim · p. 395',
	);
	assert.equal(
		formatSourceDisplay('monstersofdrakkenheim', sourceText, 'compact'),
		'MoD',
	);
});

void test('formats the 2024 Dungeon Master’s Guide source and preserves pages', () => {
	assert.equal(
		formatSourceDisplay(
			'xdmg',
			"Dungeon Master's Guide (2024) p. 302. Available in the SRD and Free Rules",
		),
		"DMG '24 · p. 302",
	);
	assert.equal(formatSourceDisplay('xdmg', undefined, 'compact'), "DMG '24");
});

void test('source formatting falls back to readable source text or identifiers', () => {
	assert.equal(
		formatSourceDisplay('third-party', 'Third Party Almanac pp. 40–42'),
		'Third Party Almanac · pp. 40–42',
	);
	assert.equal(formatSourceDisplay('homebrew-source'), 'Homebrew Source');
	assert.equal(formatSourceDisplay(undefined, undefined), undefined);
});
