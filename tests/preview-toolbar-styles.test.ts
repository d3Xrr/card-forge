import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('preview toolbar retains stable left, center, and right zones', () => {
	const css = readFileSync('styles.css', 'utf8');
	const toolbar = getRule(css, '.ttrpg-card-forge__preview-toolbar');
	const modes = getRule(css, '.ttrpg-card-forge__mode-toggle');
	const pagination = getRule(css, '.ttrpg-card-forge__page-navigation');
	const status = getRule(css, '.ttrpg-card-forge__preview-indicator');

	assert.match(toolbar, /grid-template-columns:\s*minmax\(max-content,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/iu);
	assert.match(toolbar, /margin-block-start:\s*var\(--size-4-1\)/iu);
	assert.match(modes, /grid-column:\s*1/iu);
	assert.match(modes, /justify-self:\s*start/iu);
	assert.match(pagination, /grid-column:\s*2/iu);
	assert.match(pagination, /justify-self:\s*center/iu);
	assert.match(status, /grid-column:\s*3/iu);
	assert.match(status, /justify-self:\s*end/iu);
});

void test('narrow three-mode toolbar keeps pagination discoverable without overflow', () => {
	const css = readFileSync('styles.css', 'utf8');
	const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
	const narrowStart = css.indexOf('@container ttrpg-card-forge (max-width: 420px)');
	assert.ok(narrowStart >= 0);
	const narrow = css.slice(narrowStart);
	assert.match(view, /text: 'Preview'[\s\S]*text: 'Edit card'[\s\S]*text: 'Source note'/u);
	assert.match(narrow, /preview-toolbar[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/isu);
	assert.match(narrow, /mode-toggle[^}]*width:\s*100%/isu);
	assert.match(narrow, /preview-indicator[^}]*grid-column:\s*1/isu);
	assert.match(narrow, /page-navigation[^}]*grid-row:\s*3/isu);
	assert.match(narrow, /page-navigation[^}]*grid-column:\s*1\s*\/\s*-1/isu);
});

function getRule(css: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'u'))?.[1] ?? '';
}
