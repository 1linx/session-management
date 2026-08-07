import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth';
import { parseUserForm } from '$lib/server/user-form';
import { broadcastChange } from '$lib/server/realtime';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		const result = parseUserForm(await request.formData());
		if (!result.ok) {
			return fail(400, { message: result.message, values: result.values });
		}
		const { values } = result;
		if (!values.password) {
			return fail(400, { message: 'Enter a password for the new user.', values });
		}

		try {
			await db.insert(users).values({
				name: values.name,
				initials: values.initials,
				email: values.email,
				role: values.role,
				category: values.category,
				workingSlots: JSON.stringify(values.workingSlots),
				displayOrder: values.displayOrder,
				onRota: values.onRota,
				active: values.active,
				passwordHash: hashPassword(values.password)
			});
		} catch (error) {
			if (error instanceof Error && error.message.includes('UNIQUE constraint')) {
				return fail(400, { message: 'A user with that email address already exists.', values });
			}
			throw error;
		}

		broadcastChange('users');
		redirect(303, '/users');
	}
};
