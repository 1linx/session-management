import { beforeEach, describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { actions } from '../routes/login/+page.server';
import { validateSession } from '$lib/server/auth';
import { createUser, fakeCookies, formRequest, resetDb } from './helpers';

type LoginEvent = Parameters<(typeof actions)['default']>[0];

function loginEvent(fields: Record<string, string>) {
	const cookies = fakeCookies();
	return {
		event: { request: formRequest(fields), cookies } as unknown as LoginEvent,
		cookies
	};
}

describe('login action', () => {
	beforeEach(resetDb);

	it('logs in with correct initials, sets a valid session cookie, redirects home', async () => {
		const user = await createUser({ initials: 'JB', password: 'password123' });
		const { event, cookies } = loginEvent({ initials: 'JB', password: 'password123' });

		await expect(actions.default(event)).rejects.toSatisfy(
			(e: unknown) => isRedirect(e) && e.status === 303 && e.location === '/'
		);
		const token = cookies.jar.get('session');
		expect(token).toBeTruthy();
		expect((await validateSession(token!))?.id).toBe(user.id);
	});

	it('is case/whitespace-insensitive on the initials', async () => {
		await createUser({ initials: 'JB', password: 'password123' });
		const { event } = loginEvent({ initials: '  jb ', password: 'password123' });
		await expect(actions.default(event)).rejects.toSatisfy(isRedirect);
	});

	it('rejects a wrong password', async () => {
		await createUser({ initials: 'JB', password: 'password123' });
		const { event, cookies } = loginEvent({ initials: 'JB', password: 'wrong-password' });
		const result = await actions.default(event);
		expect(result).toMatchObject({ status: 400 });
		expect(cookies.jar.has('session')).toBe(false);
	});

	it('rejects unknown initials with the same message as a bad password', async () => {
		const result = await actions.default(
			loginEvent({ initials: 'NOBODY', password: 'password123' }).event
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('rejects an inactive user even with correct credentials', async () => {
		await createUser({ initials: 'GONE', password: 'password123', active: false });
		const result = await actions.default(
			loginEvent({ initials: 'GONE', password: 'password123' }).event
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('rejects empty submissions', async () => {
		const result = await actions.default(loginEvent({ initials: '', password: '' }).event);
		expect(result).toMatchObject({ status: 400 });
	});
});
