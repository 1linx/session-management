import { beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries } from '$lib/server/db/schema';
import { actions, load } from '../routes/+page.server';
import { addDays, addWeeks, currentWeekStart } from '$lib/dates';
import {
	adminLocals,
	createEntry,
	createUser,
	formRequest,
	resetDb,
	slotsAt,
	viewerLocals
} from './helpers';

type LoadEvent = Parameters<typeof load>[0];
type SaveEvent = Parameters<(typeof actions)['save']>[0];

type LoadResult = {
	rotaUsers: { id: string; initials: string; standardSlots: Record<string, string> }[];
	grid: Record<string, Record<string, string>>;
	week: string;
	currentWeek: string;
	weekIsEmpty: boolean;
};
const runLoad = async (week?: string) => {
	const url = new URL(`http://localhost/${week ? `?week=${week}` : ''}`);
	return (await load({ url } as LoadEvent)) as LoadResult;
};

const thisWeek = currentWeekStart();

function saveEvent(fields: Record<string, string>, locals: object, week: string = thisWeek) {
	return { request: formRequest({ week, ...fields }), locals } as unknown as SaveEvent;
}

async function entryInDb(userId: string, weekday: number, period: string) {
	const rows = await db
		.select()
		.from(scheduleEntries)
		.where(
			and(
				eq(scheduleEntries.userId, userId),
				eq(scheduleEntries.weekday, weekday),
				eq(scheduleEntries.period, period)
			)
		);
	return rows[0];
}

describe('rota load', () => {
	beforeEach(resetDb);

	it('returns active on-rota users ordered by display order', async () => {
		await createUser({ initials: 'B', displayOrder: 20 });
		await createUser({ initials: 'A', displayOrder: 10 });
		await createUser({ initials: 'X', displayOrder: 5, active: false });
		await createUser({ initials: 'Y', displayOrder: 6, onRota: false });

		const { rotaUsers } = await runLoad();
		expect(rotaUsers.map((u) => u.initials)).toEqual(['A', 'B']);
	});

	it('parses standard slots and builds the grid of encoded cell keys', async () => {
		const user = await createUser({ standardSlots: slotsAt(['1:AM', '2:PM', '3:AM']) });
		await createEntry(user.id, 1, 'AM', { location: 'ratho', role: 'duty' });
		await createEntry(user.id, 3, 'AM');

		const { rotaUsers, grid } = await runLoad();
		expect(rotaUsers[0].standardSlots).toEqual({
			'1:AM': 'east_calder',
			'2:PM': 'east_calder',
			'3:AM': 'east_calder'
		});
		expect(grid[user.id]['1:AM']).toBe('working:ratho:duty');
		expect(grid[user.id]['3:AM']).toBe('working:east_calder');
		expect(grid[user.id]['2:PM']).toBeUndefined(); // no entry yet
	});

	it('defaults to the current week and scopes the grid to the requested week', async () => {
		const user = await createUser();
		const nextWeek = addWeeks(thisWeek, 1);
		await createEntry(user.id, 1, 'AM', { location: 'ratho' });
		await createEntry(user.id, 1, 'AM', { weekStart: nextWeek, role: 'duty' });

		const current = await runLoad();
		expect(current.week).toBe(thisWeek);
		expect(current.weekIsEmpty).toBe(false);
		expect(current.grid[user.id]['1:AM']).toBe('working:ratho');

		const next = await runLoad(nextWeek);
		expect(next.week).toBe(nextWeek);
		expect(next.grid[user.id]['1:AM']).toBe('working:east_calder:duty');

		const empty = await runLoad(addWeeks(thisWeek, 5));
		expect(empty.weekIsEmpty).toBe(true);
		expect(empty.grid[user.id]).toBeUndefined();
	});

	it('snaps mid-week dates to their Monday and ignores invalid week params', async () => {
		await createUser();
		const nextMonday = addWeeks(thisWeek, 1);
		const nextWednesday = addDays(nextMonday, 2);
		expect((await runLoad(nextWednesday)).week).toBe(nextMonday);
		expect((await runLoad('garbage')).week).toBe(thisWeek);
	});
});

