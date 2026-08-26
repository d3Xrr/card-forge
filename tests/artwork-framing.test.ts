import assert from 'node:assert/strict';
import test from 'node:test';

import { createArtworkFramingStyle } from '../src/renderer/artwork-framing';
import { normalizeArtworkFraming } from '../src/models/card-design';

void test('artwork framing projects Fit and Fill into a fixed clipping box', () => {
	assert.deepEqual(createArtworkFramingStyle({
		fitMode: 'fit', zoom: 1, panX: 0, panY: 0,
	}), {
		objectFit: 'contain',
		objectPosition: 'center',
		transform: 'translate(0%, 0%) scale(1)',
		transformOrigin: 'center',
	});
	assert.equal(createArtworkFramingStyle({
		fitMode: 'fill', zoom: 1.5, panX: 40, panY: -20,
	}).objectFit, 'cover');
	assert.equal(createArtworkFramingStyle({
		fitMode: 'fill', zoom: 1.5, panX: 40, panY: -20,
	}).transform, 'translate(10%, -5%) scale(1.5)');
});

void test('framing normalization bounds zoom and pan deterministically', () => {
	assert.deepEqual(normalizeArtworkFraming({
		fitMode: 'stretch', zoom: 12, panX: -140, panY: 123.456,
	}), {
		fitMode: 'fit', zoom: 3, panX: -100, panY: 100,
	});
});
