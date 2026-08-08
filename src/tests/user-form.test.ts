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
	'slot:1:AM': 'east_calder',
	'slot:3:PM': 'ratho',
	canWorkRatho: 'on',
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
			standardSlots: { '1:AM': 'east_calder', '3:PM': 'ratho' },
			canWorkRatho: true,
			displayOrder: 20,
			onRota: true,
			active: true
		});
	});

	it('ignores unknown practice values and unticked slots', () => {
		const result = parseUserForm(
			form({ ...validFields, 'slot:1:AM': 'mars', 'slot:2:AM': 'none' })
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.values.standardSlots).toEqual({ '3:PM': 'ratho' });
	});

	it('allows an empty availability', () => {
		const { 'slot:1:AM': _a, 'slot:3:PM': _b, ...rest } = validFields;
		const result = parseUserForm(form(rest));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.values.standardSlots).toEqual({});
	});

	it('treats unticked checkboxes as false', () => {
		const { onRota, active, canWorkRatho, ...rest } = validFields;
		const result = parseUserForm(form(rest));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.values.onRota).toBe(false);
		expect(result.values.active).toBe(false);
		expect(result.values.canWorkRatho).toBe(false);
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
