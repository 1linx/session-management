import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import { dutyHistoryCutoff, dutyHistoryDays, getDutyTallies } from '$lib/server/duty-history';
import { slotKey } from '$lib/constants';
import type { PageServerLoad } from './$types';

/**
 * Duty balance — the audit trail behind Auto-fix's duty assignment.
 *
 * - Tally table: per GP, sessions worked and duty held within the rolling
 *   window, and the resulting Duty Tally (duty ÷ worked). Auto-fix gives
 *   duty to the lowest tally first.
 * - Duty log: who held duty in every session of every saved week in the
 *   window, newest first, so fairness questions can be answered exactly.
 */
export const load: PageServerLoad = async () => {
	// Everything saved inside the window — the tally as Auto-fix would see
	// it when assigning a brand-new week.
	const tallies = await getDutyTallies();

	const doctors = await db
		.select({
			id: users.id,
			name: users.name,
			initials: users.initials,
			dutyExemptAm: users.dutyExemptAm,
			dutyExemptPm: users.dutyExemptPm,
			standardSlots: users.standardSlots
		})
		.from(users)
		.where(and(eq(users.active, true), eq(users.category, 'doctor'), eq(users.onRota, true)))
		.orderBy(asc(users.displayOrder), asc(users.initials));

	const dutyRows = await db
		.select({
			weekStart: scheduleEntries.weekStart,
			weekday: scheduleEntries.weekday,
			period: scheduleEntries.period,
			location: scheduleEntries.location,
			initials: users.initials
		})
		.from(scheduleEntries)
		.innerJoin(users, eq(users.id, scheduleEntries.userId))
		.where(
			and(eq(scheduleEntries.role, 'duty'), gte(scheduleEntries.weekStart, dutyHistoryCutoff()))
		)
		.orderBy(desc(scheduleEntries.weekStart), asc(scheduleEntries.weekday));

	// weekStart → slotKey → [{ initials, location }] (normally one per practice)
	const weeks = new Map<string, Record<string, { initials: string; location: string | null }[]>>();
	for (const row of dutyRows) {
		const week = weeks.get(row.weekStart) ?? {};
		(week[slotKey(row.weekday, row.period)] ??= []).push({
			initials: row.initials,
			location: row.location
		});
		weeks.set(row.weekStart, week);
	}

	return {
		windowDays: dutyHistoryDays(),
		windowStart: dutyHistoryCutoff(),
		tally: doctors.map(({ standardSlots, ...doc }) => {
			const t = tallies[doc.id] ?? { worked: 0, duty: 0 };
			const practices = Object.values(JSON.parse(standardSlots) as Record<string, string>);
			return {
				...doc,
				worked: t.worked,
				duty: t.duty,
				tally: t.worked > 0 ? t.duty / t.worked : 0,
				// Standard availability is entirely at Ratho — worth marking,
				// since their duty can only ever be the Ratho slot.
				rathoOnly: practices.length > 0 && practices.every((p) => p === 'ratho')
			};
		}),
		dutyLog: [...weeks.entries()].map(([weekStart, slots]) => ({ weekStart, slots }))
	};
};
