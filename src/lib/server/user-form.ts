import { ALL_SLOTS, USER_CATEGORIES, USER_ROLES } from '$lib/constants';

export type UserFormValues = {
	name: string;
	initials: string;
	email: string;
	role: string;
	category: string;
	workingSlots: string[];
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
	const values: UserFormValues = {
		name: String(data.get('name') ?? '').trim(),
		initials: String(data.get('initials') ?? '')
			.trim()
			.toUpperCase(),
		email: String(data.get('email') ?? '')
			.trim()
			.toLowerCase(),
		role: String(data.get('role') ?? ''),
		category: String(data.get('category') ?? ''),
		workingSlots: ALL_SLOTS.filter((slot) => data.getAll('workingSlots').includes(slot)),
		displayOrder: Number(data.get('displayOrder') ?? 0),
		onRota: data.get('onRota') === 'on',
		active: data.get('active') === 'on',
		password: String(data.get('password') ?? '')
	};

	const invalid = (message: string): UserFormResult => ({ ok: false, message, values });

	if (!values.name) return invalid('Enter a name.');
	if (!values.initials || values.initials.length > 8) {
		return invalid('Enter initials (up to 8 characters). These appear on the rota.');
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
		return invalid('Enter a valid email address.');
	}
	if (!USER_ROLES.some((r) => r.value === values.role)) return invalid('Choose a user type.');
	if (!USER_CATEGORIES.some((c) => c.value === values.category)) {
		return invalid('Choose a category.');
	}
	if (!Number.isInteger(values.displayOrder)) {
		return invalid('Rota order must be a whole number.');
	}
	if (values.password && values.password.length < 8) {
		return invalid('Passwords must be at least 8 characters.');
	}

	return { ok: true, values };
}
