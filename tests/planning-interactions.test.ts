import assert from 'node:assert/strict';
import test from 'node:test';

import {
	areQueuePlanInputsCurrent,
	isIndexedPlanningInputCurrent,
	LatestRequestGate,
	reconcileVisibleSelection,
	resolveQueuePlanMap,
	selectRelativePageIndex,
	shouldRequestSelectedPlan,
} from '../src/services/planning-interactions';

void test('unchanged browser selection and effective key do not request replanning', () => {
	let plannerCalls = 0;
	const previousPlanKey = 'items/scimitar.md\u0000effective-input-1';
	const searchUpdate = reconcileVisibleSelection(
		'items/scimitar.md',
		['items/rod.md', 'items/scimitar.md'],
	);

	if (shouldRequestSelectedPlan(
		previousPlanKey,
		searchUpdate.selectionChanged ? 'items/rod.md\u0000effective-input-1' : previousPlanKey,
	)) {
		plannerCalls += 1;
	}

	assert.deepEqual(searchUpdate, {
		selectedFilePath: 'items/scimitar.md',
		selectionChanged: false,
	});
	assert.equal(plannerCalls, 0);
	assert.equal(shouldRequestSelectedPlan(previousPlanKey, previousPlanKey), false);
	assert.equal(
		shouldRequestSelectedPlan(previousPlanKey, 'items/scimitar.md\u0000effective-input-2'),
		true,
	);
});

void test('page navigation only selects a bounded existing page', () => {
	let plannerCalls = 0;
	const initialPlan = (): number => {
		plannerCalls += 1;
		return 7;
	};
	const pageCount = initialPlan();

	let pageIndex = 0;
	pageIndex = selectRelativePageIndex(pageIndex, 1, pageCount);
	pageIndex = selectRelativePageIndex(pageIndex, 1, pageCount);
	pageIndex = selectRelativePageIndex(pageIndex, 20, pageCount);
	assert.equal(pageIndex, 6);
	pageIndex = selectRelativePageIndex(pageIndex, -20, pageCount);
	assert.equal(pageIndex, 0);
	assert.equal(selectRelativePageIndex(3, 1, 0), 0);
	assert.equal(plannerCalls, 1, 'navigation made zero additional planner calls');
});

void test('latest request gate allows only Item C to commit after A/B/C selection', async () => {
	const gate = new LatestRequestGate<string>();
	const itemA = deferred<string>();
	const itemB = deferred<string>();
	const itemC = deferred<string>();
	const committed: string[] = [];

	const run = async (key: string, result: Promise<string>): Promise<boolean> => {
		const token = gate.begin(key);
		const value = await result;
		return gate.commitIfCurrent(token, () => committed.push(value));
	};
	const pendingA = run('A', itemA.promise);
	const pendingB = run('B', itemB.promise);
	const pendingC = run('C', itemC.promise);

	itemC.resolve('Item C');
	assert.equal(await pendingC, true);
	assert.deepEqual(committed, ['Item C']);

	itemB.resolve('Item B');
	itemA.resolve('Item A');

	assert.deepEqual(await Promise.all([pendingA, pendingB]), [false, false]);
	assert.deepEqual(committed, ['Item C']);
});

void test('queue quantity and ordering changes reuse warm plans without planner calls', async () => {
	interface TestPlan {
		filePath: string;
	}
	let plannerCalls = 0;
	const lookupPlan = (entry: { filePath: string }): Promise<TestPlan> => {
		plannerCalls += 1;
		return Promise.resolve({ filePath: entry.filePath });
	};
	const initialEntries = [
		{ id: 'scimitar', filePath: 'items/scimitar.md', quantity: 1 },
		{ id: 'rod', filePath: 'items/rod.md', quantity: 1 },
	];
	const coldPlans = await resolveQueuePlanMap(
		initialEntries,
		new Map<string, TestPlan>(),
		lookupPlan,
	);
	assert.equal(plannerCalls, 2);

	const reorderedWithNewQuantities = [
		{ id: 'rod', filePath: 'items/rod.md', quantity: 4 },
		{ id: 'scimitar', filePath: 'items/scimitar.md', quantity: 2 },
		{ id: 'rod', filePath: 'items/rod.md', quantity: 4 },
	];
	const warmPlans = await resolveQueuePlanMap(
		reorderedWithNewQuantities,
		coldPlans,
		lookupPlan,
	);

	assert.equal(plannerCalls, 2, 'warm queue changes made zero additional planner calls');
	assert.deepEqual([...warmPlans.keys()], ['rod', 'scimitar']);
	assert.strictEqual(warmPlans.get('rod'), coldPlans.get('rod'));
	assert.strictEqual(warmPlans.get('scimitar'), coldPlans.get('scimitar'));
});

