import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import { dutyHistoryCutoff, dutyHistoryDays } from '$lib/server/duty-history';
import { slotKey } from '$lib/constants';
import type { PageServerLoad } from './$types';

/**
 * Duty balance — the audit trail behind Auto-fix's duty assignment.
 *
 * - Tally table: per GP, sessions worked and duty held within the rolling
 *   window, split by practice, and the resulting Duty Tally (all duty ÷
 *   all sessions worked — the same figure getDutyTallies feeds Auto-fix).
 *   Auto-fix gives duty to the lowest tally first.
 * - Duty log: who held duty in every session of every saved week in the
 *   window, newest first, so fairness questions can be answered exactly.
 */
export const load: PageServerLoad = async () => {
	// Everything saved inside the window — the tally as Auto-fix would see
	// it when assigning a brand-new week — broken down by practice so the
	// table can show where each GP's sessions and duty came from.
	const perPractice = await db
		.select({
			userId: scheduleEntries.userId,
			location: scheduleEntries.location,
			worked: count(scheduleEntries.id),
			duty: sql<number>`sum(case when ${scheduleEntries.role} in ('duty', 'duty_team') then 1 else 0 end)`
		})
		.from(scheduleEntries)
		.where(
			and(eq(scheduleEntries.status, 'working'), gte(scheduleEntries.weekStart, dutyHistoryCutoff()))
		)
		.groupBy(scheduleEntries.userId, scheduleEntries.location);

	type Split = { worked: number; duty: number };
	const zero = (): Split => ({ worked: 0, duty: 0 });
	const split = new Map<string, { east_calder: Split; ratho: Split }>();
	for (const row of perPractice) {
		const entry = split.get(row.userId) ?? { east_calder: zero(), ratho: zero() };
		const bucket = row.location === 'ratho' ? entry.ratho : entry.east_calder;
		bucket.worked += row.worked;
		bucket.duty += Number(row.duty);
		split.set(row.userId, entry);
	}

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
			const s = split.get(doc.id) ?? { east_calder: zero(), ratho: zero() };
			const worked = s.east_calder.worked + s.ratho.worked;
			const duty = s.east_calder.duty + s.ratho.duty;
			const practices = Object.values(JSON.parse(standardSlots) as Record<string, string>);
			return {
				...doc,
				mainWorked: s.east_calder.worked,
				mainDuty: s.east_calder.duty,
				branchWorked: s.ratho.worked,
				branchDuty: s.ratho.duty,
				worked,
				duty,
				tally: worked > 0 ? duty / worked : 0,
				// Standard availability is entirely at Ratho — worth marking,
				// since their duty can only ever be the Ratho slot.
				rathoOnly: practices.length > 0 && practices.every((p) => p === 'ratho')
			};
		}),
		dutyLog: [...weeks.entries()].map(([weekStart, slots]) => ({ weekStart, slots }))
	};
};
