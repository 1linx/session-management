import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	dutyHistoryDays,
	getDutyTallies,
	getPreviousDuty
} from '$lib/server/duty-history';
import { load as dutyPageLoad } from '../routes/duty/+page.server';
import { addWeeks, currentWeekStart } from '$lib/dates';
import { createEntry, createUser, resetDb, slotsAt } from './helpers';

const thisWeek = currentWeekStart();
const lastWeek = addWeeks(thisWeek, -1);

type LoadEvent = Parameters<typeof dutyPageLoad>[0];
type DutyPageData = Exclude<Awaited<ReturnType<typeof dutyPageLoad>>, void>;

describe('duty history', () => {
	beforeEach(resetDb);
	afterEach(() => {
		delete process.env.DUTY_HISTORY_DAYS;
	});

	it('defaults the window to 365 days, overridable via DUTY_HISTORY_DAYS', () => {
		expect(dutyHistoryDays()).toBe(365);
		process.env.DUTY_HISTORY_DAYS = '7';
		expect(dutyHistoryDays()).toBe(7);
		process.env.DUTY_HISTORY_DAYS = 'garbage';
		expect(dutyHistoryDays()).toBe(365);
	});

	it('sums worked and duty sessions per user, ignoring absences', async () => {
		const a = await createUser();
		await createEntry(a.id, 1, 'AM', { weekStart: lastWeek, role: 'duty' });
		await createEntry(a.id, 1, 'PM', { weekStart: lastWeek });
		await createEntry(a.id, 2, 'AM', { weekStart: lastWeek, status: 'sick', location: null });

		const tallies = await getDutyTallies();
		expect(tallies[a.id]).toEqual({ worked: 2, duty: 1 });
	});

	it('counts duty-team sessions the same as duty', async () => {
		const a = await createUser();
		await createEntry(a.id, 1, 'AM', { weekStart: lastWeek, role: 'duty' });
		await createEntry(a.id, 1, 'PM', { weekStart: lastWeek, role: 'duty_team' });
		await createEntry(a.id, 2, 'AM', { weekStart: lastWeek, role: 'house_visits' }); // not duty
		await createEntry(a.id, 2, 'PM', { weekStart: lastWeek });

		const tallies = await getDutyTallies();
		expect(tallies[a.id]).toEqual({ worked: 4, duty: 2 });
	});

	it('counts East Calder sessions only — Ratho work and duty are excluded', async () => {
		const a = await createUser();
		await createEntry(a.id, 1, 'AM', { weekStart: lastWeek, role: 'duty' }); // EC — counts
		await createEntry(a.id, 2, 'AM', { weekStart: lastWeek, location: 'ratho', role: 'duty' });
		await createEntry(a.id, 2, 'PM', { weekStart: lastWeek, location: 'ratho' });

		const tallies = await getDutyTallies();
		expect(tallies[a.id]).toEqual({ worked: 1, duty: 1 });
	});

	it('excludes the viewed week (the live grid supplies it)', async () => {
		const a = await createUser();
		await createEntry(a.id, 1, 'AM', { weekStart: lastWeek, role: 'duty' });
		await createEntry(a.id, 1, 'AM', { weekStart: thisWeek, role: 'duty' });

		const tallies = await getDutyTallies(thisWeek);
		expect(tallies[a.id]).toEqual({ worked: 1, duty: 1 });
	});

	it('only counts weeks inside the rolling window', async () => {
		const a = await createUser();
		await createEntry(a.id, 1, 'AM', { weekStart: addWeeks(thisWeek, -2), role: 'duty' });
		await createEntry(a.id, 1, 'AM', { weekStart: addWeeks(thisWeek, -10) });

		process.env.DUTY_HISTORY_DAYS = '30'; // includes week −2, excludes week −10
		const tallies = await getDutyTallies();
		expect(tallies[a.id]).toEqual({ worked: 1, duty: 1 });
	});

	it('reports last week’s duty slots per user', async () => {
		const a = await createUser();
		const b = await createUser();
		await createEntry(a.id, 1, 'AM', { weekStart: lastWeek, role: 'duty' });
		await createEntry(a.id, 3, 'PM', { weekStart: lastWeek, role: 'duty' });
		await createEntry(a.id, 4, 'PM', { weekStart: lastWeek }); // routine — not duty
		await createEntry(b.id, 1, 'AM', { weekStart: addWeeks(thisWeek, -2), role: 'duty' }); // wrong week

		const previous = await getPreviousDuty(thisWeek);
		expect(previous[a.id]?.sort()).toEqual(['1:AM', '3:PM']);
		expect(previous[b.id]).toBeUndefined();
	});
});

describe('duty page load', () => {
	beforeEach(resetDb);

	it('returns GP tallies and a week-by-week duty log', async () => {
		const gp = await createUser({ category: 'doctor' });
		const anp = await createUser({ category: 'anp' });
		const rathoGp = await createUser({
			category: 'doctor',
			standardSlots: slotsAt(['1:AM', '2:PM'], 'ratho')
		});
		await createEntry(gp.id, 1, 'AM', { weekStart: lastWeek, role: 'duty' });
		await createEntry(gp.id, 1, 'PM', { weekStart: lastWeek });
		await createEntry(gp.id, 2, 'AM', { weekStart: lastWeek, location: 'ratho', role: 'duty' });
		await createEntry(anp.id, 1, 'AM', { weekStart: lastWeek, role: 'duty_team' });

		const data = (await dutyPageLoad({} as LoadEvent)) as DutyPageData;

		expect(data.windowDays).toBe(365);
		// The Ratho duty session is excluded from the tally (EC-only) but
		// still appears in the duty log below.
		const row = data.tally.find((t: { id: string }) => t.id === gp.id);
		expect(row).toMatchObject({ worked: 2, duty: 1, rathoOnly: false });
		expect(row?.tally).toBeCloseTo(1 / 2);
		// ANPs are not in the tally — duty is a GP concern.
		expect(data.tally.some((t: { id: string }) => t.id === anp.id)).toBe(false);
		// Standard availability entirely at Ratho is marked.
		expect(data.tally.find((t: { id: string }) => t.id === rathoGp.id)).toMatchObject({
			rathoOnly: true
		});

		expect(data.dutyLog).toHaveLength(1);
		expect(data.dutyLog[0].weekStart).toBe(lastWeek);
		expect(data.dutyLog[0].slots['1:AM']).toEqual([
			{ initials: gp.initials, location: 'east_calder' }
		]);
		expect(data.dutyLog[0].slots['2:AM']).toEqual([
			{ initials: gp.initials, location: 'ratho' }
		]);
	});
});
