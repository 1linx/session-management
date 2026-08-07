import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { authSessions } from '$lib/server/db/schema';
import {
	createSession,
	destroySession,
	hashPassword,
	validateSession,
	verifyPassword
} from '$lib/server/auth';
import { createUser, resetDb } from './helpers';

describe('passwords', () => {
	it('verifies a correct password', () => {
		const hash = hashPassword('correct horse battery staple');
		expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
	});

	it('rejects a wrong password', () => {
		const hash = hashPassword('correct horse battery staple');
		expect(verifyPassword('Tr0ub4dor&3', hash)).toBe(false);
	});

	it('salts hashes (same password, different hash)', () => {
		expect(hashPassword('same')).not.toBe(hashPassword('same'));
	});

	it('rejects malformed stored hashes instead of throwing', () => {
		expect(verifyPassword('anything', 'not-a-hash')).toBe(false);
		expect(verifyPassword('anything', '')).toBe(false);
		expect(verifyPassword('anything', 'md5:abc:def')).toBe(false);
	});

	it('stores no plaintext in the hash', () => {
		expect(hashPassword('sup3rsecret')).not.toContain('sup3rsecret');
	});
});

describe('sessions', () => {
	beforeEach(resetDb);

	it('creates a session validating back to the user', async () => {
		const user = await createUser();
		const { token } = await createSession(user.id);
		const sessionUser = await validateSession(token);
		expect(sessionUser).toMatchObject({ id: user.id, email: user.email, role: 'viewer' });
	});

	it('stores only a hash of the token', async () => {
		const user = await createUser();
		const { token } = await createSession(user.id);
		const rows = await db.select().from(authSessions);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).not.toBe(token);
	});

	it('rejects an unknown token', async () => {
		expect(await validateSession('no-such-token')).toBeNull();
	});

	it('rejects and deletes an expired session', async () => {
		const user = await createUser();
		const { token } = await createSession(user.id);
		// Force the session into the past.
		await db.update(authSessions).set({ expiresAt: new Date(Date.now() - 1000) });
		expect(await validateSession(token)).toBeNull();
		expect(await db.select().from(authSessions)).toHaveLength(0);
	});

	it('extends a session past its half-life (sliding expiry)', async () => {
		const user = await createUser();
		const { token, expiresAt } = await createSession(user.id);
		const nearExpiry = new Date(Date.now() + 1000 * 60 * 60 * 24); // 1 day left
		await db.update(authSessions).set({ expiresAt: nearExpiry });
		await validateSession(token);
		const [row] = await db.select().from(authSessions);
		expect(row.expiresAt.getTime()).toBeGreaterThan(nearExpiry.getTime());
		expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(expiresAt.getTime() - 1000);
	});

	it('destroySession invalidates the token', async () => {
		const user = await createUser();
		const { token } = await createSession(user.id);
		await destroySession(token);
		expect(await validateSession(token)).toBeNull();
	});

	it('sessions are per-user', async () => {
		const a = await createUser();
		const b = await createUser();
		const { token: tokenA } = await createSession(a.id);
		const { token: tokenB } = await createSession(b.id);
		expect((await validateSession(tokenA))?.id).toBe(a.id);
		expect((await validateSession(tokenB))?.id).toBe(b.id);
		await db.delete(authSessions).where(eq(authSessions.userId, a.id));
		expect(await validateSession(tokenA)).toBeNull();
		expect((await validateSession(tokenB))?.id).toBe(b.id);
	});
});
