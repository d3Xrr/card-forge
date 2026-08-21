import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

void test('warm activation only reveals the existing Card Forge leaf', () => {
	const main = readFileSync('src/main.ts', 'utf8');
	const start = main.indexOf('async activateView');
	const end = main.indexOf('async updateItemFolder', start);
	const method = main.slice(start, end);
	const existingBranchStart = method.indexOf('if (existingLeaf)');
	const existingBranchEnd = method.indexOf("const leaf = this.app.workspace.getLeaf('tab')");
	const existingBranch = method.slice(existingBranchStart, existingBranchEnd);

	assert.match(existingBranch, /workspace\.revealLeaf\(existingLeaf\)/u);
	assert.doesNotMatch(
		existingBranch,
		/rebuildItemIndex|renderBrowser|renderPreview|renderQueue|setViewState|saveData/u,
	);
	assert.match(method, /'warm-refocus'/u);
	assert.match(method, /'cold-open'/u);
	assert.match(method, /'viewInitialization'/u);
	assert.match(method, /'viewReveal'/u);
});
