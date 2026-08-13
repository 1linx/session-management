/**
 * Duty balancing history — the data behind the running Duty Tally (DT).
 *
 * DT = total duty sessions (TDS) ÷ total historical sessions worked (THS),
 * per doctor, over a rolling window. A duty-team session counts the same
 * as a duty session — both are the extra commitment being balanced. Only
 * EAST CALDER sessions count, on both sides of the ratio: Ratho duty falls
 * to whoever is on site (often a Ratho-only doctor), so including it would
 * skew the balancing, which is really about East Calder. Auto-fix
 * prioritises low-DT doctors when assigning duty, so EC duty spreads
 * proportionately to how much each person works at EC.
 *
 * The window defaults to 365 days and can be shrunk for testing via the
 * DUTY_HISTORY_DAYS env var. It is enforced at query time — nothing is
 * deleted. A year of rota for ~25 staff is ~13k small rows, far below any
 * scale SQLite struggles with, and the raw entries also feed the absence
 * summaries, so pruning would cost data for no benefit.
 */
import { and, eq, gte, ne, count, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { scheduleEntries } from './db/schema';
import { addDays, addWeeks, todayISO } from '$lib/dates';
import { slotKey } from '$lib/constants';
import type { DutyHistory, PreviousDuty } from '$lib/rules/types';

/** Rolling window length in days (DUTY_HISTORY_DAYS, default 365). */
export function dutyHistoryDays(): number {
	const parsed = Number(env.DUTY_HISTORY_DAYS);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 365;
}

/** Oldest week Monday still inside the rolling window. */
export function dutyHistoryCutoff(): string {
	return addDays(todayISO(), -dutyHistoryDays());
}

/**
 * Per-user worked/duty totals within the window, for seeding Auto-fix's
 * fairness tally. Pass `excludeWeek` (the week on screen) when feeding the
 * rota page: the live grid supplies that week, including unsaved edits, so
 * counting the saved copy too would double it.
 */
export async function getDutyTallies(excludeWeek?: string): Promise<DutyHistory> {
	const rows = await db
		.select({
			userId: scheduleEntries.userId,
			worked: count(scheduleEntries.id),
			duty: sql<number>`sum(case when ${scheduleEntries.role} in ('duty', 'duty_team') then 1 else 0 end)`
		})
		.from(scheduleEntries)
		.where(
			and(
				eq(scheduleEntries.status, 'working'),
				eq(scheduleEntries.location, 'east_calder'),
				gte(scheduleEntries.weekStart, dutyHistoryCutoff()),
				...(excludeWeek ? [ne(scheduleEntries.weekStart, excludeWeek)] : [])
			)
		)
		.groupBy(scheduleEntries.userId);

	return Object.fromEntries(rows.map((r) => [r.userId, { worked: r.worked, duty: r.duty }]));
}

/**
 * Who held duty in which slots the week before `week` — Auto-fix prefers
 * not to give a doctor the same duty slot two weeks running. Queried
 * regardless of the window so rotation still works with a tiny test window.
 */
export async function getPreviousDuty(week: string): Promise<PreviousDuty> {
	const rows = await db
		.select({
			userId: scheduleEntries.userId,
			weekday: scheduleEntries.weekday,
			period: scheduleEntries.period
		})
		.from(scheduleEntries)
		.where(
			and(eq(scheduleEntries.weekStart, addWeeks(week, -1)), eq(scheduleEntries.role, 'duty'))
		);

	const out: PreviousDuty = {};
	for (const row of rows) {
		(out[row.userId] ??= []).push(slotKey(row.weekday, row.period));
	}
	return out;
}
