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

	it('ignores slots the user does not work', async () => {
		const admin = await createUser({ role: 'admin' });
		const user = await createUser({ workingSlots: '["1:AM"]' });

		await actions.save(
			saveEvent({ [`cell:${user.id}:1:PM`]: 'working:east_calder' }, adminLocals(admin.id))
		);
		expect(await entryInDb(user.id, 1, 'PM')).toBeUndefined();
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
