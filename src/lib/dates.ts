/**
 * Week/date helpers (safe for client and server). Rota weeks are identified
 * by their Monday as an ISO date string ('YYYY-MM-DD'). All arithmetic is
 * done in UTC on pure dates, which makes it immune to DST shifts; only
 * "today" is timezone-aware (the rota runs on UK time).
 */

const DAY_MS = 86_400_000;

export const ROTA_TIMEZONE = 'Europe/London';

/** Today's date in the rota's timezone, as 'YYYY-MM-DD'. */
export function todayISO(): string {
	// en-CA formats as YYYY-MM-DD.
	return new Intl.DateTimeFormat('en-CA', { timeZone: ROTA_TIMEZONE }).format(new Date());
}

/** Strictly validate a 'YYYY-MM-DD' string (rejects e.g. 2026-02-30). */
export function isISODate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Monday of the week containing the given ISO date. */
export function mondayOf(isoDate: string): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	const daysSinceMonday = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
	return new Date(date.getTime() - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}

export function addWeeks(isoDate: string, weeks: number): string {
	return addDays(isoDate, weeks * 7);
}

export function addDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the current week. */
export function currentWeekStart(): string {
	return mondayOf(todayISO());
}

/** Resolve a ?week= query value to a Monday; anything invalid means the current week. */
export function resolveWeek(raw: string | null): string {
	if (raw && isISODate(raw)) return mondayOf(raw);
	return currentWeekStart();
}

/** "Monday 3 August 2026" — for the week navigation heading. */
export function weekLabel(isoMonday: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	})
		.format(new Date(`${isoMonday}T00:00:00Z`))
		.replace(',', ''); // ICU inserts "Monday, 3 …"; UK style has no comma
}

/** "3 Aug" — the date of a weekday (1 = Monday) within a week, for row headers. */
export function dayDateLabel(isoMonday: string, weekday: number): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		timeZone: 'UTC'
	}).format(new Date(`${addDays(isoMonday, weekday - 1)}T00:00:00Z`));
}
