/**
 * Shared domain constants (safe for client and server).
 * These are the single source of truth for the values stored as plain text
 * in the database — add new statuses/categories here.
 */

export const SESSION_STATUSES = [
	{ value: 'working', label: 'Working' },
	{ value: 'not_working', label: 'Not working' },
	{ value: 'working_ratho', label: 'Working (Ratho)' }
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number]['value'];

export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
	SESSION_STATUSES.map((s) => [s.value, s.label])
);

export function isSessionStatus(value: string): value is SessionStatus {
	return SESSION_STATUSES.some((s) => s.value === value);
}

export const USER_CATEGORIES = [
	{ value: 'doctor', label: 'Doctor' },
	{ value: 'anp', label: 'ANP' }
] as const;

export type UserCategory = (typeof USER_CATEGORIES)[number]['value'];

export const USER_ROLES = [
	{ value: 'admin', label: 'Admin' },
	{ value: 'viewer', label: 'Viewer' }
] as const;

export type UserRole = (typeof USER_ROLES)[number]['value'];

/** ISO weekday numbers — weekends are out of scope for now. */
export const WEEKDAYS = [
	{ value: 1, label: 'Monday' },
	{ value: 2, label: 'Tuesday' },
	{ value: 3, label: 'Wednesday' },
	{ value: 4, label: 'Thursday' },
	{ value: 5, label: 'Friday' }
] as const;

/** Half-day sessions. */
export const PERIODS = [
	{ value: 'AM', label: 'AM', times: '8am–1pm' },
	{ value: 'PM', label: 'PM', times: '1pm–6pm' }
] as const;

export type Period = (typeof PERIODS)[number]['value'];

/** Canonical key for a half-day slot, as stored in `users.working_slots`. */
export function slotKey(weekday: number, period: string): string {
	return `${weekday}:${period}`;
}

/** Every schedulable slot: "1:AM", "1:PM" … "5:PM". */
export const ALL_SLOTS: string[] = WEEKDAYS.flatMap((day) =>
	PERIODS.map((period) => slotKey(day.value, period.value))
);
