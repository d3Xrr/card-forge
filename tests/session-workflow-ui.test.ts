import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/main.ts', 'utf8');
const view = readFileSync('src/views/card-forge-view.ts', 'utf8');
const exportGallery = readFileSync('src/services/export-gallery.ts', 'utf8');
const currentItemWorkflow = readFileSync('src/services/current-item-workflow.ts', 'utf8');
const css = readFileSync('styles.css', 'utf8');

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
	assert.match(main, /activeSavedSetId: this\.savedPrintSetSession\.activeSavedSetId \?\? null/u);
	assert.match(main, /savedPrintSetSession\.restore\([\s\S]*saved\.activeSavedSetId/u);
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
	assert.match(command, /addCurrentIndexedItemToQueue\([\s\S]*this\.printQueue,[\s\S]*item,[\s\S]*createCardDesignProfile\(getCardDesignDefaults\(this\.settings\)\)/u);
	assert.match(command, /Added \$\{item\.name\} to Card Forge print queue/u);
	assert.doesNotMatch(command, /draftOverrides|activateView/u);
	assert.match(currentItemWorkflow, /return queue\.add\(item\.filePath, undefined, design\);/u);
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
	assert.match(view, /text: 'Save'/u);
	assert.match(view, /text: 'Save as…'/u);
	assert.match(view, /appendQueueIconButton\(entryActions, 'copy', 'Duplicate card'/u);
	assert.doesNotMatch(
		switching,
		/renderQueue|renderPreview|renderEditor|rebuildItemIndex|renderSheetPreview|plan|raster|exportPdf/u,
	);
	assert.doesNotMatch(switching, /printQueue\.(?:add|clear|remove|replace|update|increment|decrement|move)/u);
});

void test('Workflow bodies are truly mutually exclusive and queue-only controls stay together', () => {
	assert.match(
		css,
		/\.ttrpg-card-forge__workflow-queue\[hidden\],[\s\S]*\.ttrpg-card-forge__workflow-aux\[hidden\][\s\S]*display: none/u,
	);
	const build = methodBody(view, 'private buildWorkflow', 'private createWorkflowModeButton');
	assert.match(build, /workflowQueueElement[\s\S]*activeSavedSetStatusElement/u);
	assert.match(build, /workflowQueueElement[\s\S]*queueListElement/u);
	assert.match(build, /workflowQueueElement[\s\S]*sheet-preview/u);
	assert.match(build, /workflowQueueElement[\s\S]*export-actions/u);
	assert.match(build, /workflowAuxElement/u);
	assert.match(view, /workflowQueueElement\.hidden = this\.workflowMode !== 'queue'/u);
	assert.match(view, /workflowAuxElement\.hidden = this\.workflowMode === 'queue'/u);
});

void test('successful Saved Set load activates it and returns directly to Print Queue', () => {
	const load = methodBody(
		view,
		'private async loadSavedPrintSet',
		'private async renameSavedPrintSet',
	);
	assert.match(load, /result\.status !== 'loaded'/u);
	assert.match(load, /savedPrintSetSession\.activate\(result\.set\.id, result\.set\.entries\)/u);
	assert.match(load, /setWorkflowMode\('queue'\)/u);
	const failedLoad = load.slice(0, load.indexOf("if (result.status !== 'loaded')"));
	assert.doesNotMatch(failedLoad, /setWorkflowMode\('queue'\)/u);
});

void test('active-set actions expose Save, Save As, status, Clear, and persisted validated state', () => {
	assert.match(main, /readonly savedPrintSetSession = new SavedPrintSetSession\(\)/u);
	assert.match(main, /activeSavedSetId: saved\?\.activeSavedSetId/u);
	assert.match(main, /activeSavedSetRestore === 'invalid'/u);
	assert.match(main, /unsubscribeFromSavedPrintSetSession/u);
	assert.match(view, /'Unsaved print queue'/u);
	assert.match(view, /\$\{state\.activeSet\.name\}\$\{state\.dirty \? ' · Modified' : ''\}/u);
	assert.match(view, /private async saveActivePrintSet/u);
	assert.match(view, /savedPrintSets\.update\(state\.activeSet\.id, prepared\.entries\)/u);
	assert.match(view, /private async saveCurrentQueueAsNewSet/u);
	assert.match(view, /savedPrintSetSession\.activate\(result\.set\.id, result\.set\.entries\)/u);
	assert.match(view, /savedPrintSetSession\.clear\(\)[\s\S]*printQueue\.clear\(\)/u);
	assert.match(view, /printQueue\.getEntries\(\)\.length === 0[\s\S]*!this\.savedPrintSetSession\.activeSavedSetId/u);
	assert.match(view, /active-set-badge[\s\S]*text: 'Active'/u);
});

void test('Saved Set artwork is prepared before logical mutation and promoted in the live queue', () => {
	const save = methodBody(view, 'private async saveActivePrintSet', 'private async saveCurrentQueueAsNewSet');
	const saveAs = methodBody(view, 'private async saveCurrentQueueAsNewSet', 'private snapshotCurrentQueue');
	assert.ok(save.indexOf('prepareCurrentQueueForSavedSet') < save.indexOf('savedPrintSets.update'));
	assert.ok(saveAs.indexOf('prepareCurrentQueueForSavedSet') < saveAs.indexOf('savedPrintSets.save'));
	assert.match(save, /printQueue\.promoteTemporaryArtworkReferences\(prepared\.temporaryArtworkPaths\)/u);
	assert.match(saveAs, /printQueue\.promoteTemporaryArtworkReferences\(prepared\.temporaryArtworkPaths\)/u);
	assert.doesNotMatch(`${save}\n${saveAs}`, /printQueue\.updateOverrides|replaceWithSnapshots/u);
	assert.match(view, /Replace missing artwork before saving this print set\./u);
	assert.match(view, /cardForgeAssetsFolder/u);
});

void test('Saved Set load confirmation is conditional on canonical replacement risk', () => {
	const load = methodBody(
		view,
		'private async loadSavedPrintSet',
		'private async renameSavedPrintSet',
	);
	assert.match(load, /getSavedPrintSetLoadRisk/u);
	assert.match(load, /replacementRisk === 'none'/u);
	assert.match(load, /replacementRisk === 'modified-active-set'/u);
	assert.match(load, /has unsaved changes\. Loading/u);
	assert.match(load, /replace the unsaved current print queue/u);
	assert.match(load, /if \(!replace\) \{\s*return;/u);
	const cancelIndex = load.indexOf('if (!replace)');
	const activationIndex = load.indexOf('savedPrintSetSession.activate');
	assert.ok(cancelIndex >= 0 && cancelIndex < activationIndex);
});

void test('queue Duplicate, Edit, and Remove are compact accessible Lucide icon buttons', () => {
	const helper = methodBody(view, 'function appendQueueIconButton', 'function formatArtworkDiagnostic');
	assert.match(view, /appendQueueIconButton\(entryActions, 'copy', 'Duplicate card'/u);
	assert.match(view, /appendQueueIconButton\(entryActions, 'copy', 'Duplicate card'[\s\S]*printQueue\.duplicate/u);
	assert.match(view, /appendQueueIconButton\(entryActions, 'pencil', 'Edit card'[\s\S]*editQueueEntry/u);
	assert.match(view, /'trash-2',[\s\S]*'Remove card'[\s\S]*printQueue\.remove/u);
	assert.match(helper, /type: 'button'/u);
	assert.match(helper, /'aria-label': label/u);
	assert.match(helper, /title: label/u);
	assert.match(helper, /setIcon\(button, icon\)/u);
	assert.doesNotMatch(helper, /text:/u);
	assert.match(css, /\.ttrpg-card-forge__queue-entry-actions/u);
	assert.match(css, /\.ttrpg-card-forge__queue-controls \.ttrpg-card-forge__queue-icon-action/u);
	assert.doesNotMatch(css, /^(?:button|\.mod-root button)\s*\{/mu);
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
