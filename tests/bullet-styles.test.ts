import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { serializeItemCardPlanSignature } from '../src/renderer/item-card-plan-signature';
import { planItemCardPages } from '../src/renderer/item-card-planner';

void test('unordered card bullets use a flow-neutral larger centered marker', () => {
	const css = readFileSync('styles.css', 'utf8');
	const unorderedList = getRule(
		css,
		'.ttrpg-card-forge-card ul.ttrpg-card-forge-card__list',
	);
	const listItem = getRule(css, '.ttrpg-card-forge-card__list li');
	const markerSelector = '.ttrpg-card-forge-card .ttrpg-card-forge-card__description ul.ttrpg-card-forge-card__list > li::before';
	const marker = getRule(css, markerSelector);

	assert.match(unorderedList, /list-style:\s*none/iu);
	assert.match(marker, /content:\s*["']•["']/u);
	assert.match(marker, /position:\s*absolute/iu);
	assert.match(marker, /float:\s*none/iu);
	assert.match(marker, /display:\s*grid/iu);
	assert.match(marker, /place-items:\s*center/iu);
	assert.match(marker, /height:\s*1\.3em/iu);
	assert.match(marker, /font-family:\s*inherit/iu);
	assert.match(marker, /font-size:\s*1em/iu);
	assert.match(marker, /line-height:\s*1/iu);
	assert.match(marker, /color:\s*currentColor/iu);
	assert.match(marker, /transform:\s*none/iu);
	assert.match(marker, /margin:\s*0/iu);
	assert.match(marker, /padding:\s*0/iu);
	assert.match(marker, /inset-inline-start:\s*-1\.08em/iu);
	assert.match(
		getRule(css, '.ttrpg-card-forge-card__list'),
		/padding-inline-start:\s*1\.35em/iu,
	);
	assert.match(listItem, /padding-inline-start:\s*0\.1em/iu);
	assert.equal(countRule(css, markerSelector), 1);
	assert.doesNotMatch(css, /(^|[}])\s*ul[^}]*>\s*li::before\s*[{]/iu);
	assert.doesNotMatch(css, /\.ttrpg-card-forge-card[^}]*ol[^}]*::before\s*[{]/iu);
	assert.doesNotMatch(css, /ol\.ttrpg-card-forge-card__list[^}]*list-style:\s*none/iu);
});

void test('representative list content retains its physical planning signature', () => {
	const pages = planItemCardPages({
		filePath: 'items/synthetic-list-armor.md',
		name: 'Synthetic List Armor',
		description: [
			'Protective rules.',
			'',
			'- **Stealth**: The wearer has a situational limitation.',
			'- **Weight**: 65 lb.',
		].join('\n'),
		hasImage: false,
		rawTags: [],
	}, {
		artworkAvailable: false,
		artworkOrientation: 'landscape',
	});
	const hash = createHash('sha256')
		.update(serializeItemCardPlanSignature(pages))
		.digest('hex');
	assert.equal(pages.length, 1);
	assert.equal(hash, 'caaaac91af5b6c2fd536b1a365ad673d8b0512be94af53bef1764b6f44b84e50');
});

function getRule(css: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return css.match(new RegExp(`${escaped}\\s*[{]([^}]+)[}]`, 'u'))?.[1] ?? '';
}

function countRule(css: string, selector: string): number {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return [...css.matchAll(new RegExp(`${escaped}\\s*[{]`, 'gu'))].length;
}
