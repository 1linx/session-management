import { describe, expect, it } from 'vitest';
import { autoFixWeek } from '$lib/rules/autofix';
import { validateWeek, slotHasErrors } from '$lib/rules/validate';
import { DEFAULT_RULE_SETTINGS, type StaffMember, type WeekGrid } from '$lib/rules/types';
import { decodeCell, encodeCell } from '$lib/constants';

const gp = (id: string, canWorkRatho = false): StaffMember => ({
	id,
	initials: id.toUpperCase(),
	category: 'doctor',
	canWorkRatho
});
const anp = (id: string): StaffMember => ({
	id,
	initials: id.toUpperCase(),
	category: 'anp',
	canWorkRatho: false
});

function grid(cells: Record<string, Record<string, string>>): WeekGrid {
	const out: WeekGrid = {};
	for (const [userId, slots] of Object.entries(cells)) {
		out[userId] = {};
		for (const [slot, key] of Object.entries(slots)) {
			out[userId][slot] = decodeCell(key)!;
		}
	}
	return out;
}

const settings = () => structuredClone(DEFAULT_RULE_SETTINGS);
const keyAt = (g: WeekGrid, userId: string, slot: string) => encodeCell(g[userId][slot]);

describe('autoFixWeek', () => {
	it('promotes a routine GP to duty doctor', () => {
		const staff = [gp('a')];
		const { grid: fixed, changes } = autoFixWeek(
			staff,
			grid({ a: { '1:AM': 'working:east_calder' } }),
			settings()
		);
		expect(keyAt(fixed, 'a', '1:AM')).toBe('working:east_calder:duty');
		expect(changes).toHaveLength(1);
		expect(changes[0].reason).toContain('duty doctor');
	});

	it('never touches not-working or sick cells', () => {
		const staff = [gp('a'), gp('b')];
		const before = grid({
			a: { '1:AM': 'sick' },
			b: { '1:AM': 'not_working' }
		});
		const { grid: fixed, changes } = autoFixWeek(staff, before, settings());
		expect(changes).toEqual([]);
		expect(keyAt(fixed, 'a', '1:AM')).toBe('sick');
		expect(keyAt(fixed, 'b', '1:AM')).toBe('not_working');
	});

	it('spreads duty proportionately to sessions worked', () => {
		// a works 4 sessions and already has duty twice; b works 4 and has none.
		const staff = [gp('a'), gp('b')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: {
					'1:AM': 'working:east_calder:duty',
					'2:AM': 'working:east_calder:duty',
					'3:AM': 'working:east_calder',
					'4:AM': 'working:east_calder'
				},
				b: {
					'1:AM': 'working:east_calder',
					'2:AM': 'working:east_calder',
					'3:AM': 'working:east_calder',
					'4:AM': 'working:east_calder'
				}
			}),
			settings()
		);
		// The two open duty slots (3:AM, 4:AM) should both go to b.
		expect(keyAt(fixed, 'b', '3:AM')).toBe('working:east_calder:duty');
		expect(keyAt(fixed, 'b', '4:AM')).toBe('working:east_calder:duty');
	});

	it('demotes duplicate duty doctors down to one', () => {
		const staff = [gp('a'), gp('b')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				b: { '1:AM': 'working:east_calder:duty' }
			}),
			settings()
		);
		const duties = ['a', 'b'].filter((u) => fixed[u]['1:AM'].role === 'duty');
		expect(duties).toHaveLength(1);
	});

	it('relocates a willing EC GP to Ratho when Ratho has no GP', () => {
		const staff = [gp('a'), gp('b', true), anp('n')];
		const { grid: fixed, changes } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' },
				n: { '1:AM': 'working:ratho' } // Ratho staffed, but no GP
			}),
			settings()
		);
		expect(keyAt(fixed, 'b', '1:AM')).toBe('working:ratho:duty');
		expect(changes.some((c) => c.reason.includes('sent to Ratho'))).toBe(true);
		// And EC still got its own duty doctor.
		expect(keyAt(fixed, 'a', '1:AM')).toBe('working:east_calder:duty');
	});

	it('does not relocate a GP without the canWorkRatho flag', () => {
		const staff = [gp('a'), gp('b', false), anp('n')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' },
				n: { '1:AM': 'working:ratho' }
			}),
			settings()
		);
		expect(fixed['b']['1:AM'].location).toBe('east_calder');
		// Ratho stays unfixed and validation still reports it.
		const problems = validateWeek(staff, fixed, settings());
		expect(slotHasErrors(problems, '1:AM')).toBe(true);
	});

	it('fills the duty team with ANPs before GPs', () => {
		const s = settings();
		s.dutyTeamMin['1:AM'] = 2;
		const staff = [gp('a'), gp('b'), anp('n')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' },
				n: { '1:AM': 'working:east_calder' }
			}),
			s
		);
		expect(fixed['n']['1:AM'].role).toBe('duty_team'); // ANP first
		// One GP takes duty, the other joins the team to reach 2.
		const teamGps = ['a', 'b'].filter((u) => fixed[u]['1:AM'].role === 'duty_team');
		expect(teamGps).toHaveLength(1);
	});

	it('respects the routine minimum when allocating house visits', () => {
		const s = settings();
		s.minRoutineClinicians.east_calder = 1;
		s.houseVisitsRequired['1:AM'] = 2;
		const staff = [gp('a'), gp('b'), gp('c')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' },
				c: { '1:AM': 'working:east_calder' }
			}),
			s
		);
		// One duty, and visits can only take one before the routine minimum bites.
		const roles = ['a', 'b', 'c'].map((u) => fixed[u]['1:AM'].role).sort();
		expect(roles).toEqual(['duty', 'house_visits', null].sort());
	});

	it('clears invalid roles before filling', () => {
		const staff = [anp('n'), gp('a')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				n: { '1:AM': 'working:east_calder:duty' }, // ANP can't hold duty
				a: { '1:AM': 'working:east_calder' }
			}),
			settings()
		);
		expect(fixed['n']['1:AM'].role).toBeNull();
		expect(fixed['a']['1:AM'].role).toBe('duty');
	});

	it('after a full run, remaining problems are only the unfixable ones', () => {
		const s = settings();
		s.dutyTeamMin['1:AM'] = 1;
		const staff = [gp('a'), anp('n')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				n: { '1:AM': 'working:east_calder' }
			}),
			s
		);
		const problems = validateWeek(staff, fixed, s);
		// EC is fully fixed; only Ratho (nobody there at all) remains.
		expect((problems['1:AM'] ?? []).every((p) => p.message.startsWith('Ratho'))).toBe(true);
	});
});
