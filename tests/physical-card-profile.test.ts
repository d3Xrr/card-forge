import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PHYSICAL_CARD_ASPECT_RATIO,
	PHYSICAL_CARD_PROFILE,
} from '../src/models/physical-card-profile';

void test('binds physical planning to the canonical poker-card export profile', () => {
	assert.deepEqual(PHYSICAL_CARD_PROFILE, {
		widthMm: 63.5,
		heightMm: 88.9,
		widthPx: 750,
		heightPx: 1050,
		dpi: 300,
	});
	assert.equal(PHYSICAL_CARD_PROFILE.widthPx / PHYSICAL_CARD_PROFILE.heightPx, PHYSICAL_CARD_ASPECT_RATIO);
	assert.equal(PHYSICAL_CARD_PROFILE.widthPx / PHYSICAL_CARD_PROFILE.dpi, 2.5);
	assert.equal(PHYSICAL_CARD_PROFILE.heightPx / PHYSICAL_CARD_PROFILE.dpi, 3.5);
});
