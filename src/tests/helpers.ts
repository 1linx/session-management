import { db } from '$lib/server/db';
import { authSessions, scheduleEntries, users } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth';
import { currentWeekStart } from '$lib/dates';
import { ALL_SLOTS } from '$lib/constants';
import { isRedirect, type Cookies } from '@sveltejs/kit';
import { vi } from 'vitest';

/** Await an action expected to succeed by throwing a redirect. */
export async function swallowRedirect(action: unknown): Promise<void> {
	try {
		await action;
	} catch (e) {
		if (!isRedirect(e)) throw e;
	}
}

/** Wipe all tables between tests. */
export async function resetDb(): Promise<void> {
	await db.delete(scheduleEntries);
	await db.delete(authSessions);
	await db.delete(users);
}

let userCounter = 0;

type UserOverrides = Partial<typeof users.$inferInsert> & { password?: string };

/** Insert a user with sensible defaults and return the row. */
export async function createUser(overrides: UserOverrides = {}) {
	const { password, ...rest } = overrides;
	userCounter += 1;
	const [row] = await db
		.insert(users)
		.values({
			passwordHash: hashPassword(password ?? 'password123'),
			name: `User ${userCounter}`,
			initials: `U${userCounter}`,
			role: 'viewer',
			category: 'doctor',
			// Standard availability: every slot at East Calder by default.
			standardSlots: JSON.stringify(
				Object.fromEntries(ALL_SLOTS.map((slot) => [slot, 'east_calder']))
			),
			displayOrder: userCounter * 10,
			...rest
		})
		.returning();
	return row;
}

/** JSON standardSlots value: the given slots at a practice. */
export function slotsAt(slots: string[], practice = 'east_calder'): string {
	return JSON.stringify(Object.fromEntries(slots.map((slot) => [slot, practice])));
}

/**
 * Insert a schedule entry and return the row.
 * Defaults to a plain working session at the default location, in the
 * current week.
 */
export async function createEntry(
	userId: string,
	weekday: number,
	period: string,
	cell: { status?: string; location?: string | null; role?: string | null; weekStart?: string } = {}
) {
	const status = cell.status ?? 'working';
	const [row] = await db
		.insert(scheduleEntries)
		.values({
			userId,
			weekStart: cell.weekStart ?? currentWeekStart(),
			weekday,
			period,
			status,
			location: cell.location !== undefined ? cell.location : status === 'working' ? 'east_calder' : null,
			role: cell.role ?? null
		})
		.returning();
	return row;
}

/**
 * Build a POST Request whose formData() yields the given fields.
 * Array values become repeated fields (checkbox groups).
 */
export function formRequest(fields: Record<string, string | string[]>): Request {
	const body = new URLSearchParams();
	for (const [key, value] of Object.entries(fields)) {
		for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
	}
	return new Request('http://localhost/', { method: 'POST', body });
}

/** Minimal Cookies double recording set/delete calls. */
export function fakeCookies(): Cookies & { jar: Map<string, string> } {
	const jar = new Map<string, string>();
	return {
		jar,
		get: vi.fn((name: string) => jar.get(name)),
		getAll: vi.fn(() => [...jar.entries()].map(([name, value]) => ({ name, value }))),
		set: vi.fn((name: string, value: string) => void jar.set(name, value)),
		delete: vi.fn((name: string) => void jar.delete(name)),
		serialize: vi.fn(() => '')
	} as unknown as Cookies & { jar: Map<string, string> };
}

export const adminLocals = (id: string) => ({
	user: { id, name: 'Admin', initials: 'ADM', role: 'admin' }
});

export const viewerLocals = (id: string) => ({
	user: { id, name: 'Viewer', initials: 'VW', role: 'viewer' }
});
