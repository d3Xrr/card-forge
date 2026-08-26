import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DEFAULT_PRINT_EXPORT_SETTINGS,
	normalizePrintExportSettings,
} from '../src/models/print-export-settings';

void test('legacy and malformed print settings resolve to bounded safe defaults', () => {
	assert.deepEqual(normalizePrintExportSettings(undefined), DEFAULT_PRINT_EXPORT_SETTINGS);
	assert.deepEqual(normalizePrintExportSettings({
		printMode: 'freeform',
		backMode: true,
		duplexOrientation: 'upside-down',
		backOffsetXmm: Number.POSITIVE_INFINITY,
		backOffsetYmm: '4',
	}), DEFAULT_PRINT_EXPORT_SETTINGS);
});

void test('duplex settings persist valid modes and clamp calibration to ten millimetres', () => {
	assert.deepEqual(normalizePrintExportSettings({
		printMode: 'manual-duplex',
		backMode: 'use-card-backs',
		duplexOrientation: 'short-edge',
		backOffsetXmm: 12.345,
		backOffsetYmm: -20,
	}), {
		printMode: 'manual-duplex',
		backMode: 'use-card-backs',
		duplexOrientation: 'short-edge',
		backOffsetXmm: 10,
		backOffsetYmm: -10,
	});
});
