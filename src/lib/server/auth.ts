import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { authSessions, users } from '$lib/server/db/schema';
import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'session';
const SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_RENEW_MS = 1000 * 60 * 60 * 24 * 15; // renew when < 15 days left

// --- Passwords (scrypt via node:crypto — no native dependencies) ---

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(password.normalize('NFKC'), salt, 64);
	return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [scheme, saltHex, hashHex] = stored.split(':');
	if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
	const expected = Buffer.from(hashHex, 'hex');
	const actual = scryptSync(password.normalize('NFKC'), Buffer.from(saltHex, 'hex'), expected.length);
	return timingSafeEqual(actual, expected);
}

// --- Sessions (random bearer token in cookie; SHA-256 hash stored in DB) ---

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
	await db.insert(authSessions).values({ id: hashToken(token), userId, expiresAt });
	return { token, expiresAt };
}

export type SessionUser = {
	id: string;
	email: string;
	name: string;
	initials: string;
	role: string;
};

export async function validateSession(token: string): Promise<SessionUser | null> {
	const id = hashToken(token);
	const rows = await db
		.select({
			session: authSessions,
			user: {
				id: users.id,
				email: users.email,
				name: users.name,
				initials: users.initials,
				role: users.role
			}
		})
		.from(authSessions)
		.innerJoin(users, eq(authSessions.userId, users.id))
		.where(eq(authSessions.id, id));
	const row = rows[0];
	if (!row) return null;
	if (row.session.expiresAt.getTime() < Date.now()) {
		await db.delete(authSessions).where(eq(authSessions.id, id));
		return null;
	}
	// Sliding expiry: extend the session when it is past half-life.
	if (row.session.expiresAt.getTime() - Date.now() < SESSION_RENEW_MS) {
		await db
			.update(authSessions)
			.set({ expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) })
			.where(eq(authSessions.id, id));
	}
	return row.user;
}

export async function destroySession(token: string): Promise<void> {
	await db.delete(authSessions).where(eq(authSessions.id, hashToken(token)));
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: process.env.NODE_ENV === 'production',
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}
