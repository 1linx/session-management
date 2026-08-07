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

	it('logs in with correct credentials, sets a valid session cookie, redirects home', async () => {
		const user = await createUser({ email: 'jo@example.com', password: 'password123' });
		const { event, cookies } = loginEvent({ email: 'jo@example.com', password: 'password123' });

		await expect(actions.default(event)).rejects.toSatisfy(
			(e: unknown) => isRedirect(e) && e.status === 303 && e.location === '/'
		);
		const token = cookies.jar.get('session');
		expect(token).toBeTruthy();
		expect((await validateSession(token!))?.id).toBe(user.id);
	});

	it('is case/whitespace-insensitive on the email address', async () => {
		await createUser({ email: 'jo@example.com', password: 'password123' });
		const { event } = loginEvent({ email: '  Jo@Example.COM ', password: 'password123' });
		await expect(actions.default(event)).rejects.toSatisfy(isRedirect);
	});

	it('rejects a wrong password', async () => {
		await createUser({ email: 'jo@example.com', password: 'password123' });
		const { event, cookies } = loginEvent({ email: 'jo@example.com', password: 'wrong-password' });
		const result = await actions.default(event);
		expect(result).toMatchObject({ status: 400 });
		expect(cookies.jar.has('session')).toBe(false);
	});

	it('rejects an unknown email address with the same message as a bad password', async () => {
		const result = await actions.default(
			loginEvent({ email: 'nobody@example.com', password: 'password123' }).event
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('rejects an inactive user even with correct credentials', async () => {
		await createUser({ email: 'gone@example.com', password: 'password123', active: false });
		const result = await actions.default(
			loginEvent({ email: 'gone@example.com', password: 'password123' }).event
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('rejects empty submissions', async () => {
		const result = await actions.default(loginEvent({ email: '', password: '' }).event);
		expect(result).toMatchObject({ status: 400 });
	});
});
