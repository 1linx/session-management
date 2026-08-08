import { describe, expect, it } from 'vitest';
import {
	ALL_SLOTS,
	CELL_OPTIONS,
	NOT_WORKING,
	OFF_SICK,
	PERIODS,
	WEEKDAYS,
	cellLabel,
	decodeCell,
	encodeCell,
	isClinician,
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
		expect(decodeCell('sick')).toEqual(OFF_SICK);
		expect(decodeCell('working:east_calder')).toEqual({
			status: 'working',
			location: 'east_calder',
			role: null
		});
		expect(decodeCell('working:ratho:duty')).toEqual({
			status: 'working',
			location: 'ratho',
			role: 'duty'
		});
		expect(decodeCell('working:east_calder:duty_team')).toEqual({
			status: 'working',
			location: 'east_calder',
			role: 'duty_team'
		});
		expect(decodeCell('working:east_calder:house_visits')).toEqual({
			status: 'working',
			location: 'east_calder',
			role: 'house_visits'
		});
	});

	it('rejects invalid keys', () => {
		expect(decodeCell('')).toBeNull();
		expect(decodeCell('working')).toBeNull(); // working requires a location
		expect(decodeCell('working:mars')).toBeNull(); // unknown location
		expect(decodeCell('working:ratho:overtime')).toBeNull(); // unknown role
		expect(decodeCell('working:ratho:duty:duty')).toBeNull();
		expect(decodeCell('not_working:duty')).toBeNull();
		expect(decodeCell('sick:duty')).toBeNull();
		expect(decodeCell('on_holiday')).toBeNull();
	});
});

describe('cellLabel', () => {
	it('keeps the default location implicit, matching the spreadsheet wording', () => {
		expect(cellLabel(decodeCell('working:east_calder')!)).toBe('Working');
		expect(cellLabel(decodeCell('working:east_calder:duty')!)).toBe('Working (Duty)');
		expect(cellLabel(decodeCell('working:east_calder:duty_team')!)).toBe('Working (Duty team)');
		expect(cellLabel(decodeCell('working:east_calder:house_visits')!)).toBe('Working (Visits)');
		expect(cellLabel(decodeCell('working:ratho')!)).toBe('Working (Ratho)');
		expect(cellLabel(decodeCell('working:ratho:duty')!)).toBe('Working (Ratho, Duty)');
		expect(cellLabel(NOT_WORKING)).toBe('Not working');
		expect(cellLabel(OFF_SICK)).toBe('Off sick');
	});
});

describe('CELL_OPTIONS', () => {
	it('has unique keys, EC-only team/visit roles, and the two off states', () => {
		expect(new Set(CELL_OPTIONS.map((o) => o.key)).size).toBe(CELL_OPTIONS.length);
		expect(CELL_OPTIONS.map((o) => o.key)).toEqual([
			'working:east_calder',
			'working:east_calder:duty',
			'working:east_calder:duty_team',
			'working:east_calder:house_visits',
			'working:ratho',
			'working:ratho:duty',
			'not_working',
			'sick'
		]);
	});
});

describe('categories', () => {
	it('GPs and trainees are clinicians; ANPs are not', () => {
		expect(isClinician('doctor')).toBe(true);
		expect(isClinician('gp_trainee')).toBe(true);
		expect(isClinician('anp')).toBe(false);
		expect(isClinician('')).toBe(false);
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
