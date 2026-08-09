import { redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, validateSession } from '$lib/server/auth';

/** Routes reachable without being signed in. */
const PUBLIC_ROUTES = new Set(['/login']);

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await validateSession(token) : null;

	const path = event.url.pathname;
	if (!event.locals.user && !PUBLIC_ROUTES.has(path)) {
		redirect(303, '/login');
	}
	if (event.locals.user && path === '/login') {
		redirect(303, '/');
	}

	// Admin-only sections. Viewers only get the rota (and its export).
	const adminOnly = ['/users', '/settings', '/absences', '/raw'];
	if (adminOnly.some((p) => path.startsWith(p)) && event.locals.user?.role !== 'admin') {
		redirect(303, '/');
	}

	return resolve(event);
};
