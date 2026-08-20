import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { serializeItemCardPlanSignature } from '../src/renderer/item-card-plan-signature';
import { planItemCardPages } from '../src/renderer/item-card-planner';

void test('unordered card bullets use a flow-neutral larger centered marker', () => {
	const css = readFileSync('styles.css', 'utf8');
	const rule = css.match(/\.ttrpg-card-forge-card ul\.ttrpg-card-forge-card__list > li::before\s*\{([^}]+)\}/u)?.[1] ?? '';
	assert.match(rule, /position:\s*absolute/iu);
	assert.match(rule, /content:\s*["']•["']/u);
	assert.match(rule, /height:\s*1\.28em/iu);
	assert.match(rule, /place-items:\s*center/iu);
	assert.match(rule, /transform:\s*scale\(1\.35\)/iu);
	assert.doesNotMatch(rule, /background:\s*currentColor/iu);
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
	assert.equal(hash, '7ee012adeb9419d9b8c12525f5c7294d96a80bea46cbf432a722c8a626e5f565');
});
