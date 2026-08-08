import { beforeEach, describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import { createSession, validateSession, verifyPassword } from '$lib/server/auth';
import { actions as newActions } from '../routes/users/new/+page.server';
import { actions as editActions } from '../routes/users/[id]/+page.server';
import {
	adminLocals,
	createEntry,
	createUser,
	formRequest,
	resetDb,
	slotsAt,
	swallowRedirect
} from './helpers';

type NewEvent = Parameters<(typeof newActions)['default']>[0];
type EditEvent = Parameters<(typeof editActions)["save"]>[0];

const baseFields = {
	name: 'New Person',
	initials: 'NP',
	email: 'np@example.com',
	role: 'viewer',
	category: 'anp',
	'slot:1:AM': 'east_calder',
	'slot:1:PM': 'east_calder',
	'slot:2:AM': 'ratho',
	canWorkRatho: 'on',
	displayOrder: '40',
	onRota: 'on',
	active: 'on'
};

function newEvent(fields: Record<string, string | string[]>) {
	return { request: formRequest(fields) } as unknown as NewEvent;
}

function editEvent(id: string, fields: Record<string, string | string[]>, locals: object) {
	return { request: formRequest(fields), params: { id }, locals } as unknown as EditEvent;
}

async function getUser(email: string) {
	const [row] = await db.select().from(users).where(eq(users.email, email));
	return row;
}

describe('create user action', () => {
	beforeEach(resetDb);

	it('creates a user with a verifiable password hash and redirects', async () => {
		await expect(
			newActions.default(newEvent({ ...baseFields, password: 'password123' }))
		).rejects.toSatisfy((e: unknown) => isRedirect(e) && e.location === '/users');

		const row = await getUser('np@example.com');
		expect(row).toMatchObject({
			name: 'New Person',
			initials: 'NP',
			role: 'viewer',
			category: 'anp',
			displayOrder: 40,
			onRota: true,
			active: true
		});
		expect(JSON.parse(row.standardSlots)).toEqual({
			'1:AM': 'east_calder',
			'1:PM': 'east_calder',
			'2:AM': 'ratho'
		});
		expect(row.canWorkRatho).toBe(true);
		expect(verifyPassword('password123', row.passwordHash)).toBe(true);
	});

	it('requires a password', async () => {
		const result = await newActions.default(newEvent({ ...baseFields, password: '' }));
		expect(result).toMatchObject({ status: 400 });
		expect(await getUser('np@example.com')).toBeUndefined();
	});

	it('rejects a duplicate email address', async () => {
		await createUser({ email: 'np@example.com' });
		const result = await newActions.default(
			newEvent({ ...baseFields, password: 'password123' })
		);
		expect(result).toMatchObject({ status: 400 });
	});

	it('returns validation failures with the submitted values', async () => {
		const result = await newActions.default(
			newEvent({ ...baseFields, email: 'not-an-email', password: 'password123' })
		);
		expect(result).toMatchObject({ status: 400, data: { values: { name: 'New Person' } } });
	});
});

describe('edit user action', () => {
	beforeEach(resetDb);

	it('updates fields and redirects', async () => {
		const admin = await createUser({ role: 'admin' });
		const target = await createUser({ email: 'np@example.com' });

		await expect(
			editActions.save(
				editEvent(target.id, { ...baseFields, name: 'Renamed', password: '' }, adminLocals(admin.id))
			)
		).rejects.toSatisfy(isRedirect);

		const row = await getUser('np@example.com');
		expect(row.name).toBe('Renamed');
	});

	it('keeps the password when the field is blank, replaces it when set', async () => {
		const admin = await createUser({ role: 'admin' });
		const target = await createUser({ email: 'np@example.com', password: 'original-pass' });

		await swallowRedirect(
			editActions.save(editEvent(target.id, { ...baseFields, password: '' }, adminLocals(admin.id)))
		);
		expect(verifyPassword('original-pass', (await getUser('np@example.com')).passwordHash)).toBe(true);

		await swallowRedirect(
			editActions.save(
				editEvent(target.id, { ...baseFields, password: 'new-password' }, adminLocals(admin.id))
			)
		);
		const row = await getUser('np@example.com');
		expect(verifyPassword('new-password', row.passwordHash)).toBe(true);
		expect(verifyPassword('original-pass', row.passwordHash)).toBe(false);
	});

	it('keeps existing schedule entries when standard availability changes', async () => {
		const admin = await createUser({ role: 'admin' });
		const target = await createUser({ email: 'np@example.com', standardSlots: slotsAt(['1:AM', '1:PM']) });
		await createEntry(target.id, 1, 'AM');
		await createEntry(target.id, 1, 'PM');

		// Availability is only a default for new weeks — shrinking it must not
		// delete anything already rostered.
		const { 'slot:1:AM': _a, 'slot:1:PM': _b, 'slot:2:AM': _c, ...noSlots } = baseFields;
		await swallowRedirect(
			editActions.save(editEvent(target.id, { ...noSlots, password: '' }, adminLocals(admin.id)))
		);

		expect(
			await db.select().from(scheduleEntries).where(eq(scheduleEntries.userId, target.id))
		).toHaveLength(2);
	});

	it('blocks removing your own admin role', async () => {
		const admin = await createUser({ role: 'admin', email: 'np@example.com' });

		const result = await editActions.save(
			editEvent(admin.id, { ...baseFields, role: 'viewer', password: '' }, adminLocals(admin.id))
		);
		expect(result).toMatchObject({ status: 400 });
		expect((await getUser('np@example.com')).role).toBe('admin');
	});

	it('blocks deactivating your own account', async () => {
		const admin = await createUser({ role: 'admin', email: 'np@example.com' });
		const { active: _active, ...fieldsWithoutActive } = baseFields;

		const result = await editActions.save(
			editEvent(admin.id, { ...fieldsWithoutActive, role: 'admin', password: '' }, adminLocals(admin.id))
		);
		expect(result).toMatchObject({ status: 400 });
		expect((await getUser('np@example.com')).active).toBe(true);
	});

	it('allows demoting a different admin', async () => {
		const admin = await createUser({ role: 'admin' });
		const other = await createUser({ role: 'admin', email: 'np@example.com' });

		await swallowRedirect(
			editActions.save(
				editEvent(other.id, { ...baseFields, role: 'viewer', password: '' }, adminLocals(admin.id))
			)
		);
		expect((await getUser('np@example.com')).role).toBe('viewer');
	});

	it('404s for an unknown user id', async () => {
		const admin = await createUser({ role: 'admin' });
		await expect(
			editActions.save(
				editEvent('no-such-id', { ...baseFields, password: '' }, adminLocals(admin.id))
			)
		).rejects.toMatchObject({ status: 404 });
	});
});

describe('delete user action', () => {
	beforeEach(resetDb);

	const deleteEvent = (id: string, locals: object) =>
		({ request: formRequest({}), params: { id }, locals }) as unknown as Parameters<
			(typeof editActions)['delete']
		>[0];

	it('removes the user, their entries and their sessions, then redirects', async () => {
		const admin = await createUser({ role: 'admin' });
		const target = await createUser({ email: 'np@example.com' });
		await createEntry(target.id, 1, 'AM');
		await createEntry(target.id, 2, 'PM', { status: 'sick', location: null });
		const { token } = await createSession(target.id);

		await expect(
			editActions.delete(deleteEvent(target.id, adminLocals(admin.id)))
		).rejects.toSatisfy((e: unknown) => isRedirect(e) && e.location === '/users');

		expect(await getUser('np@example.com')).toBeUndefined();
		expect(
			await db.select().from(scheduleEntries).where(eq(scheduleEntries.userId, target.id))
		).toHaveLength(0);
		expect(await validateSession(token)).toBeNull();
	});

	it('blocks deleting your own account', async () => {
		const admin = await createUser({ role: 'admin', email: 'np@example.com' });
		const result = await editActions.delete(deleteEvent(admin.id, adminLocals(admin.id)));
		expect(result).toMatchObject({ status: 400 });
		expect(await getUser('np@example.com')).toBeDefined();
	});

	it('404s for an unknown user id', async () => {
		const admin = await createUser({ role: 'admin' });
		await expect(
			editActions.delete(deleteEvent('no-such-id', adminLocals(admin.id)))
		).rejects.toMatchObject({ status: 404 });
	});
});
