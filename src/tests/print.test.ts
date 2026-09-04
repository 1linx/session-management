import { beforeEach, describe, expect, it } from 'vitest';
import { load } from '../routes/print/+page.server';
import { currentWeekStart } from '$lib/dates';
import { createEntry, createUser, resetDb } from './helpers';

type LoadEvent = Parameters<typeof load>[0];
type PrintData = Exclude<Awaited<ReturnType<typeof load>>, void>;

const runLoad = async (week?: string) => {
	const url = new URL(`http://localhost/print${week ? `?week=${week}` : ''}`);
	return (await load({ url } as LoadEvent)) as PrintData;
};

describe('print sheet load', () => {
	beforeEach(resetDb);

	it('includes GPs and trainees but not ANPs, with the week grid', async () => {
		const gp = await createUser({ category: 'doctor' });
		const trainee = await createUser({ category: 'gp_trainee' });
		const anp = await createUser({ category: 'anp' });
		const hidden = await createUser({ category: 'doctor', onRota: false });
		await createEntry(gp.id, 1, 'AM', { location: 'ratho', role: 'duty' });
		await createEntry(gp.id, 2, 'PM', { status: 'annual_leave', location: null });

		const data = await runLoad();
		const ids = data.staff.map((s: { id: string }) => s.id);
		expect(ids).toContain(gp.id);
		expect(ids).toContain(trainee.id);
		expect(ids).not.toContain(anp.id);
		expect(ids).not.toContain(hidden.id);

		expect(data.week).toBe(currentWeekStart());
		expect(data.grid[gp.id]['1:AM']).toMatchObject({
			status: 'working',
			location: 'ratho',
			role: 'duty'
		});
		expect(data.grid[gp.id]['2:PM']).toMatchObject({ status: 'annual_leave' });
	});
});
