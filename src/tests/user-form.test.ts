import { describe, expect, it } from 'vitest';
import { parseUserForm } from '$lib/server/user-form';

function form(fields: Record<string, string | string[]>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
	}
	return data;
}

const validFields = {
	name: 'Jo Bloggs',
	initials: 'jb',
	email: 'Jo.Bloggs@Example.com',
	role: 'viewer',
	category: 'anp',
	workingSlots: ['1:AM', '3:PM'],
	displayOrder: '20',
	onRota: 'on',
	active: 'on',
	password: 'password123'
};

describe('parseUserForm', () => {
	it('parses a valid form and normalises fields', () => {
		const result = parseUserForm(form(validFields));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.values).toMatchObject({
			name: 'Jo Bloggs',
			initials: 'JB', // uppercased
			email: 'jo.bloggs@example.com', // lowercased
			role: 'viewer',
			category: 'anp',
			workingSlots: ['1:AM', '3:PM'],
			displayOrder: 20,
			onRota: true,
			active: true
		});
	});

	it('drops invalid working slot values and keeps canonical order', () => {
		const result = parseUserForm(
			form({ ...validFields, workingSlots: ['5:PM', 'nonsense', '9:AM', '1:AM', '1:ZZ'] })
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.values.workingSlots).toEqual(['1:AM', '5:PM']);
	});

	it('allows an empty working slots selection', () => {
		const result = parseUserForm(form({ ...validFields, workingSlots: [] }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.values.workingSlots).toEqual([]);
	});

	it('treats unticked checkboxes as false', () => {
		const { onRota, active, ...rest } = validFields;
		const result = parseUserForm(form(rest));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.values.onRota).toBe(false);
		expect(result.values.active).toBe(false);
	});

	it('allows a blank password (edit form keeps the existing one)', () => {
		const result = parseUserForm(form({ ...validFields, password: '' }));
		expect(result.ok).toBe(true);
	});

	it.each([
		['missing name', { name: '' }],
		['missing initials', { initials: '' }],
		['overlong initials', { initials: 'ABCDEFGHI' }],
		['invalid email', { email: 'not-an-email' }],
		['unknown role', { role: 'superadmin' }],
		['unknown category', { category: 'nurse' }],
		['non-integer display order', { displayOrder: '1.5' }],
		['short password', { password: 'short' }]
	])('rejects %s', (_label, overrides) => {
		const result = parseUserForm(form({ ...validFields, ...overrides }));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toBeTruthy();
		// Submitted values come back so the form can be re-rendered filled in.
		expect(result.values.name).toBeDefined();
	});
});
