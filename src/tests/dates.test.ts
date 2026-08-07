import { describe, expect, it } from 'vitest';
import {
	addWeeks,
	currentWeekStart,
	dayDateLabel,
	isISODate,
	mondayOf,
	resolveWeek,
	weekLabel
} from '$lib/dates';

describe('isISODate', () => {
	it('accepts valid dates', () => {
		expect(isISODate('2026-08-03')).toBe(true);
		expect(isISODate('2024-02-29')).toBe(true); // leap day
	});

	it('rejects malformed or impossible dates', () => {
		for (const bad of ['', 'nonsense', '2026-8-3', '2026-13-01', '2026-02-30', '2023-02-29', '2026-08-03T00:00:00']) {
			expect(isISODate(bad), bad).toBe(false);
		}
	});
});

describe('mondayOf', () => {
	it('maps every day of a week to its Monday', () => {
		// 2026-08-03 is a Monday.
		expect(mondayOf('2026-08-03')).toBe('2026-08-03');
		expect(mondayOf('2026-08-05')).toBe('2026-08-03'); // Wednesday
		expect(mondayOf('2026-08-07')).toBe('2026-08-03'); // Friday
		expect(mondayOf('2026-08-09')).toBe('2026-08-03'); // Sunday belongs to the week before next
		expect(mondayOf('2026-08-10')).toBe('2026-08-10'); // next Monday
	});

	it('crosses month and year boundaries', () => {
		expect(mondayOf('2026-01-01')).toBe('2025-12-29'); // NY Thursday → previous December
	});
});

describe('addWeeks', () => {
	it('adds and subtracts whole weeks', () => {
		expect(addWeeks('2026-08-03', 1)).toBe('2026-08-10');
		expect(addWeeks('2026-08-03', -1)).toBe('2026-07-27');
	});

	it('is DST-proof (UK clocks change 2026-03-29)', () => {
		expect(addWeeks('2026-03-23', 1)).toBe('2026-03-30'); // both Mondays
		expect(addWeeks('2026-10-19', 1)).toBe('2026-10-26'); // autumn change too
	});
});

describe('resolveWeek', () => {
	it('snaps any date to its Monday', () => {
		expect(resolveWeek('2026-08-05')).toBe('2026-08-03');
		expect(resolveWeek('2026-08-10')).toBe('2026-08-10');
	});

	it('falls back to the current week for missing or invalid input', () => {
		expect(resolveWeek(null)).toBe(currentWeekStart());
		expect(resolveWeek('garbage')).toBe(currentWeekStart());
		expect(resolveWeek('2026-02-30')).toBe(currentWeekStart());
	});
});

describe('labels', () => {
	it('formats the week heading', () => {
		expect(weekLabel('2026-08-03')).toBe('Monday 3 August 2026');
	});

	it('formats row-header day dates', () => {
		expect(dayDateLabel('2026-08-03', 1)).toBe('3 Aug'); // Monday
		expect(dayDateLabel('2026-08-03', 5)).toBe('7 Aug'); // Friday
	});
});

describe('currentWeekStart', () => {
	it('returns a Monday', () => {
		const week = currentWeekStart();
		expect(isISODate(week)).toBe(true);
		expect(mondayOf(week)).toBe(week);
	});
});
