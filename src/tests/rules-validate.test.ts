import { describe, expect, it } from 'vitest';
import { validateWeek, slotHasErrors } from '$lib/rules/validate';
import { DEFAULT_RULE_SETTINGS, type StaffMember, type WeekGrid } from '$lib/rules/types';
import { decodeCell } from '$lib/constants';

const gp = (id: string, canWorkRatho = false): StaffMember => ({
	id,
	initials: id.toUpperCase(),
	category: 'doctor',
	canWorkRatho,
	standardSlots: {}
});
const trainee = (id: string): StaffMember => ({
	id,
	initials: id.toUpperCase(),
	category: 'gp_trainee',
	canWorkRatho: false,
	standardSlots: {}
});
const anp = (id: string): StaffMember => ({
	id,
	initials: id.toUpperCase(),
	category: 'anp',
	canWorkRatho: false,
	standardSlots: {}
});

/** Build a grid from encoded keys: { userId: { '1:AM': 'working:east_calder:duty' } } */
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

describe('R1 — duty doctor per practice', () => {
	it('flags a session with staff but no duty doctor', () => {
		const problems = validateWeek(
			[gp('a')],
			grid({ a: { '1:AM': 'working:east_calder' } }),
			settings()
		);
		expect(problems['1:AM'].map((p) => p.message)).toContain('East Calder: no duty doctor');
		expect(slotHasErrors(problems, '1:AM')).toBe(true);
	});

	it('passes with exactly one GP duty doctor at each practice', () => {
		const problems = validateWeek(
			[gp('a'), gp('b')],
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				b: { '1:AM': 'working:ratho:duty' }
			}),
			settings()
		);
		expect(problems['1:AM'] ?? []).toEqual([]);
	});

	it('flags two duty doctors at one practice', () => {
		const problems = validateWeek(
			[gp('a'), gp('b'), gp('c')],
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				b: { '1:AM': 'working:east_calder:duty' },
				c: { '1:AM': 'working:ratho:duty' }
			}),
			settings()
		);
		expect(problems['1:AM'].some((p) => p.message.includes('more than one duty doctor'))).toBe(true);
	});

	it('flags a trainee or ANP holding duty', () => {
		const problems = validateWeek(
			[trainee('t'), gp('b')],
			grid({
				t: { '1:AM': 'working:east_calder:duty' },
				b: { '1:AM': 'working:ratho:duty' }
			}),
			settings()
		);
		expect(problems['1:AM'].some((p) => p.message.includes('duty doctor must be a GP'))).toBe(true);
	});

	it('says nothing about sessions where nobody works anywhere', () => {
		// An entirely empty week is "no duty doctor" everywhere by the letter of
		// the rule — and that is what we report, since cover is required 8–6.
		const problems = validateWeek([gp('a')], grid({}), settings());
		expect(slotHasErrors(problems, '1:AM')).toBe(true);
	});
});

describe('R2 — minimum routine clinicians', () => {
	it('counts GPs/trainees on routine or duty, per practice', () => {
		const s = settings();
		s.minRoutineClinicians.east_calder = 3;
		const problems = validateWeek(
			[gp('a'), gp('b'), trainee('t'), anp('n'), gp('r')],
			grid({
				a: { '1:AM': 'working:east_calder:duty' }, // duty — counts too
				b: { '1:AM': 'working:east_calder' },
				t: { '1:AM': 'working:east_calder' },
				n: { '1:AM': 'working:east_calder:duty_team' }, // ANP — not a clinician
				r: { '1:AM': 'working:ratho:duty' }
			}),
			s
		);
		// a + b + t = 3 → satisfied.
		expect(problems['1:AM'] ?? []).toEqual([]);
	});

	it('a lone duty GP fulfils a minimum of 1 on their own', () => {
		const s = settings();
		s.minRoutineClinicians.ratho = 1;
		const problems = validateWeek(
			[gp('a'), gp('b')],
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				b: { '1:AM': 'working:ratho:duty' } // duty doubles as the routine GP
			}),
			s
		);
		expect(problems['1:AM'] ?? []).toEqual([]);
	});

	it('flags a shortfall — duty team and house visits do not count', () => {
		const s = settings();
		s.minRoutineClinicians.east_calder = 2;
		const problems = validateWeek(
			[gp('a'), gp('b'), gp('c')],
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				b: { '1:AM': 'working:east_calder:house_visits' },
				c: { '1:AM': 'working:east_calder:duty_team' }
			}),
			s
		);
		expect(
			problems['1:AM'].some(
				(p) => p.message === 'East Calder: 1 of 2 required routine GPs/trainees'
			)
		).toBe(true);
	});
});

