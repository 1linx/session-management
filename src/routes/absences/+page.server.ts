import { asc, count, countDistinct, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

/** Sickness absence summary: raw session totals per staff member. */
export const load: PageServerLoad = async () => {
	const totals = await db
		.select({
			userId: scheduleEntries.userId,
			sickSessions: count(scheduleEntries.id),
			weeksAffected: countDistinct(scheduleEntries.weekStart)
		})
		.from(scheduleEntries)
		.where(eq(scheduleEntries.status, 'sick'))
		.groupBy(scheduleEntries.userId);

	const byUser = new Map(totals.map((t) => [t.userId, t]));

	const staff = await db
		.select({
			id: users.id,
			name: users.name,
			initials: users.initials,
			category: users.category
		})
		.from(users)
		.where(eq(users.active, true))
		.orderBy(asc(users.displayOrder), asc(users.initials));

	return {
		absences: staff.map((member) => ({
			...member,
			sickSessions: byUser.get(member.id)?.sickSessions ?? 0,
			weeksAffected: byUser.get(member.id)?.weeksAffected ?? 0
		}))
	};
};
