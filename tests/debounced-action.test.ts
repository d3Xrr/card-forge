import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DebouncedAction,
	type DebounceScheduler,
} from '../src/services/debounced-action';

void test('rapid edits schedule only the latest canonical preview request', () => {
	const pending = new Map<number, () => void>();
	let nextHandle = 1;
	const scheduler: DebounceScheduler = {
		set: (callback) => {
			const handle = nextHandle++;
			pending.set(handle, callback);
			return handle;
		},
		clear: (handle) => pending.delete(handle as number),
	};
	const debounce = new DebouncedAction(350, scheduler);
	const planned: string[] = [];
	debounce.schedule(() => planned.push('A'));
	debounce.schedule(() => planned.push('B'));
	debounce.schedule(() => planned.push('C'));
	assert.equal(pending.size, 1);
	for (const callback of pending.values()) {
		callback();
	}
	assert.deepEqual(planned, ['C']);
});

void test('cancel prevents a queued editor plan from starting', () => {
	const callbacks: Array<() => void> = [];
	const scheduler: DebounceScheduler = {
		set: (callback) => { callbacks.push(callback); return callbacks.length - 1; },
		clear: (handle) => { callbacks[handle as number] = () => undefined; },
	};
	let calls = 0;
	const debounce = new DebouncedAction(350, scheduler);
	debounce.schedule(() => { calls += 1; });
	debounce.cancel();
	callbacks[0]?.();
	assert.equal(calls, 0);
});