void test('same-source queue entries resolve separate effective plans by entry id', async () => {
	let calls = 0;
	const plans = await resolveQueuePlanMap(
		[
			{ id: 'quarterstaff-a', filePath: 'items/plus-one-weapon.md' },
			{ id: 'quarterstaff-b', filePath: 'items/plus-one-weapon.md' },
		],
		new Map(),
		async (entry) => {
			calls += 1;
			return `${entry.id}-plan`;
		},
	);
	assert.equal(calls, 2);
	assert.deepEqual([...plans], [
		['quarterstaff-a', 'quarterstaff-a-plan'],
		['quarterstaff-b', 'quarterstaff-b-plan'],
	]);
});

void test('cold queue plans resolve sequentially to bound hidden measurement work', async () => {
	let active = 0;
	let maximumActive = 0;
	const order: string[] = [];
	await resolveQueuePlanMap(
		[{ id: 'A', filePath: 'A' }, { id: 'B', filePath: 'B' }, { id: 'C', filePath: 'C' }],
		new Map(),
		async (entry) => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			order.push(`start-${entry.filePath}`);
			await Promise.resolve();
			order.push(`finish-${entry.filePath}`);
			active -= 1;
			return entry.filePath;
		},
	);

	assert.equal(maximumActive, 1);
	assert.deepEqual(order, [
		'start-A', 'finish-A',
		'start-B', 'finish-B',
		'start-C', 'finish-C',
	]);
});

void test('stale queue resolution does not start new cold work', async () => {
	const first = deferred<string>();
	const calls: string[] = [];
	let current = true;
	const pending = resolveQueuePlanMap(
		[{ id: 'A', filePath: 'A' }, { id: 'B', filePath: 'B' }, { id: 'C', filePath: 'C' }],
		new Map(),
		(entry) => {
			calls.push(entry.filePath);
			return entry.filePath === 'A'
				? first.promise
				: Promise.resolve(entry.filePath);
		},
		() => current,
	);
	assert.deepEqual(calls, ['A']);
	current = false;
	first.resolve('A');
	const resolved = await pending;

	assert.deepEqual(calls, ['A']);
	assert.deepEqual([...resolved], [['A', 'A']]);
});

void test('queue export freshness compares the effective source and artwork key', () => {
	const plans = [
		{ entryId: 'axe', cacheKey: 'axe-source-art-v1' },
		{ entryId: 'rod', cacheKey: 'rod-source-v1' },
	];
	const current = new Map([
		['axe', 'axe-source-art-v1'],
		['rod', 'rod-source-v1'],
	]);
	assert.equal(
		areQueuePlanInputsCurrent(plans, (entryId) => current.get(entryId)),
		true,
	);
	current.set('axe', 'axe-source-art-v2');
	assert.equal(
		areQueuePlanInputsCurrent(plans, (entryId) => current.get(entryId)),
		false,
	);
	assert.equal(
		areQueuePlanInputsCurrent(
			[{ entryId: 'missing-key' }],
			() => undefined,
		),
		false,
	);
});

void test('planning waits while indexed source or artwork existence is stale', () => {
	const indexed = { modifiedTime: 100, size: 200 };
	assert.equal(
		isIndexedPlanningInputCurrent(indexed, { ...indexed }, true, true),
		true,
	);
	assert.equal(
		isIndexedPlanningInputCurrent(indexed, { modifiedTime: 101, size: 200 }, true, true),
		false,
	);
	assert.equal(
		isIndexedPlanningInputCurrent(indexed, { ...indexed }, false, true),
		false,
	);
	assert.equal(
		isIndexedPlanningInputCurrent(undefined, { ...indexed }, false, false),
		false,
	);
});

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: (value) => resolvePromise?.(value),
	};
}
