/**
 * Shared domain constants (safe for client and server).
 * These are the single source of truth for the values stored as plain text
 * in the database — add new statuses, locations, roles or categories here.
 */

/** The two medical practices. First entry is the default. */
export const LOCATIONS = [
	{ value: 'east_calder', label: 'East Calder' },
	{ value: 'ratho', label: 'Ratho' }
] as const;

export type LocationValue = (typeof LOCATIONS)[number]['value'];

export const DEFAULT_LOCATION: LocationValue = LOCATIONS[0].value;

export function locationLabel(value: string | null): string {
	return LOCATIONS.find((l) => l.value === value)?.label ?? (value ?? '');
}

export function isLocation(value: string): value is LocationValue {
	return LOCATIONS.some((l) => l.value === value);
}

/**
 * Roles a working session can carry. Only one role per session.
 * duty        — the designated duty doctor (GPs only; one per practice/session)
 * duty_team   — East Calder duty team member (ANPs first, then GPs)
 * house_visits — East Calder house visits, 12–1pm and 2–3pm (GP/trainee only)
 */
export const SESSION_ROLES = [
	{ value: 'duty', label: 'Duty doctor', chip: 'Duty' },
	{ value: 'duty_team', label: 'Duty team', chip: 'Duty team' },
	{ value: 'house_visits', label: 'House visits', chip: 'Visits' }
] as const;

export type SessionRole = (typeof SESSION_ROLES)[number]['value'];

export function roleChip(role: string | null): string {
	return SESSION_ROLES.find((r) => r.value === role)?.chip ?? '';
}

/**
 * The ways a session can be "not working". Everything here makes the person
 * unavailable to the rota — the rules engine and Auto-fix only ever count
 * status === 'working'. Add new unavailable states here.
 */
export const OFF_STATUSES = [
	{ value: 'not_working', label: 'Not working' },
	{ value: 'sick', label: 'Off sick' },
	{ value: 'annual_leave', label: 'Annual leave' },
	{ value: 'admin_work', label: 'Admin work' },
	{ value: 'minor_surgery', label: 'Minor surgery' },
	{ value: 'special', label: 'Special activity' }
] as const;

export type OffStatus = (typeof OFF_STATUSES)[number]['value'];

export function isOffStatus(value: string): value is OffStatus {
	return OFF_STATUSES.some((s) => s.value === value);
}

/**
 * The full state of one session cell: a status plus its sub-choices.
 * The picker, save validation, rules engine and export all derive from this.
 */
export type CellValue = {
	status: 'working' | OffStatus;
	location: LocationValue | null;
	role: SessionRole | null;
};

export const NOT_WORKING: CellValue = { status: 'not_working', location: null, role: null };

/** Map a raw stored status string to a valid CellValue status. */
export function statusFromDb(raw: string): CellValue['status'] {
	if (raw === 'working') return 'working';
	return isOffStatus(raw) ? raw : 'not_working';
}

/** Wire format for a cell, e.g. "working:ratho:duty", "annual_leave", "sick". */
export function encodeCell(cell: CellValue): string {
	if (cell.status !== 'working') return cell.status;
	return `working:${cell.location ?? DEFAULT_LOCATION}${cell.role ? `:${cell.role}` : ''}`;
}

/** Parse and validate a wire-format cell key. Returns null for anything invalid. */
export function decodeCell(key: string): CellValue | null {
	if (isOffStatus(key)) return { status: key, location: null, role: null };
	const [status, location, ...rest] = key.split(':');
	if (status !== 'working' || !location || !isLocation(location)) return null;
	if (rest.length === 0) return { status: 'working', location, role: null };
	if (rest.length === 1 && SESSION_ROLES.some((r) => r.value === rest[0])) {
		return { status: 'working', location, role: rest[0] as SessionRole };
	}
	return null;
}

/**
 * Human label, matching the established spreadsheet wording: the default
 * location stays implicit ("Working"), everything else parenthesised —
 * "Working (Ratho)", "Working (Duty)", "Working (Ratho, Duty)". Unavailable
 * states use their own labels: "Off sick", "Annual leave", …
 */
export function cellLabel(cell: CellValue): string {
	if (cell.status !== 'working') {
		return OFF_STATUSES.find((s) => s.value === cell.status)?.label ?? 'Not working';
	}
	const extras = [
		cell.location && cell.location !== DEFAULT_LOCATION ? locationLabel(cell.location) : null,
		cell.role ? roleChip(cell.role) : null
	].filter(Boolean);
	return extras.length ? `Working (${extras.join(', ')})` : 'Working';
}

export type CellOption = {
	key: string;
	value: CellValue;
	label: string;
	pickerLabel: string;
	group: string;
};

/**
 * Every pickable cell state, grouped for the picker. Duty team and house
 * visits are East Calder concepts, so they are only offered there.
 */
export const CELL_OPTIONS: CellOption[] = [
	'working:east_calder',
	'working:east_calder:duty',
	'working:east_calder:duty_team',
	'working:east_calder:house_visits',
	'working:ratho',
	'working:ratho:duty',
	...OFF_STATUSES.map((s) => s.value)
].map((key) => {
	const value = decodeCell(key)!;
	return {
		key,
		value,
		label: cellLabel(value),
		pickerLabel: value.status === 'working' ? locationLabel(value.location) : cellLabel(value),
		group: value.status === 'working' ? locationLabel(value.location) : 'Not available'
	};
});

export const CELL_OPTION_GROUPS: string[] = [...new Set(CELL_OPTIONS.map((o) => o.group))];

export const USER_CATEGORIES = [
	{ value: 'doctor', label: 'Doctor' },
	{ value: 'gp_trainee', label: 'GP Trainee' },
	{ value: 'anp', label: 'ANP' }
] as const;

export type UserCategory = (typeof USER_CATEGORIES)[number]['value'];

export function categoryLabel(value: string): string {
	return USER_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** GPs and GP trainees — the people who can run clinics and house visits. */
export function isClinician(category: string): boolean {
	return category === 'doctor' || category === 'gp_trainee';
}

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

/** Canonical key for a half-day slot, e.g. "1:AM". */
export function slotKey(weekday: number, period: string): string {
	return `${weekday}:${period}`;
}

/** Every schedulable slot: "1:AM", "1:PM" … "5:PM". */
export const ALL_SLOTS: string[] = WEEKDAYS.flatMap((day) =>
	PERIODS.map((period) => slotKey(day.value, period.value))
);

/**
 * A user's standard availability: slot → the practice they normally work at.
 * Slots absent from the map are not normally worked. Purely a default for
 * populating new weeks — any session can still be set manually.
 */
export type StandardSlots = Partial<Record<string, LocationValue>>;
