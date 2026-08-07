import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth';
import { parseUserForm } from '$lib/server/user-form';
import { broadcastChange } from '$lib/server/realtime';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const [user] = await db
		.select({
			id: users.id,
			name: users.name,
			initials: users.initials,
			email: users.email,
			role: users.role,
			category: users.category,
			workingSlots: users.workingSlots,
			displayOrder: users.displayOrder,
			onRota: users.onRota,
			active: users.active
		})
		.from(users)
		.where(eq(users.id, params.id));

	if (!user) error(404, 'User not found');

	return { editUser: { ...user, workingSlots: JSON.parse(user.workingSlots) as string[] } };
};

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		const [existing] = await db.select().from(users).where(eq(users.id, params.id));
		if (!existing) error(404, 'User not found');

		const result = parseUserForm(await request.formData());
		if (!result.ok) {
			return fail(400, { message: result.message, values: result.values });
		}
		const { values } = result;

		// Guard against locking yourself out.
		if (locals.user?.id === params.id) {
			if (values.role !== 'admin') {
				return fail(400, { message: 'You cannot remove your own admin access.', values });
			}
			if (!values.active) {
				return fail(400, { message: 'You cannot deactivate your own account.', values });
			}
		}

		try {
			await db
				.update(users)
				.set({
					name: values.name,
					initials: values.initials,
					email: values.email,
					role: values.role,
					category: values.category,
					workingSlots: JSON.stringify(values.workingSlots),
					displayOrder: values.displayOrder,
					onRota: values.onRota,
					active: values.active,
					...(values.password ? { passwordHash: hashPassword(values.password) } : {})
				})
				.where(eq(users.id, params.id));
		} catch (err) {
			if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
				return fail(400, { message: 'A user with that email address already exists.', values });
			}
			throw err;
		}

		// Standard availability only drives defaults for new weeks — changing it
		// deliberately leaves existing rota entries untouched.

		broadcastChange('users');
		redirect(303, '/users');
	}
};
