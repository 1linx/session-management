import { error } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/public';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

/** Step-3 development view: the stored data, unadorned. */
export const load: PageServerLoad = async () => {
	// Off in the anonymised demo: stored values carry the real practice keys.
	if (env.PUBLIC_HIDE_RAW_DATA === 'true') error(404, 'Not found');
	const allUsers = await db
		.select({
			id: users.id,
			name: users.name,
			initials: users.initials,
			role: users.role,
			category: users.category,
			standardSlots: users.standardSlots,
			standardDuty: users.standardDuty,
			canWorkRatho: users.canWorkRatho,
			leaveEntitlement: users.leaveEntitlement,
			displayOrder: users.displayOrder,
			active: users.active
		})
		.from(users)
		.orderBy(asc(users.displayOrder));

	const entries = await db
		.select({
			id: scheduleEntries.id,
			initials: users.initials,
			weekStart: scheduleEntries.weekStart,
			weekday: scheduleEntries.weekday,
			period: scheduleEntries.period,
			status: scheduleEntries.status,
			location: scheduleEntries.location,
			role: scheduleEntries.role,
			updatedAt: scheduleEntries.updatedAt
		})
		.from(scheduleEntries)
		.innerJoin(users, eq(scheduleEntries.userId, users.id))
		.orderBy(
			asc(scheduleEntries.weekStart),
			asc(users.displayOrder),
			asc(scheduleEntries.weekday),
			asc(scheduleEntries.period)
		);

	return { rawUsers: allUsers, rawEntries: entries };
};
