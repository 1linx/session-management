/**
 * Shared domain constants (safe for client and server).
 * These are the single source of truth for the values stored as plain text
 * in the database — add new statuses/categories here.
 */

/** Places a working session can happen. First entry is the default. */
export const LOCATIONS = [
	{ value: 'east_calder', label: 'East Calder' },
	{ value: 'ratho', label: 'Ratho' }
] as const;

export type LocationValue = (typeof LOCATIONS)[number]['value'];

export const DEFAULT_LOCATION: LocationValue = LOCATIONS[0].value;

export function locationLabel(value: string | null): string {
	return LOCATIONS.find((l) => l.value === value)?.label ?? (value ?? '');
}

/**
 * The full state of one session cell: a status plus its sub-choices.
 * Add statuses, locations or flags here — the picker, save validation
 * and export all derive from these definitions.
 */
export type CellValue = {
	status: 'working' | 'not_working';
	location: LocationValue | null;
	duty: boolean;
};

export const NOT_WORKING: CellValue = { status: 'not_working', location: null, duty: false };

/** Wire format for a cell, e.g. "working:ratho:duty" or "not_working". */
export function encodeCell(cell: CellValue): string {
	if (cell.status !== 'working') return 'not_working';
	return `working:${cell.location ?? DEFAULT_LOCATION}${cell.duty ? ':duty' : ''}`;
}

/** Parse and validate a wire-format cell key. Returns null for anything invalid. */
export function decodeCell(key: string): CellValue | null {
	if (key === 'not_working') return { ...NOT_WORKING };
	const [status, location, ...flags] = key.split(':');
	if (status !== 'working') return null;
	if (!LOCATIONS.some((l) => l.value === location)) return null;
	if (flags.length === 0) return { status: 'working', location: location as LocationValue, duty: false };
	if (flags.length === 1 && flags[0] === 'duty') {
		return { status: 'working', location: location as LocationValue, duty: true };
	}
	return null;
}

/**
 * Human label, matching the established spreadsheet wording: the default
 * location stays implicit ("Working"), everything else is parenthesised —
 * "Working (Ratho)", "Working (Duty)", "Working (Ratho, Duty)".
 */
export function cellLabel(cell: CellValue): string {
	if (cell.status !== 'working') return 'Not working';
	const extras = [
		cell.location && cell.location !== DEFAULT_LOCATION ? locationLabel(cell.location) : null,
		cell.duty ? 'Duty' : null
	].filter(Boolean);
	return extras.length ? `Working (${extras.join(', ')})` : 'Working';
}

/** Every pickable cell state, in picker display order. */
export const CELL_OPTIONS: { key: string; value: CellValue; label: string; pickerLabel: string }[] =
	[
		...LOCATIONS.flatMap((location) => [
			`working:${location.value}`,
			`working:${location.value}:duty`
		]),
		'not_working'
	].map((key) => {
		const value = decodeCell(key)!;
		return {
			key,
			value,
			label: cellLabel(value),
			pickerLabel:
				value.status !== 'working'
					? 'Not working'
					: `${locationLabel(value.location)}${value.duty ? ' — Duty' : ''}`
		};
	});

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
