import { and, asc, count, countDistinct, eq, gte, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import { leaveYearRange, todayISO } from '$lib/dates';
import type { PageServerLoad } from './$types';

/**
 * Absence summary per staff member:
 * - Annual leave taken within the current leave year (1 Apr – 31 Mar),
 *   against each person's entitlement. A week's entries count toward the
 *   leave year containing its Monday.
 * - Sickness as raw all-time totals.
 */
export const load: PageServerLoad = async () => {
	const leaveYear = leaveYearRange(todayISO());

	const leaveTotals = await db
		.select({ userId: scheduleEntries.userId, taken: count(scheduleEntries.id) })
		.from(scheduleEntries)
		.where(
			and(
				eq(scheduleEntries.status, 'annual_leave'),
				gte(scheduleEntries.weekStart, leaveYear.start),
				lt(scheduleEntries.weekStart, leaveYear.end)
			)
		)
		.groupBy(scheduleEntries.userId);
	const leaveByUser = new Map(leaveTotals.map((t) => [t.userId, t.taken]));

	const sickTotals = await db
		.select({
			userId: scheduleEntries.userId,
			sickSessions: count(scheduleEntries.id),
			weeksAffected: countDistinct(scheduleEntries.weekStart)
		})
		.from(scheduleEntries)
		.where(eq(scheduleEntries.status, 'sick'))
		.groupBy(scheduleEntries.userId);
	const sickByUser = new Map(sickTotals.map((t) => [t.userId, t]));

	const staff = await db
		.select({
			id: users.id,
			name: users.name,
			initials: users.initials,
			category: users.category,
			leaveEntitlement: users.leaveEntitlement
		})
		.from(users)
		.where(eq(users.active, true))
		.orderBy(asc(users.displayOrder), asc(users.initials));

	return {
		leaveYear,
		absences: staff.map((member) => {
			const taken = leaveByUser.get(member.id) ?? 0;
			return {
				...member,
				leaveTaken: taken,
				leaveRemaining: member.leaveEntitlement - taken,
				sickSessions: sickByUser.get(member.id)?.sickSessions ?? 0,
				weeksAffected: sickByUser.get(member.id)?.weeksAffected ?? 0
			};
		})
	};
};
