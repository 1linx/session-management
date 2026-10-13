import {
	ALL_SLOTS,
	USER_CATEGORIES,
	USER_ROLES,
	isLocation,
	slotPeriod,
	type StandardDuty,
	type StandardSlots
} from '$lib/constants';

export type UserFormValues = {
	name: string;
	initials: string;
	role: string;
	category: string;
	standardSlots: StandardSlots;
	standardDuty: StandardDuty;
	canWorkRatho: boolean;
	dutyExemptAm: boolean;
	dutyExemptPm: boolean;
	leaveEntitlement: number;
	displayOrder: number;
	onRota: boolean;
	active: boolean;
	password: string;
};

export type UserFormResult =
	| { ok: true; values: UserFormValues }
	| { ok: false; message: string; values: UserFormValues };

/** Parse and validate the shared add/edit user form. */
export function parseUserForm(data: FormData): UserFormResult {
	const standardSlots: StandardSlots = {};
	const standardDuty: StandardDuty = [];
	for (const slot of ALL_SLOTS) {
		const value = String(data.get(`slot:${slot}`) ?? 'none');
		if (isLocation(value)) standardSlots[slot] = value;
		if (data.get(`duty:${slot}`) === 'on') standardDuty.push(slot);
	}

	const values: UserFormValues = {
		name: String(data.get('name') ?? '').trim(),
		initials: String(data.get('initials') ?? '')
			.trim()
			.toUpperCase(),
		role: String(data.get('role') ?? ''),
		category: String(data.get('category') ?? ''),
		standardSlots,
		standardDuty,
		canWorkRatho: data.get('canWorkRatho') === 'on',
		dutyExemptAm: data.get('dutyExemptAm') === 'on',
		dutyExemptPm: data.get('dutyExemptPm') === 'on',
		leaveEntitlement: Number(data.get('leaveEntitlement') ?? 0),
		displayOrder: Number(data.get('displayOrder') ?? 0),
		onRota: data.get('onRota') === 'on',
		active: data.get('active') === 'on',
		password: String(data.get('password') ?? '')
	};

	const invalid = (message: string): UserFormResult => ({ ok: false, message, values });

	if (!values.name) return invalid('Enter a name.');
	if (!values.initials || values.initials.length > 8 || /\s/.test(values.initials)) {
		return invalid(
			'Enter initials (up to 8 characters, no spaces). These appear on the rota and are the login username.'
		);
	}
	if (!USER_ROLES.some((r) => r.value === values.role)) return invalid('Choose a user type.');
	if (!USER_CATEGORIES.some((c) => c.value === values.category)) {
		return invalid('Choose a category.');
	}
	// "Always on duty" only makes sense for a GP, in a session they normally
	// work, and never in a period they're excluded from duty.
	if (values.standardDuty.length > 0) {
		if (values.category !== 'doctor') {
			return invalid('Only GPs can be set to always take duty — untick the Duty boxes.');
		}
		if (values.standardDuty.some((slot) => !(slot in values.standardSlots))) {
			return invalid('Duty can only be ticked for sessions with a practice selected.');
		}
		const exempt = { AM: values.dutyExemptAm, PM: values.dutyExemptPm };
		if (values.standardDuty.some((slot) => exempt[slotPeriod(slot)])) {
			return invalid(
				'Someone excluded from duty in a period cannot always take duty in that period.'
			);
		}
	}
	if (!Number.isInteger(values.displayOrder)) {
		return invalid('Rota order must be a whole number.');
	}
	if (
		!Number.isInteger(values.leaveEntitlement) ||
		values.leaveEntitlement < 0 ||
		values.leaveEntitlement > 999
	) {
		return invalid('Annual leave entitlement must be a whole number of sessions (0–999).');
	}
	if (values.password && values.password.length < 8) {
		return invalid('Passwords must be at least 8 characters.');
	}

	return { ok: true, values };
}
