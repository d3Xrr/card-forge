import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
const css = readFileSync('styles.css', 'utf8');

void test('Preview and Design expose explicit bounded Front and Back selectors', () => {
	assert.match(view, /aria-label': 'Preview card side'[\s\S]*text: 'Front'[\s\S]*text: 'Back'/u);
	assert.match(view, /aria-label': 'Design card side'[\s\S]*\['front', 'back'\]/u);
	assert.match(view, /private setPreviewSide\(side: CardSide\)[\s\S]*renderCurrentPage/u);
	assert.match(view, /this\.previewSide === 'front'[\s\S]*renderFront[\s\S]*renderBack/u);
});

void test('Design offers all bounded back styles and framing controls', () => {
	for (const style of ['none', 'generic', 'rarity', 'item-type', 'artwork', 'custom-image']) {
		assert.ok(view.includes(`${style.includes('-') ? `'${style}'` : style}:`));
	}
	assert.match(view, /'Fit'[\s\S]*fit: 'Fit'[\s\S]*fill: 'Fill'/u);
	assert.match(view, /'Zoom'[\s\S]*'Position X'[\s\S]*'Position Y'/u);
	assert.match(view, /text: 'Reset framing'/u);
	assert.match(view, /Reset front design'[\s\S]*Reset back design'/u);
});

void test('Workflow owns duplex, backs, orientation, and bounded calibration controls', () => {
	assert.match(view, /text: 'Printing'/u);
	assert.match(view, /'single-sided': 'Single-sided'[\s\S]*'manual-duplex': 'Manual duplex'[\s\S]*'automatic-duplex': 'Automatic duplex'/u);
	assert.match(view, /'no-backs': 'No backs'[\s\S]*'use-card-backs': 'Use card back designs'/u);
	assert.match(view, /'long-edge': 'Long edge'[\s\S]*'short-edge': 'Short edge'/u);
	assert.match(view, /Back X \(mm\)[\s\S]*Back Y \(mm\)/u);
	assert.match(css, /ttrpg-card-forge__print-controls[\s\S]*grid-template-columns/u);
});

void test('new controls retain narrow responsive behavior and canonical back geometry', () => {
	assert.match(css, /@container ttrpg-card-forge \(max-width: 420px\)[\s\S]*side-toggle[\s\S]*grid-row:\s*2/iu);
	assert.match(css, /ttrpg-card-forge-card--back[\s\S]*ttrpg-card-forge-card__back-field/u);
	assert.doesNotMatch(css, /ttrpg-card-forge-card--back[^}]*\bwidth\s*:/u);
	assert.doesNotMatch(css, /ttrpg-card-forge-card--back[^}]*\bheight\s*:/u);
});