describe('rota save action', () => {
	beforeEach(resetDb);

	it('creates an entry for an available slot', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ standardSlots: slotsAt(['1:AM']) });

		const result = await actions.save(
			saveEvent({ [`cell:${user.id}:1:AM`]: 'working:east_calder' }, adminLocals(admin.id))
		);
		expect(result).toMatchObject({ saved: true });
		expect(await entryInDb(user.id, 1, 'AM')).toMatchObject({
			status: 'working',
			location: 'east_calder',
			role: null
		});
	});

	it('saves sickness and role sub-choices', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser();

		await actions.save(
			saveEvent(
				{
					[`cell:${user.id}:1:AM`]: 'sick',
					[`cell:${user.id}:1:PM`]: 'working:east_calder:duty_team',
					[`cell:${user.id}:2:AM`]: 'working:east_calder:house_visits'
				},
				adminLocals(admin.id)
			)
		);
		expect(await entryInDb(user.id, 1, 'AM')).toMatchObject({ status: 'sick', location: null });
		expect(await entryInDb(user.id, 1, 'PM')).toMatchObject({ role: 'duty_team' });
		expect(await entryInDb(user.id, 2, 'AM')).toMatchObject({ role: 'house_visits' });
	});

	it('saves the unavailable statuses (leave, admin work, surgery, special)', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser();

		await actions.save(
			saveEvent(
				{
					[`cell:${user.id}:1:AM`]: 'annual_leave',
					[`cell:${user.id}:1:PM`]: 'admin_work',
					[`cell:${user.id}:2:AM`]: 'minor_surgery',
					[`cell:${user.id}:2:PM`]: 'special'
				},
				adminLocals(admin.id)
			)
		);
		expect(await entryInDb(user.id, 1, 'AM')).toMatchObject({ status: 'annual_leave' });
		expect(await entryInDb(user.id, 1, 'PM')).toMatchObject({ status: 'admin_work' });
		expect(await entryInDb(user.id, 2, 'AM')).toMatchObject({ status: 'minor_surgery' });
		expect(await entryInDb(user.id, 2, 'PM')).toMatchObject({ status: 'special' });
	});

	it('saves duty and location sub-choices', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ standardSlots: slotsAt(['1:AM', '1:PM']) });

		await actions.save(
			saveEvent(
				{
					[`cell:${user.id}:1:AM`]: 'working:ratho:duty',
					[`cell:${user.id}:1:PM`]: 'working:east_calder:duty'
				},
				adminLocals(admin.id)
			)
		);
		expect(await entryInDb(user.id, 1, 'AM')).toMatchObject({
			status: 'working',
			location: 'ratho',
			role: 'duty'
		});
		expect(await entryInDb(user.id, 1, 'PM')).toMatchObject({
			status: 'working',
			location: 'east_calder',
			role: 'duty'
		});
	});

	it('updates an existing entry rather than duplicating it, clearing stale sub-choices', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ standardSlots: slotsAt(['1:AM']) });
		await createEntry(user.id, 1, 'AM', { location: 'ratho', role: 'duty' });

		await actions.save(saveEvent({ [`cell:${user.id}:1:AM`]: 'not_working' }, adminLocals(admin.id)));
		const rows = await db.select().from(scheduleEntries).where(eq(scheduleEntries.userId, user.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'not_working', location: null, role: null });
	});

	it('saves slots outside standard availability too', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ standardSlots: slotsAt(['1:AM']) });

		await actions.save(
			saveEvent({ [`cell:${user.id}:1:PM`]: 'working:east_calder' }, adminLocals(admin.id))
		);
		expect(await entryInDb(user.id, 1, 'PM')).toMatchObject({
			status: 'working',
			location: 'east_calder'
		});
	});

	it('ignores fields for slots that do not exist', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser();

		await actions.save(
			saveEvent(
				{
					[`cell:${user.id}:6:AM`]: 'working:east_calder', // Saturday
					[`cell:${user.id}:1:XX`]: 'working:east_calder'
				},
				adminLocals(admin.id)
			)
		);
		expect(await db.select().from(scheduleEntries)).toHaveLength(0);
	});

	it('ignores invalid cell values', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ standardSlots: slotsAt(['1:AM']) });

		for (const bad of ['on_holiday', 'working', 'working:mars', 'not_working:duty']) {
			await actions.save(saveEvent({ [`cell:${user.id}:1:AM`]: bad }, adminLocals(admin.id)));
		}
		expect(await entryInDb(user.id, 1, 'AM')).toBeUndefined();
	});

	it('ignores fields for unknown or inactive users', async () => {
		const admin = await createUser({ role: 'admin' });
		const inactive = await createUser({ active: false, standardSlots: slotsAt(['1:AM']) });

		await actions.save(
			saveEvent({ [`cell:${inactive.id}:1:AM`]: 'working:east_calder' }, adminLocals(admin.id))
		);
		expect(await entryInDb(inactive.id, 1, 'AM')).toBeUndefined();
	});

	it('refuses viewers', async () => {
		const viewer = await createUser({ standardSlots: slotsAt(['1:AM']) });

		const result = await actions.save(
			saveEvent({ [`cell:${viewer.id}:1:AM`]: 'working:east_calder' }, viewerLocals(viewer.id))
		);
		expect(result).toMatchObject({ status: 403 });
		expect(await entryInDb(viewer.id, 1, 'AM')).toBeUndefined();
	});

	it('writes to the posted week without touching other weeks', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ standardSlots: slotsAt(['1:AM']) });
		const nextWeek = addWeeks(thisWeek, 1);
		await createEntry(user.id, 1, 'AM', { location: 'ratho' }); // this week

		await actions.save(
			saveEvent({ [`cell:${user.id}:1:AM`]: 'working:east_calder:duty' }, adminLocals(admin.id), nextWeek)
		);

		const rows = await db.select().from(scheduleEntries).where(eq(scheduleEntries.userId, user.id));
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.weekStart === thisWeek)).toMatchObject({ location: 'ratho', role: null });
		expect(rows.find((r) => r.weekStart === nextWeek)).toMatchObject({
			location: 'east_calder',
			role: 'duty'
		});
	});

	it('rejects a missing or invalid week', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ standardSlots: slotsAt(['1:AM']) });

		for (const badWeek of ['', 'garbage', '2026-02-30', addDays(thisWeek, 2)]) {
			const result = await actions.save(
				saveEvent({ [`cell:${user.id}:1:AM`]: 'working:east_calder' }, adminLocals(admin.id), badWeek)
			);
			expect(result).toMatchObject({ status: 400 });
		}
		expect(await entryInDb(user.id, 1, 'AM')).toBeUndefined();
	});

	it('saves several cells across users in one submission', async () => {
		const admin = await createUser({ role: 'admin' });
		const a = await createUser({ standardSlots: slotsAt(['1:AM', '1:PM']) });
		const b = await createUser({ standardSlots: slotsAt(['5:PM']) });

		await actions.save(
			saveEvent(
				{
					[`cell:${a.id}:1:AM`]: 'working:east_calder',
					[`cell:${a.id}:1:PM`]: 'not_working',
					[`cell:${b.id}:5:PM`]: 'working:ratho:duty'
				},
				adminLocals(admin.id)
			)
		);
		expect(await entryInDb(a.id, 1, 'AM')).toMatchObject({ status: 'working' });
		expect(await entryInDb(a.id, 1, 'PM')).toMatchObject({ status: 'not_working' });
		expect(await entryInDb(b.id, 5, 'PM')).toMatchObject({ location: 'ratho', role: 'duty' });
	});
});

// "Use default values" is client-side (fills the grid as unsaved edits for a
// manual Save) so it has no server action to test — the save action above
// covers persisting what it fills in.

describe('weekIsEmpty in the load', () => {
	beforeEach(resetDb);

	it('is false once the week has meaningful entries', async () => {
		const user = await createUser();
		await createEntry(user.id, 1, 'AM');
		expect((await runLoad()).weekIsEmpty).toBe(false);
	});

	it('treats a fully reset week (all Not working) as empty again', async () => {
		const user = await createUser();
		await createEntry(user.id, 1, 'AM', { status: 'not_working', location: null });
		expect((await runLoad()).weekIsEmpty).toBe(true);
	});
});
