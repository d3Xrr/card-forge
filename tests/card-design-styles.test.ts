import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync('styles.css', 'utf8');
const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
const settings = readFileSync('src/settings.ts', 'utf8');
const main = readFileSync('src/main.ts', 'utf8');
const fitService = readFileSync('src/renderer/item-card-fit-service.ts', 'utf8');
const renderer = readFileSync('src/renderer/item-card-renderer.ts', 'utf8');

void test('Design is a peer mode using the real responsive preview architecture', () => {
	assert.match(view, /text: 'Preview'[\s\S]*text: 'Edit card'[\s\S]*text: 'Design'[\s\S]*text: 'Source note'/u);
	assert.match(view, /ttrpg-card-forge__design[\s\S]*ttrpg-card-forge__card-preview-region/u);
	assert.match(css, /preview\.is-editing[^}]*preview-content[^}]*grid-template-columns/isu);
	assert.match(css, /preview\.is-editing[^}]*ttrpg-card-forge__editor/isu);
	assert.match(css, /@container ttrpg-card-forge-preview \(max-width: 44rem\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
});

void test('physical themes are scoped and use semantic tokens without global Obsidian theming', () => {
	const cardRule = getRule('.ttrpg-card-forge-card');
	assert.match(cardRule, /--ttrpg-card-background:/u);
	assert.match(cardRule, /--ttrpg-card-text:/u);
	assert.match(cardRule, /--ttrpg-card-divider:/u);
	assert.match(cardRule, /linear-gradient\(180deg,\s*#191a1d,\s*#0d0e10\)/u);
	assert.match(cardRule, /--ttrpg-card-title-text:\s*#f6f0df/u);
	assert.match(cardRule, /--ttrpg-card-body-text:\s*#e6e0d5/u);
	assert.match(cardRule, /--ttrpg-card-page-number-mix:\s*#ddd3c1/u);
	assert.match(css, /\.ttrpg-card-forge-card\[data-theme="light"\]\s*\{/u);
	assert.match(css, /\.ttrpg-card-forge-card\[data-theme="printer-friendly"\]\s*\{/u);
	assert.doesNotMatch(css, /(?:^|\n)\s*\[data-theme="(?:light|printer-friendly)"\]\s*\{/u);
});

void test('Light and Printer Friendly retain geometry while Printer Friendly reduces ink', () => {
	const light = getRule('.ttrpg-card-forge-card[data-theme="light"]');
	const printer = getRule('.ttrpg-card-forge-card[data-theme="printer-friendly"]');
	assert.match(light, /--ttrpg-card-background:[^;]*#fbfaf6/u);
	assert.match(light, /--ttrpg-card-body-text:\s*#302d26/u);
	assert.match(printer, /--ttrpg-card-background:\s*#fff/u);
	assert.match(printer, /--ttrpg-card-shadow:\s*none/u);
	assert.match(printer, /--ttrpg-card-artwork-overlay:\s*none/u);
	for (const rule of [light, printer]) {
		assert.doesNotMatch(rule, /(?:padding|font-size|line-height|width|height):/u);
	}
});

void test('Compact uses visibly tighter bounded typography without scaling card geometry', () => {
	const compactRules = css.match(/\.ttrpg-card-forge-card\[data-density="compact"\][\s\S]*?(?=\n@container|$)/u)?.[0] ?? '';
	assert.match(compactRules, /padding-block:/u);
	assert.match(compactRules, /margin-block-end:/u);
	assert.match(compactRules, /line-height:\s*1\.18/u);
	assert.doesNotMatch(compactRules, /font-size:/u);
	assert.doesNotMatch(compactRules, /transform:\s*scale/u);
});

void test('layout-update feedback is delayed, accessible, and preserves the old card', () => {
	assert.match(view, /LAYOUT_UPDATE_STATUS_MESSAGE\s*=\s*'Updating card layout…'/u);
	assert.match(view, /LAYOUT_UPDATE_FEEDBACK_DELAY_MS\s*=\s*150/u);
	assert.match(view, /ttrpg-card-forge__layout-status[\s\S]*'aria-live':\s*'polite'/u);
	assert.match(css, /preview\.is-layout-updating[^}]*scaled-card[^}]*opacity:\s*0\.88/isu);
	assert.doesNotMatch(view, /Planning physical card pages/u);
});

void test('canonical fit owns measured stat packing and Compact typography ceiling', () => {
	assert.match(fitService, /standard\.bodyFontPoints[\s\S]*fitResolved/u);
	assert.match(fitService, /requiredWidth:\s*cells\[index\]\?\.scrollWidth/u);
	assert.match(fitService, /availableWidth:\s*cells\[index\]\?\.clientWidth/u);
	assert.match(fitService, /planPages\(\{\s*\.\.\.planningOptions,\s*compactStatRowSpans\s*\}\)/u);
	assert.match(renderer, /renderItemStats\([\s\S]*page\.compactStatRowSpans/u);
});

void test('global defaults feed source, batch, and command adds without mutating queue snapshots', () => {
	assert.match(settings, /defaultCardTheme:\s*'dark'/u);
	assert.match(settings, /defaultArtworkSize:\s*'standard'/u);
	assert.match(settings, /defaultCardDensity:\s*'standard'/u);
	assert.match(settings, /standard:\s*'Standard',\s*compact:\s*'Compact',\s*auto:\s*'Auto'/u);
	assert.match(settings, /dark:\s*'Dark'[\s\S]*light:\s*'Light'[\s\S]*'printer-friendly':\s*'Printer Friendly'/u);
	assert.match(view, /getCurrentDraftDesign\(\)[\s\S]*createCardDesignProfile\(getCardDesignDefaults\(this\.getSettings\(\)\)\)/u);
	assert.match(view, /addMany\([\s\S]*design:\s*createCardDesignProfile\(getCardDesignDefaults\(this\.getSettings\(\)\)\)/u);
	assert.match(main, /addCurrentIndexedItemToQueue\([\s\S]*createCardDesignProfile\(getCardDesignDefaults\(this\.settings\)\)/u);
	assert.doesNotMatch(main, /updateDefaultCardTheme[\s\S]{0,500}printQueue\.(?:update|replace|clear)/u);
});

function getRule(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]+)\\}`, 'u'))?.[1] ?? '';
}
