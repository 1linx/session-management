import { beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries } from '$lib/server/db/schema';
import { actions, load } from '../routes/+page.server';
import { addDays, addWeeks, currentWeekStart } from '$lib/dates';
import { adminLocals, createEntry, createUser, formRequest, resetDb, viewerLocals } from './helpers';

type LoadEvent = Parameters<typeof load>[0];
type SaveEvent = Parameters<(typeof actions)['save']>[0];

type LoadResult = {
	rotaUsers: { id: string; initials: string; workingSlots: string[] }[];
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

	it('parses working slots and builds the grid of encoded cell keys', async () => {
		const user = await createUser({ workingSlots: '["1:AM","2:PM","3:AM"]' });
		await createEntry(user.id, 1, 'AM', { location: 'ratho', duty: true });
		await createEntry(user.id, 3, 'AM');

		const { rotaUsers, grid } = await runLoad();
		expect(rotaUsers[0].workingSlots).toEqual(['1:AM', '2:PM', '3:AM']);
		expect(grid[user.id]['1:AM']).toBe('working:ratho:duty');
		expect(grid[user.id]['3:AM']).toBe('working:east_calder');
		expect(grid[user.id]['2:PM']).toBeUndefined(); // no entry yet
	});

	it('defaults to the current week and scopes the grid to the requested week', async () => {
		const user = await createUser();
		const nextWeek = addWeeks(thisWeek, 1);
		await createEntry(user.id, 1, 'AM', { location: 'ratho' });
		await createEntry(user.id, 1, 'AM', { weekStart: nextWeek, duty: true });

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
		const user = await createUser({ workingSlots: '["1:AM"]' });

		const result = await actions.save(
			saveEvent({ [`cell:${user.id}:1:AM`]: 'working:east_calder' }, adminLocals(admin.id))
		);
		expect(result).toMatchObject({ saved: true });
		expect(await entryInDb(user.id, 1, 'AM')).toMatchObject({
			status: 'working',
			location: 'east_calder',
			duty: false
		});
	});

	it('saves duty and location sub-choices', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM","1:PM"]' });

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
			duty: true
		});
		expect(await entryInDb(user.id, 1, 'PM')).toMatchObject({
			status: 'working',
			location: 'east_calder',
			duty: true
		});
	});

	it('updates an existing entry rather than duplicating it, clearing stale sub-choices', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM"]' });
		await createEntry(user.id, 1, 'AM', { location: 'ratho', duty: true });

		await actions.save(saveEvent({ [`cell:${user.id}:1:AM`]: 'not_working' }, adminLocals(admin.id)));
		const rows = await db.select().from(scheduleEntries).where(eq(scheduleEntries.userId, user.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'not_working', location: null, duty: false });
	});

	it('saves slots outside standard availability too', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM"]' });

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
		const user = await createUser({ workingSlots: '["1:AM"]' });

		for (const bad of ['on_holiday', 'working', 'working:mars', 'not_working:duty']) {
			await actions.save(saveEvent({ [`cell:${user.id}:1:AM`]: bad }, adminLocals(admin.id)));
		}
		expect(await entryInDb(user.id, 1, 'AM')).toBeUndefined();
	});

	it('ignores fields for unknown or inactive users', async () => {
		const admin = await createUser({ role: 'admin' });
		const inactive = await createUser({ active: false, workingSlots: '["1:AM"]' });

		await actions.save(
			saveEvent({ [`cell:${inactive.id}:1:AM`]: 'working:east_calder' }, adminLocals(admin.id))
		);
		expect(await entryInDb(inactive.id, 1, 'AM')).toBeUndefined();
	});

	it('refuses viewers', async () => {
		const viewer = await createUser({ workingSlots: '["1:AM"]' });

		const result = await actions.save(
			saveEvent({ [`cell:${viewer.id}:1:AM`]: 'working:east_calder' }, viewerLocals(viewer.id))
		);
		expect(result).toMatchObject({ status: 403 });
		expect(await entryInDb(viewer.id, 1, 'AM')).toBeUndefined();
	});

	it('writes to the posted week without touching other weeks', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM"]' });
		const nextWeek = addWeeks(thisWeek, 1);
		await createEntry(user.id, 1, 'AM', { location: 'ratho' }); // this week

		await actions.save(
			saveEvent({ [`cell:${user.id}:1:AM`]: 'working:east_calder:duty' }, adminLocals(admin.id), nextWeek)
		);

		const rows = await db.select().from(scheduleEntries).where(eq(scheduleEntries.userId, user.id));
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.weekStart === thisWeek)).toMatchObject({ location: 'ratho', duty: false });
		expect(rows.find((r) => r.weekStart === nextWeek)).toMatchObject({
			location: 'east_calder',
			duty: true
		});
	});

	it('rejects a missing or invalid week', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM"]' });

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
		const a = await createUser({ workingSlots: '["1:AM","1:PM"]' });
		const b = await createUser({ workingSlots: '["5:PM"]' });

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
		expect(await entryInDb(b.id, 5, 'PM')).toMatchObject({ location: 'ratho', duty: true });
	});
});

