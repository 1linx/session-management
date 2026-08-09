import { beforeEach, describe, expect, it } from 'vitest';
import { load } from '../routes/absences/+page.server';
import { addWeeks, currentWeekStart, leaveYearRange, todayISO } from '$lib/dates';
import { createEntry, createUser, resetDb } from './helpers';

type LoadEvent = Parameters<typeof load>[0];
type Row = {
	initials: string;
	leaveEntitlement: number;
	leaveTaken: number;
	leaveRemaining: number;
	sickSessions: number;
	weeksAffected: number;
};

const runLoad = async () => {
	const result = (await load({} as LoadEvent)) as { absences: Row[]; leaveYear: { start: string } };
	return result;
};

describe('absences page', () => {
	beforeEach(resetDb);

	it('totals annual leave against entitlement within the current leave year', async () => {
		const user = await createUser({ initials: 'DR1', leaveEntitlement: 56 });
		const thisWeek = currentWeekStart();
		await createEntry(user.id, 1, 'AM', { status: 'annual_leave', location: null });
		await createEntry(user.id, 1, 'PM', { status: 'annual_leave', location: null });
		await createEntry(user.id, 2, 'AM', { status: 'annual_leave', location: null, weekStart: addWeeks(thisWeek, 1) });
		// Outside the current leave year — must not count.
		const { start } = leaveYearRange(todayISO());
		await createEntry(user.id, 3, 'AM', {
			status: 'annual_leave',
			location: null,
			weekStart: addWeeks(start, -2)
		});
		// Working/sick sessions must not count as leave.
		await createEntry(user.id, 4, 'AM');
		await createEntry(user.id, 4, 'PM', { status: 'sick', location: null });

		const { absences } = await runLoad();
		const row = absences.find((a) => a.initials === 'DR1')!;
		expect(row.leaveEntitlement).toBe(56);
		expect(row.leaveTaken).toBe(3);
		expect(row.leaveRemaining).toBe(53);
	});

	it('reports negative remaining when over entitlement', async () => {
		const user = await createUser({ initials: 'DR2', leaveEntitlement: 1 });
		await createEntry(user.id, 1, 'AM', { status: 'annual_leave', location: null });
		await createEntry(user.id, 1, 'PM', { status: 'annual_leave', location: null });

		const { absences } = await runLoad();
		const row = absences.find((a) => a.initials === 'DR2')!;
		expect(row.leaveTaken).toBe(2);
		expect(row.leaveRemaining).toBe(-1);
	});

	it('keeps sickness totals all-time and separate from leave', async () => {
		const user = await createUser({ initials: 'ANP1', category: 'anp', leaveEntitlement: 10 });
		const thisWeek = currentWeekStart();
		await createEntry(user.id, 1, 'AM', { status: 'sick', location: null });
		await createEntry(user.id, 2, 'AM', {
			status: 'sick',
			location: null,
			weekStart: addWeeks(thisWeek, -60) // long ago — still counts for sickness
		});

		const { absences } = await runLoad();
		const row = absences.find((a) => a.initials === 'ANP1')!;
		expect(row.sickSessions).toBe(2);
		expect(row.weeksAffected).toBe(2);
		expect(row.leaveTaken).toBe(0);
	});

	it('includes staff with no absences at zero', async () => {
		await createUser({ initials: 'DR3', leaveEntitlement: 40 });
		const { absences, leaveYear } = await runLoad();
		const row = absences.find((a) => a.initials === 'DR3')!;
		expect(row).toMatchObject({ leaveTaken: 0, leaveRemaining: 40, sickSessions: 0 });
		expect(leaveYear.start.endsWith('-04-01')).toBe(true);
	});
});