describe('R3 — East Calder duty team', () => {
	it('errors below minimum, warns below desirable', () => {
		const s = settings();
		s.dutyTeamMin['1:AM'] = 1;
		s.dutyTeamDesired['1:AM'] = 2;
		const staff = [gp('a'), anp('n1'), anp('n2')];

		const below = validateWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				n1: { '1:AM': 'working:east_calder' }
			}),
			s
		);
		expect(below['1:AM'].some((p) => p.severity === 'error' && p.message.includes('duty team'))).toBe(
			true
		);

		const atMin = validateWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				n1: { '1:AM': 'working:east_calder:duty_team' }
			}),
			s
		);
		const teamProblems = atMin['1:AM'].filter((p) => p.message.includes('duty team'));
		expect(teamProblems).toHaveLength(1);
		expect(teamProblems[0].severity).toBe('warning'); // below desirable only
	});

	it('warns when an East Calder ANP is not marked as duty team', () => {
		const problems = validateWeek(
			[gp('a'), anp('n')],
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				n: { '1:AM': 'working:east_calder' }
			}),
			settings()
		);
		expect(
			problems['1:AM'].some(
				(p) => p.severity === 'warning' && p.message.includes('ANPs always join the duty team')
			)
		).toBe(true);
	});

	it('does not expect Ratho ANPs to be on the duty team', () => {
		const problems = validateWeek(
			[gp('a'), anp('n')],
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				n: { '1:AM': 'working:ratho' }
			}),
			settings()
		);
		expect(
			(problems['1:AM'] ?? []).some((p) => p.message.includes('always join the duty team'))
		).toBe(false);
	});
});

describe('R4/R5 — house visits and misplaced roles', () => {
	it('flags a house-visit shortfall and ANP allocations', () => {
		const s = settings();
		s.houseVisitsRequired['2:PM'] = 2;
		const problems = validateWeek(
			[gp('a'), anp('n')],
			grid({
				a: { '2:PM': 'working:east_calder:duty' },
				n: { '2:PM': 'working:east_calder:house_visits' }
			}),
			s
		);
		expect(
			problems['2:PM'].some((p) => p.message.includes('1 of 2 required house-visit'))
		).toBe(true);
		expect(
			problems['2:PM'].some((p) => p.message.includes('house visits are for GPs/trainees only'))
		).toBe(true);
	});

	it('flags duty team or house visits at Ratho', () => {
		const problems = validateWeek(
			[gp('a'), anp('n')],
			grid({
				a: { '1:AM': 'working:ratho:duty' },
				n: { '1:AM': 'working:ratho:duty_team' }
			}),
			settings()
		);
		expect(
			problems['1:AM'].some((p) => p.message.includes('only exist at East Calder'))
		).toBe(true);
	});

	it('sick staff are not counted as working', () => {
		const s = settings();
		s.minRoutineClinicians.east_calder = 2;
		const problems = validateWeek(
			[gp('a'), gp('b')],
			grid({
				a: { '1:AM': 'working:east_calder:duty' }, // counts (duty)
				b: { '1:AM': 'sick' } // does not
			}),
			s
		);
		expect(
			problems['1:AM'].some((p) => p.message.includes('1 of 2 required routine'))
		).toBe(true);
	});
});
