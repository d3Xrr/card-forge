import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('unordered card bullets use a flow-neutral larger centered marker', () => {
	const css = readFileSync('styles.css', 'utf8');
	const rule = css.match(/\.ttrpg-card-forge-card ul\.ttrpg-card-forge-card__list > li::before\s*\{([^}]+)\}/u)?.[1] ?? '';
	assert.match(rule, /position:\s*absolute/iu);
	assert.match(rule, /width:\s*0\.56em/iu);
	assert.match(rule, /height:\s*0\.56em/iu);
	assert.match(rule, /top:\s*0\.64em/iu);
	assert.match(rule, /transform:\s*translateY\(-50%\)/iu);
	assert.doesNotMatch(css, /ol\.ttrpg-card-forge-card__list[^}]*list-style:\s*none/iu);
});
