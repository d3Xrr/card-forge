import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/main.ts', 'utf8');
const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
const exportGallery = readFileSync('src/services/export-gallery.ts', 'utf8');
const currentItemWorkflow = readFileSync('src/services/current-item-workflow.ts', 'utf8');

function methodBody(source: string, startMarker: string, endMarker: string): string {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.notEqual(start, -1, `Missing method marker: ${startMarker}`);
	assert.notEqual(end, -1, `Missing method end marker: ${endMarker}`);
	return source.slice(start, end);
}

void test('registers both current-item commands and persists Saved Print Sets', () => {
	assert.match(main, /id: 'open-current-item-in-card-forge'[\s\S]*name: 'Open current item in Card Forge'/u);
	assert.match(main, /id: 'add-current-item-to-print-queue'[\s\S]*name: 'Add current item to print queue'/u);
	assert.match(main, /savedPrintSets: this\.savedPrintSets\.serialize\(\)/u);
	assert.match(main, /new SavedPrintSetService\(saved\.savedPrintSets\)/u);
});

void test('Open current item reuses activation and selects Preview without queue or filter mutation', () => {
	const command = methodBody(
		main,
		'private async openCurrentItemInCardForge',
		'private async addCurrentItemToPrintQueue',
	);
	const selection = methodBody(
		view,
		'selectItemForPreview(filePath: string)',
		'private showRelativePage',
	);
	assert.match(command, /resolveActiveIndexedItem\(\)/u);
	assert.match(command, /activateView\(\)/u);
	assert.match(command, /selectItemForPreview\(item\.filePath\)/u);
	assert.doesNotMatch(command, /printQueue|\.add\(/u);
	assert.match(selection, /this\.previewMode = 'preview'/u);
	assert.match(selection, /this\.resetEditorSession\(\)/u);
	assert.doesNotMatch(selection, /searchInput\.value|resetBrowserFilters|printQueue/u);
});

void test('Add current item resolves through the canonical index and cannot accept an editor draft', () => {
	const command = methodBody(
		main,
		'private async addCurrentItemToPrintQueue',
		'private async resolveActiveIndexedItem',
	);
	assert.match(command, /resolveActiveIndexedItem\(\)/u);
	assert.match(command, /addCurrentIndexedItemToQueue\(this\.printQueue, item\)/u);
	assert.match(command, /Added \$\{item\.name\} to Card Forge print queue/u);
	assert.doesNotMatch(command, /draftOverrides|activateView/u);
	assert.match(currentItemWorkflow, /return queue\.add\(item\.filePath\);/u);
	assert.doesNotMatch(currentItemWorkflow, /draftOverrides|overrides\s*\?/u);
});

void test('Workflow modes are right-panel-only and switching performs no planning or index work', () => {
	const switching = methodBody(
		view,
		'private setWorkflowMode',
		'private updateWorkflowModePresentation',
	);
	assert.match(view, /'Print queue', 'queue'/u);
	assert.match(view, /'Saved sets', 'saved-sets'/u);
	assert.match(view, /'Exports', 'exports'/u);
	assert.match(view, /text: 'Save print set'/u);
	assert.match(view, /appendQueueButton\(controls, 'Duplicate'/u);
	assert.doesNotMatch(
		switching,
		/renderQueue|renderPreview|renderEditor|rebuildItemIndex|renderSheetPreview|plan|raster|exportPdf/u,
	);
	assert.doesNotMatch(switching, /printQueue\.(?:add|clear|remove|replace|update|increment|decrement|move)/u);
});

void test('Saved Sets browsing is data-only and Export Gallery is metadata-only', () => {
	const savedBrowsing = methodBody(
		view,
		'private renderSavedPrintSets',
		'private renderSavedPrintSetRow',
	);
	const exportsRendering = methodBody(
		view,
		'private async renderExportGallery',
		'private renderExportGalleryRow',
	);
	assert.doesNotMatch(savedBrowsing, /printQueue\.(?:add|clear|remove|replace|update|increment|decrement|move)/u);
	assert.match(exportsRendering, /folder\.children/u);
	assert.doesNotMatch(exportsRendering, /createFolder|createBinary|readBinary|cardRenderer|raster|thumbnail/iu);
	assert.doesNotMatch(`${view}\n${exportGallery}`, /setInterval|pdfjs|thumbnail|first-page|rasterize/iu);
});

void test('Export Gallery follows setting and vault events without polling', () => {
	assert.match(main, /updatePdfExportFolder[\s\S]*onPdfExportFolderChanged\(\)/u);
	assert.match(view, /vault\.on\('create'/u);
	assert.match(view, /vault\.on\('delete'/u);
	assert.match(view, /vault\.on\('rename'/u);
	assert.match(view, /promptForDeletion\(selected\)/u);
	assert.match(view, /fileManager\.trashFile\(file\)/u);
	assert.doesNotMatch(view, /setInterval/u);
});
