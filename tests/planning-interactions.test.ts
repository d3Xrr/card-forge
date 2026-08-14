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
	const lookupPlan = (filePath: string): Promise<TestPlan> => {
		plannerCalls += 1;
		return Promise.resolve({ filePath });
	};
	const initialEntries = [
		{ filePath: 'items/scimitar.md', quantity: 1 },
		{ filePath: 'items/rod.md', quantity: 1 },
	];
	const coldPlans = await resolveQueuePlanMap(
		initialEntries,
		new Map<string, TestPlan>(),
		lookupPlan,
	);
	assert.equal(plannerCalls, 2);

	const reorderedWithNewQuantities = [
		{ filePath: 'items/rod.md', quantity: 4 },
		{ filePath: 'items/scimitar.md', quantity: 2 },
		{ filePath: 'items/rod.md', quantity: 4 },
	];
	const warmPlans = await resolveQueuePlanMap(
		reorderedWithNewQuantities,
		coldPlans,
		lookupPlan,
	);

	assert.equal(plannerCalls, 2, 'warm queue changes made zero additional planner calls');
	assert.deepEqual([...warmPlans.keys()], ['items/rod.md', 'items/scimitar.md']);
	assert.strictEqual(warmPlans.get('items/rod.md'), coldPlans.get('items/rod.md'));
	assert.strictEqual(warmPlans.get('items/scimitar.md'), coldPlans.get('items/scimitar.md'));
});

void test('cold queue plans resolve sequentially to bound hidden measurement work', async () => {
	let active = 0;
	let maximumActive = 0;
	const order: string[] = [];
	await resolveQueuePlanMap(
		[{ filePath: 'A' }, { filePath: 'B' }, { filePath: 'C' }],
		new Map(),
		async (filePath) => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			order.push(`start-${filePath}`);
			await Promise.resolve();
			order.push(`finish-${filePath}`);
			active -= 1;
			return filePath;
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
		[{ filePath: 'A' }, { filePath: 'B' }, { filePath: 'C' }],
		new Map(),
		(filePath) => {
			calls.push(filePath);
			return filePath === 'A' ? first.promise : Promise.resolve(filePath);
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
		{ filePath: 'items/axe.md', cacheKey: 'axe-source-art-v1' },
		{ filePath: 'items/rod.md', cacheKey: 'rod-source-v1' },
	];
	const current = new Map([
		['items/axe.md', 'axe-source-art-v1'],
		['items/rod.md', 'rod-source-v1'],
	]);
	assert.equal(
		areQueuePlanInputsCurrent(plans, (filePath) => current.get(filePath)),
		true,
	);
	current.set('items/axe.md', 'axe-source-art-v2');
	assert.equal(
		areQueuePlanInputsCurrent(plans, (filePath) => current.get(filePath)),
		false,
	);
	assert.equal(
		areQueuePlanInputsCurrent(
			[{ filePath: 'items/missing-key.md' }],
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
