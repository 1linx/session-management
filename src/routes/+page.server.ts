import { fail } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import { decodeCell, encodeCell, type LocationValue } from '$lib/constants';
import { broadcastChange } from '$lib/server/realtime';
import type { Actions, PageServerLoad } from './$types';

async function loadRotaUsers() {
	return db
		.select({
			id: users.id,
			name: users.name,
			initials: users.initials,
			category: users.category,
			workingSlots: users.workingSlots
		})
		.from(users)
		.where(and(eq(users.active, true), eq(users.onRota, true)))
		.orderBy(asc(users.displayOrder), asc(users.initials));
}

export const load: PageServerLoad = async () => {
	const rotaUsers = await loadRotaUsers();

	const entries = rotaUsers.length
		? await db
				.select()
				.from(scheduleEntries)
				.where(
					inArray(
						scheduleEntries.userId,
						rotaUsers.map((u) => u.id)
					)
				)
		: [];

	// grid[userId]["<weekday>:<period>"] = encoded cell key (e.g. "working:ratho:duty")
	const grid: Record<string, Record<string, string>> = {};
	for (const entry of entries) {
		(grid[entry.userId] ??= {})[`${entry.weekday}:${entry.period}`] = encodeCell({
			status: entry.status === 'working' ? 'working' : 'not_working',
			location: (entry.location as LocationValue | null) ?? null,
			duty: entry.duty
		});
	}

	return {
		rotaUsers: rotaUsers.map((u) => ({ ...u, workingSlots: JSON.parse(u.workingSlots) as string[] })),
		grid
	};
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') {
			return fail(403, { message: 'Only admins can edit the rota.' });
		}

		const data = await request.formData();
		const rotaUsers = await loadRotaUsers();

		for (const user of rotaUsers) {
			const workingSlots = JSON.parse(user.workingSlots) as string[];
			for (const slot of workingSlots) {
				const [weekdayRaw, period] = slot.split(':');
				const weekday = Number(weekdayRaw);
				const value = data.get(`cell:${user.id}:${weekday}:${period}`);
				if (typeof value !== 'string') continue;
				const cell = decodeCell(value);
				if (!cell) continue;
				const fields = { status: cell.status, location: cell.location, duty: cell.duty };
				await db
					.insert(scheduleEntries)
					.values({ userId: user.id, weekday, period, ...fields })
					.onConflictDoUpdate({
						target: [scheduleEntries.userId, scheduleEntries.weekday, scheduleEntries.period],
						set: { ...fields, updatedAt: new Date() }
					});
			}
		}

		broadcastChange('rota');
		return { saved: true };
	}
};
