import { beforeEach, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries } from '$lib/server/db/schema';
import { actions, load } from '../routes/+page.server';
import { adminLocals, createEntry, createUser, formRequest, resetDb, viewerLocals } from './helpers';

type LoadEvent = Parameters<typeof load>[0];
type SaveEvent = Parameters<(typeof actions)['save']>[0];

type LoadResult = {
	rotaUsers: { id: string; initials: string; workingSlots: string[] }[];
	grid: Record<string, Record<string, string>>;
};
const runLoad = async () => (await load({} as LoadEvent)) as LoadResult;

function saveEvent(fields: Record<string, string>, locals: object) {
	return { request: formRequest(fields), locals } as unknown as SaveEvent;
}

async function statusInDb(userId: string, weekday: number, period: string) {
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
	return rows[0]?.status;
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

	it('parses working slots and builds the grid keyed by user and slot', async () => {
		const user = await createUser({ workingSlots: '["1:AM","2:PM"]' });
		await createEntry(user.id, 1, 'AM', 'working_ratho');

		const { rotaUsers, grid } = await runLoad();
		expect(rotaUsers[0].workingSlots).toEqual(['1:AM', '2:PM']);
		expect(grid[user.id]['1:AM']).toBe('working_ratho');
		expect(grid[user.id]['2:PM']).toBeUndefined(); // no entry yet
	});
});

describe('rota save action', () => {
	beforeEach(resetDb);

	it('creates an entry for an available slot', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM"]' });

		const result = await actions.save(
			saveEvent({ [`cell:${user.id}:1:AM`]: 'working' }, adminLocals(admin.id))
		);
		expect(result).toMatchObject({ saved: true });
		expect(await statusInDb(user.id, 1, 'AM')).toBe('working');
	});

	it('updates an existing entry rather than duplicating it', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM"]' });
		await createEntry(user.id, 1, 'AM', 'working');

		await actions.save(saveEvent({ [`cell:${user.id}:1:AM`]: 'working_ratho' }, adminLocals(admin.id)));
		const rows = await db.select().from(scheduleEntries).where(eq(scheduleEntries.userId, user.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('working_ratho');
	});

	it('ignores slots the user does not work', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM"]' });

		await actions.save(saveEvent({ [`cell:${user.id}:1:PM`]: 'working' }, adminLocals(admin.id)));
		expect(await statusInDb(user.id, 1, 'PM')).toBeUndefined();
	});

	it('ignores invalid status values', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM"]' });

		await actions.save(saveEvent({ [`cell:${user.id}:1:AM`]: 'on_holiday' }, adminLocals(admin.id)));
		expect(await statusInDb(user.id, 1, 'AM')).toBeUndefined();
	});

	it('ignores fields for unknown or inactive users', async () => {
		const admin = await createUser({ role: 'admin' });
		const inactive = await createUser({ active: false, workingSlots: '["1:AM"]' });

		await actions.save(saveEvent({ [`cell:${inactive.id}:1:AM`]: 'working' }, adminLocals(admin.id)));
		expect(await statusInDb(inactive.id, 1, 'AM')).toBeUndefined();
	});

	it('refuses viewers', async () => {
		const viewer = await createUser({ workingSlots: '["1:AM"]' });

		const result = await actions.save(
			saveEvent({ [`cell:${viewer.id}:1:AM`]: 'working' }, viewerLocals(viewer.id))
		);
		expect(result).toMatchObject({ status: 403 });
		expect(await statusInDb(viewer.id, 1, 'AM')).toBeUndefined();
	});

	it('saves several cells across users in one submission', async () => {
		const admin = await createUser({ role: 'admin' });
		const a = await createUser({ workingSlots: '["1:AM","1:PM"]' });
		const b = await createUser({ workingSlots: '["5:PM"]' });

		await actions.save(
			saveEvent(
				{
					[`cell:${a.id}:1:AM`]: 'working',
					[`cell:${a.id}:1:PM`]: 'not_working',
					[`cell:${b.id}:5:PM`]: 'working_ratho'
				},
				adminLocals(admin.id)
			)
		);
		expect(await statusInDb(a.id, 1, 'AM')).toBe('working');
		expect(await statusInDb(a.id, 1, 'PM')).toBe('not_working');
		expect(await statusInDb(b.id, 5, 'PM')).toBe('working_ratho');
	});
});
