import { afterEach, describe, expect, it } from 'vitest';
import { CELL_OPTIONS, cellLabel, locationLabel, locationShort } from '$lib/constants';
import { validateWeek } from '$lib/rules/validate';
import { autoFixWeek } from '$lib/rules/autofix';
import { DEFAULT_RULE_SETTINGS, type StaffMember } from '$lib/rules/types';

// The env stub is process.env, so a test can stand in for a deployment's
// .env (e.g. the anonymised demo's .env.demo).
const KEYS = [
	'PUBLIC_MAIN_PRACTICE_NAME',
	'PUBLIC_MAIN_PRACTICE_SHORT',
	'PUBLIC_BRANCH_PRACTICE_NAME',
	'PUBLIC_BRANCH_PRACTICE_SHORT'
] as const;

function useDemoNames() {
	process.env.PUBLIC_MAIN_PRACTICE_NAME = 'Riverside';
	process.env.PUBLIC_MAIN_PRACTICE_SHORT = 'RS';
	process.env.PUBLIC_BRANCH_PRACTICE_NAME = 'Hillcrest';
	process.env.PUBLIC_BRANCH_PRACTICE_SHORT = 'HC';
}

const anp: StaffMember = {
	id: 'n',
	initials: 'N',
	category: 'anp',
	canWorkRatho: false,
	dutyExempt: { AM: false, PM: false },
	standardSlots: {},
	standardDuty: []
};

describe('practice display names', () => {
	afterEach(() => {
		for (const key of KEYS) delete process.env[key];
	});

	it('default to the real practices', () => {
		expect(locationLabel('east_calder')).toBe('East Calder');
		expect(locationShort('ratho')).toBe('R');
	});

	it('can be overridden per deployment without touching stored values', () => {
		useDemoNames();
		expect(locationLabel('east_calder')).toBe('Riverside');
		expect(locationShort('ratho')).toBe('HC');
		expect(cellLabel({ status: 'working', location: 'ratho', role: null })).toBe(
			'Working (Hillcrest)'
		);
		const option = CELL_OPTIONS.find((o) => o.key === 'working:ratho:duty')!;
		expect(option.group).toBe('Hillcrest');
		expect(option.key).toBe('working:ratho:duty');
	});

	it('flow through rule messages and Auto-fix reasons', () => {
		useDemoNames();
		const grid = { n: { '1:AM': decode() } };
		const messages = Object.values(validateWeek([anp], grid, DEFAULT_RULE_SETTINGS))
			.flat()
			.map((p) => p.message)
			.join('\n');
		expect(messages).toContain('Riverside: ANPs always join the duty team');
		expect(messages).not.toMatch(/East Calder|Ratho/);

		const { changes } = autoFixWeek([anp], grid, DEFAULT_RULE_SETTINGS);
		expect(changes[0].reason).toBe('ANPs at Riverside are always on the duty team');
	});
});

function decode() {
	return { status: 'working' as const, location: 'east_calder' as const, role: null };
}
