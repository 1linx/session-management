import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { createSession, setSessionCookie, verifyPassword } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '')
			.trim()
			.toLowerCase();
		const password = String(data.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { email, message: 'Enter your email address and password.' });
		}

		const [user] = await db.select().from(users).where(eq(users.email, email));
		// Verify against a dummy hash when the user is unknown so response
		// timing does not reveal which email addresses exist.
		const valid = user
			? verifyPassword(password, user.passwordHash)
			: (verifyPassword(password, 'scrypt:00:00'), false);

		if (!user || !valid || !user.active) {
			return fail(400, { email, message: 'Email address or password is incorrect.' });
		}

		const { token, expiresAt } = await createSession(user.id);
		setSessionCookie(cookies, token, expiresAt);
		redirect(303, '/');
	}
};