describe('useDefaults action', () => {
	beforeEach(resetDb);

	const defaultsEvent = (locals: object, week: string) =>
		({ request: formRequest({ week }), locals }) as unknown as Parameters<
			(typeof actions)['useDefaults']
		>[0];

	it('marks everyone Working (default location) on their standard availability', async () => {
		const admin = await createUser({ role: 'admin', onRota: false });
		const fullTimer = await createUser(); // all 10 slots
		const morningsOnly = await createUser({ workingSlots: '["1:AM","2:AM"]' });

		const result = await actions.useDefaults(defaultsEvent(adminLocals(admin.id), thisWeek));
		expect(result).toMatchObject({ defaulted: true });

		const rows = await db
			.select()
			.from(scheduleEntries)
			.where(eq(scheduleEntries.weekStart, thisWeek));
		expect(rows).toHaveLength(12); // 10 + 2, nothing for the off-rota admin
		expect(rows.every((r) => r.status === 'working' && r.location === 'east_calder' && !r.duty)).toBe(
			true
		);
		expect(rows.filter((r) => r.userId === morningsOnly.id).map((r) => `${r.weekday}:${r.period}`).sort()).toEqual(
			['1:AM', '2:AM']
		);
		expect(rows.some((r) => r.userId === fullTimer.id && r.weekday === 5 && r.period === 'PM')).toBe(true);
	});

	it('refuses when the week already has entries', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser();
		await createEntry(user.id, 1, 'AM');

		const result = await actions.useDefaults(defaultsEvent(adminLocals(admin.id), thisWeek));
		expect(result).toMatchObject({ status: 400 });
	});

	it('refuses viewers', async () => {
		const viewer = await createUser();
		const result = await actions.useDefaults(defaultsEvent(viewerLocals(viewer.id), thisWeek));
		expect(result).toMatchObject({ status: 403 });
		expect(await db.select().from(scheduleEntries)).toHaveLength(0);
	});
});

describe('copyWeek action', () => {
	beforeEach(resetDb);

	const copyEvent = (locals: object, week: string) =>
		({ request: formRequest({ week }), locals }) as unknown as Parameters<
			(typeof actions)['copyWeek']
		>[0];

	it('copies the previous week into an empty week', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser();
		await createEntry(user.id, 1, 'AM', { location: 'ratho', duty: true });
		await createEntry(user.id, 2, 'PM', { status: 'not_working', location: null });
		const nextWeek = addWeeks(thisWeek, 1);

		const result = await actions.copyWeek(copyEvent(adminLocals(admin.id), nextWeek));
		expect(result).toMatchObject({ copied: true });

		const copied = await db
			.select()
			.from(scheduleEntries)
			.where(eq(scheduleEntries.weekStart, nextWeek));
		expect(copied).toHaveLength(2);
		expect(copied.find((r) => r.weekday === 1)).toMatchObject({ location: 'ratho', duty: true });
		expect(copied.find((r) => r.weekday === 2)).toMatchObject({ status: 'not_working' });
	});

	it('refuses when the target week already has entries', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser();
		const nextWeek = addWeeks(thisWeek, 1);
		await createEntry(user.id, 1, 'AM'); // source
		await createEntry(user.id, 1, 'PM', { weekStart: nextWeek }); // target not empty

		const result = await actions.copyWeek(copyEvent(adminLocals(admin.id), nextWeek));
		expect(result).toMatchObject({ status: 400 });
	});

	it('refuses when the previous week is empty', async () => {
		const admin = await createUser({ role: 'admin' });
		await createUser();

		const result = await actions.copyWeek(
			copyEvent(adminLocals(admin.id), addWeeks(thisWeek, 5))
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('refuses viewers', async () => {
		const viewer = await createUser();
		await createEntry(viewer.id, 1, 'AM');

		const result = await actions.copyWeek(
			copyEvent(viewerLocals(viewer.id), addWeeks(thisWeek, 1))
		);
		expect(result).toMatchObject({ status: 403 });
	});
});
