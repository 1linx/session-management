import { describe, expect, it } from 'vitest';
import {
	ALL_SLOTS,
	PERIODS,
	SESSION_STATUSES,
	STATUS_LABELS,
	WEEKDAYS,
	isSessionStatus,
	slotKey
} from '$lib/constants';

describe('isSessionStatus', () => {
	it('accepts every defined status', () => {
		for (const status of SESSION_STATUSES) {
			expect(isSessionStatus(status.value)).toBe(true);
		}
	});

	it('rejects unknown values', () => {
		expect(isSessionStatus('duty')).toBe(false);
		expect(isSessionStatus('')).toBe(false);
		expect(isSessionStatus('WORKING')).toBe(false);
	});
});

describe('STATUS_LABELS', () => {
	it('maps every status value to its label', () => {
		expect(STATUS_LABELS['working']).toBe('Working');
		expect(STATUS_LABELS['not_working']).toBe('Not working');
		expect(STATUS_LABELS['working_ratho']).toBe('Working (Ratho)');
	});
});

describe('slotKey / ALL_SLOTS', () => {
	it('formats a slot as "<weekday>:<period>"', () => {
		expect(slotKey(1, 'AM')).toBe('1:AM');
		expect(slotKey(5, 'PM')).toBe('5:PM');
	});

	it('covers every weekday × period exactly once', () => {
		expect(ALL_SLOTS).toHaveLength(WEEKDAYS.length * PERIODS.length);
		expect(new Set(ALL_SLOTS).size).toBe(ALL_SLOTS.length);
		expect(ALL_SLOTS).toContain('1:AM');
		expect(ALL_SLOTS).toContain('5:PM');
	});
});
