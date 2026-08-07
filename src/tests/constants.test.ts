import { describe, expect, it } from 'vitest';
import {
	ALL_SLOTS,
	CELL_OPTIONS,
	NOT_WORKING,
	PERIODS,
	WEEKDAYS,
	cellLabel,
	decodeCell,
	encodeCell,
	slotKey
} from '$lib/constants';

describe('cell encode/decode', () => {
	it('round-trips every pickable option', () => {
		for (const option of CELL_OPTIONS) {
			expect(encodeCell(option.value)).toBe(option.key);
			expect(decodeCell(option.key)).toEqual(option.value);
		}
	});

	it('decodes the known keys', () => {
		expect(decodeCell('not_working')).toEqual(NOT_WORKING);
		expect(decodeCell('working:east_calder')).toEqual({
			status: 'working',
			location: 'east_calder',
			duty: false
		});
		expect(decodeCell('working:ratho:duty')).toEqual({
			status: 'working',
			location: 'ratho',
			duty: true
		});
	});

	it('rejects invalid keys', () => {
		expect(decodeCell('')).toBeNull();
		expect(decodeCell('working')).toBeNull(); // working requires a location
		expect(decodeCell('working:mars')).toBeNull(); // unknown location
		expect(decodeCell('working:ratho:overtime')).toBeNull(); // unknown flag
		expect(decodeCell('working:ratho:duty:duty')).toBeNull();
		expect(decodeCell('not_working:duty')).toBeNull(); // duty needs working
		expect(decodeCell('on_holiday')).toBeNull();
	});
});

describe('cellLabel', () => {
	it('keeps the default location implicit, matching the spreadsheet wording', () => {
		expect(cellLabel({ status: 'working', location: 'east_calder', duty: false })).toBe('Working');
		expect(cellLabel({ status: 'working', location: 'east_calder', duty: true })).toBe(
			'Working (Duty)'
		);
		expect(cellLabel({ status: 'working', location: 'ratho', duty: false })).toBe(
			'Working (Ratho)'
		);
		expect(cellLabel({ status: 'working', location: 'ratho', duty: true })).toBe(
			'Working (Ratho, Duty)'
		);
		expect(cellLabel(NOT_WORKING)).toBe('Not working');
	});
});

describe('CELL_OPTIONS', () => {
	it('has unique keys and includes not_working', () => {
		expect(new Set(CELL_OPTIONS.map((o) => o.key)).size).toBe(CELL_OPTIONS.length);
		expect(CELL_OPTIONS.map((o) => o.key)).toContain('not_working');
	});

	it('offers a plain and a duty option per location', () => {
		expect(CELL_OPTIONS.map((o) => o.key)).toEqual([
			'working:east_calder',
			'working:east_calder:duty',
			'working:ratho',
			'working:ratho:duty',
			'not_working'
		]);
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
