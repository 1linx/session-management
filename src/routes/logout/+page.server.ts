import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, clearSessionCookie, destroySession } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) await destroySession(token);
		clearSessionCookie(cookies);
		redirect(303, '/login');
	}
};
