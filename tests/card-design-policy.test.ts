import assert from 'node:assert/strict';
import test from 'node:test';

import {
	chooseAutoDensityCandidate,
	createCardDesignPlanningPolicy,
	DENSITY_PLANNING_POLICIES,
	getMonotonicDensityBodyFontCandidates,
	PRINT_SAFE_MINIMUM_BODY_FONT_POINTS,
	selectPreferredDensityBodyFontPoints,
	shouldPreserveFittedArtwork,
	type AutoDensityCandidate,
} from '../src/renderer/card-design-policy';
import {
	chooseArtworkPriorityFit,
	findBestAdaptiveBodyFit,
} from '../src/renderer/item-card-fit-service';
import { createCardDesignProfile } from '../src/models/card-design';

const baseDesign = {
	...createCardDesignProfile(),
	theme: 'dark' as const,
	artworkSize: 'standard' as const,
	density: 'standard' as const,
};

void test('defines bounded Standard and meaningfully distinct Compact typography', () => {
	assert.deepEqual(DENSITY_PLANNING_POLICIES.standard.bodyFontPoints, [
		10, 9.5, 9, 8.5, 8, 7.5, 7,
	]);
	assert.deepEqual(DENSITY_PLANNING_POLICIES.compact.bodyFontPoints, [
		9, 8.5, 8, 7.5, 7,
	]);
	assert.equal(DENSITY_PLANNING_POLICIES.standard.bodyLineHeight, 1.3);
	assert.equal(DENSITY_PLANNING_POLICIES.compact.bodyLineHeight, 1.18);
	assert.equal(DENSITY_PLANNING_POLICIES.standard.capacityMultiplier, 1);
	assert.equal(DENSITY_PLANNING_POLICIES.compact.capacityMultiplier, 1.24);
	assert.equal(PRINT_SAFE_MINIMUM_BODY_FONT_POINTS, 7);
	assert.equal(selectPreferredDensityBodyFontPoints(10, 'standard'), 10);
	assert.equal(selectPreferredDensityBodyFontPoints(10, 'compact'), 9);
	assert.equal(selectPreferredDensityBodyFontPoints(6, 'compact'), 7);
});

void test('Auto is deterministic and chooses Compact only when it safely reduces pages', () => {
	type TestCandidate = AutoDensityCandidate & { value: string };
	const standard: TestCandidate = {
		resolvedDensity: 'standard' as const,
		pageCount: 2,
		exportable: true,
		value: 'standard',
	};
	const compact: TestCandidate = {
		resolvedDensity: 'compact' as const,
		pageCount: 1,
		exportable: true,
		value: 'compact',
	};
	assert.equal(chooseAutoDensityCandidate(standard, compact).value, 'compact');
	assert.equal(
		chooseAutoDensityCandidate(standard, { ...compact, pageCount: 2 }).value,
		'standard',
	);
	assert.equal(
		chooseAutoDensityCandidate(
			{ ...standard, exportable: false },
			{ ...compact, pageCount: 2 },
		).value,
		'compact',
	);
});

void test('explicit densities stay explicit and Larger has a preserve-artwork policy', () => {
	assert.deepEqual(
		createCardDesignPlanningPolicy(baseDesign).densityCandidates,
		['standard'],
	);
	assert.deepEqual(
		createCardDesignPlanningPolicy({ ...baseDesign, density: 'compact' }).densityCandidates,
		['compact'],
	);
	assert.deepEqual(
		createCardDesignPlanningPolicy({ ...baseDesign, density: 'auto' }).densityCandidates,
		['standard', 'compact'],
	);
	assert.equal(shouldPreserveFittedArtwork(baseDesign), false);
	assert.equal(
		shouldPreserveFittedArtwork({ ...baseDesign, artworkSize: 'larger' }),
		true,
	);
	const artworkPlan = { bodyFontPoints: 9, pageCount: 3, value: 'artwork' };
	const noArtworkPlan = { bodyFontPoints: 10, pageCount: 1, value: 'plain' };
	assert.equal(
		chooseArtworkPriorityFit(artworkPlan, noArtworkPlan, Number.POSITIVE_INFINITY)
			?.value,
		'artwork',
	);
});

void test('Apparatus-style fitting caps Compact at the resolved Standard typography', async () => {
	const measureApparatus = (points: number) => Promise.resolve({
		pageCount: points <= 8 ? 1 : 2,
		value: points,
	});
	const standard = await findBestAdaptiveBodyFit(
		DENSITY_PLANNING_POLICIES.standard.bodyFontPoints,
		measureApparatus,
		1,
	);
	const independentCompact = await findBestAdaptiveBodyFit(
		DENSITY_PLANNING_POLICIES.compact.bodyFontPoints,
		() => Promise.resolve({ pageCount: 1, value: 'independent' }),
		1,
	);
	assert.equal(standard?.bodyFontPoints, 8);
	assert.equal(independentCompact?.bodyFontPoints, 9);
	const boundedCandidates = getMonotonicDensityBodyFontCandidates(
		'compact',
		standard?.bodyFontPoints,
	);
	const boundedCompact = await findBestAdaptiveBodyFit(
		boundedCandidates,
		() => Promise.resolve({ pageCount: 1, value: 'bounded' }),
		1,
	);
	assert.deepEqual(boundedCandidates, [8, 7.5, 7]);
	assert.equal(boundedCompact?.bodyFontPoints, 8);
	assert.ok((boundedCompact?.bodyFontPoints ?? 0) <= (standard?.bodyFontPoints ?? 0));
});
