import { describe, expect, it } from 'vitest';
import { autoFixWeek } from '$lib/rules/autofix';
import { validateWeek, slotHasErrors } from '$lib/rules/validate';
import { DEFAULT_RULE_SETTINGS, type StaffMember, type WeekGrid } from '$lib/rules/types';
import { decodeCell, encodeCell } from '$lib/constants';

const gp = (
	id: string,
	canWorkRatho = false,
	dutyExempt: StaffMember['dutyExempt'] = { AM: false, PM: false }
): StaffMember => ({
	id,
	initials: id.toUpperCase(),
	category: 'doctor',
	canWorkRatho,
	dutyExempt,
	standardSlots: {}
});
const anp = (
	id: string,
	standardSlots: StaffMember['standardSlots'] = {},
	dutyExempt: StaffMember['dutyExempt'] = { AM: false, PM: false }
): StaffMember => ({
	id,
	initials: id.toUpperCase(),
	category: 'anp',
	canWorkRatho: false,
	dutyExempt,
	standardSlots
});
const trainee = (id: string): StaffMember => ({
	id,
	initials: id.toUpperCase(),
	category: 'gp_trainee',
	canWorkRatho: false,
	dutyExempt: { AM: false, PM: false },
	standardSlots: {}
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

	it('never touches unavailable cells (not working, sick, leave, activities)', () => {
		const staff = [gp('a'), gp('b'), gp('c'), gp('d')];
		const before = grid({
			a: { '1:AM': 'sick' },
			b: { '1:AM': 'not_working' },
			c: { '1:AM': 'annual_leave' },
			d: { '1:AM': 'minor_surgery' }
		});
		const { grid: fixed, changes } = autoFixWeek(staff, before, settings());
		expect(changes).toEqual([]);
		expect(keyAt(fixed, 'a', '1:AM')).toBe('sick');
		expect(keyAt(fixed, 'b', '1:AM')).toBe('not_working');
		expect(keyAt(fixed, 'c', '1:AM')).toBe('annual_leave');
		expect(keyAt(fixed, 'd', '1:AM')).toBe('minor_surgery');
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

	it('never assigns duty to a GP excluded from that period', () => {
		// a would win on fairness, but is excluded from PM duty.
		const staff = [gp('a', false, { AM: false, PM: true }), gp('b')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:PM': 'working:east_calder' },
				b: { '1:PM': 'working:east_calder', '2:PM': 'working:east_calder:duty' }
			}),
			settings()
		);
		expect(fixed['a']['1:PM'].role).toBeNull();
		expect(fixed['b']['1:PM'].role).toBe('duty');
	});

	it('strips duty from an excluded GP and reassigns it', () => {
		const staff = [gp('a', false, { AM: true, PM: false }), gp('b')];
		const { grid: fixed, changes } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder:duty' },
				b: { '1:AM': 'working:east_calder' }
			}),
			settings()
		);
		expect(fixed['a']['1:AM'].role).toBeNull();
		expect(fixed['b']['1:AM'].role).toBe('duty');
		expect(changes.some((c) => c.reason.includes('excluded from AM duty'))).toBe(true);
	});

	it('does not relocate an excluded GP to Ratho for duty', () => {
		const staff = [gp('a'), gp('b', true, { AM: false, PM: true }), anp('n')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:PM': 'working:east_calder' },
				b: { '1:PM': 'working:east_calder' }, // can travel, but no PM duty
				n: { '1:PM': 'working:ratho' }
			}),
			settings()
		);
		expect(fixed['b']['1:PM'].location).toBe('east_calder');
	});

	it('gives duty to the GP with the lowest historical duty tally', () => {
		// Without history, a (first in staff order) would be picked.
		const staff = [gp('a'), gp('b')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' }
			}),
			settings(),
			{ tallies: { a: { worked: 8, duty: 2 }, b: { worked: 8, duty: 0 } } }
		);
		expect(fixed['b']['1:AM'].role).toBe('duty');
		expect(fixed['a']['1:AM'].role).toBeNull();
	});

	it('duty-team sessions this week count towards the tally like duty', () => {
		// a is on the duty team twice, so despite equal history b (no duty
		// commitments) is further behind and takes Monday PM duty.
		const staff = [gp('a'), gp('b')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: {
					'1:AM': 'working:east_calder:duty_team',
					'2:AM': 'working:east_calder:duty_team',
					'1:PM': 'working:east_calder'
				},
				b: { '1:PM': 'working:east_calder' }
			}),
			settings()
		);
		expect(fixed['b']['1:PM'].role).toBe('duty');
		expect(fixed['a']['1:PM'].role).toBeNull();
	});

	it('avoids giving the same doctor AM and PM duty on one day, even against the tally', () => {
		// a is well behind on the tally so takes Monday AM; Monday PM then
		// goes to b rather than doubling a up on the same day.
		const staff = [gp('a'), gp('b')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder', '1:PM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder', '1:PM': 'working:east_calder' }
			}),
			settings(),
			{ tallies: { a: { worked: 10, duty: 0 }, b: { worked: 10, duty: 3 } } }
		);
		expect(fixed['a']['1:AM'].role).toBe('duty');
		expect(fixed['b']['1:PM'].role).toBe('duty');
		expect(fixed['a']['1:PM'].role).toBeNull();
	});

	it('assigns consecutive duty when there is no other candidate', () => {
		const staff = [gp('a')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({ a: { '1:AM': 'working:east_calder', '1:PM': 'working:east_calder' } }),
			settings()
		);
		expect(fixed['a']['1:AM'].role).toBe('duty');
		expect(fixed['a']['1:PM'].role).toBe('duty');
	});

	it('avoids repeating last week’s duty slot when tallies are level', () => {
		const staff = [gp('a'), gp('b')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' }
			}),
			settings(),
			{ previousDuty: { a: ['1:AM'] } } // a held Monday AM duty last week
		);
		expect(fixed['b']['1:AM'].role).toBe('duty');
	});

	it('a clearly lower tally beats the rotation preference', () => {
		const staff = [gp('a'), gp('b')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' }
			}),
			settings(),
			{
				tallies: { a: { worked: 10, duty: 0 }, b: { worked: 10, duty: 5 } },
				previousDuty: { a: ['1:AM'] } // a repeats the slot, but is far behind on duty
			}
		);
		expect(fixed['a']['1:AM'].role).toBe('duty');
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

	it('always puts an East Calder ANP on the duty team, even with no minimum set', () => {
		const staff = [gp('a'), anp('n')];
		const { grid: fixed, changes } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				n: { '1:AM': 'working:east_calder' }
			}),
			settings() // no dutyTeamMin configured
		);
		expect(keyAt(fixed, 'n', '1:AM')).toBe('working:east_calder:duty_team');
		expect(changes.some((c) => c.reason.includes('always on the duty team'))).toBe(true);
	});

	it('leaves Ratho ANPs alone — the duty team is an East Calder concept', () => {
		const staff = [gp('a'), anp('n')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:ratho' },
				n: { '1:AM': 'working:ratho' }
			}),
			settings()
		);
		expect(keyAt(fixed, 'n', '1:AM')).toBe('working:ratho');
	});

	it('brings an available ANP in from "Not working" onto the duty team', () => {
		const staff = [gp('a'), anp('n', { '1:AM': 'east_calder' })];
		const { grid: fixed, changes } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' }
				// n has no cell at all — blank "Not working"
			}),
			settings()
		);
		expect(keyAt(fixed, 'n', '1:AM')).toBe('working:east_calder:duty_team');
		expect(changes.some((c) => c.reason.includes('available ANP brought in'))).toBe(true);
	});

	it('does not bring in an ANP outside their standard availability', () => {
		// Standard slot at Ratho, or no standard slot: both stay untouched.
		const staff = [gp('a'), anp('n', { '1:AM': 'ratho' }), anp('m')];
		const { grid: fixed, changes } = autoFixWeek(
			staff,
			grid({ a: { '1:AM': 'working:east_calder' } }),
			settings()
		);
		// Neither ANP is touched — their blank cells stay blank.
		expect(changes.filter((c) => c.userId !== 'a')).toEqual([]);
		expect(fixed['n']).toBeUndefined();
		expect(fixed['m']).toBeUndefined();
	});

	it('never brings an ANP in over an absence (sick, leave, activities)', () => {
		const slots = { '1:AM': 'east_calder', '1:PM': 'east_calder', '2:AM': 'east_calder' } as const;
		const staff = [anp('n', slots)];
		const { grid: fixed, changes } = autoFixWeek(
			staff,
			grid({
				n: { '1:AM': 'sick', '1:PM': 'annual_leave', '2:AM': 'admin_work' }
			}),
			settings()
		);
		expect(changes).toEqual([]);
		expect(keyAt(fixed, 'n', '1:AM')).toBe('sick');
		expect(keyAt(fixed, 'n', '1:PM')).toBe('annual_leave');
		expect(keyAt(fixed, 'n', '2:AM')).toBe('admin_work');
	});

	it('counts a brought-in ANP towards the minimum ahead of GPs', () => {
		const s = settings();
		s.dutyTeamMin['1:AM'] = 2;
		const staff = [gp('a'), gp('b'), gp('c'), anp('n', { '1:AM': 'east_calder' })];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' },
				c: { '1:AM': 'working:east_calder' }
			}),
			s
		);
		// ANP joins first; one GP takes duty; only ONE GP is needed to top up.
		expect(keyAt(fixed, 'n', '1:AM')).toBe('working:east_calder:duty_team');
		const teamGps = ['a', 'b', 'c'].filter((u) => fixed[u]['1:AM'].role === 'duty_team');
		expect(teamGps).toHaveLength(1);
	});

	it('duty exemption covers the duty team: exempt members are stripped, not added', () => {
		const s = settings();
		s.dutyTeamMin['1:PM'] = 2;
		// ANP n is excluded from PM duty and holds duty team; GP b likewise;
		// ANP m is available (standard EC) but excluded, so is not brought in.
		const staff = [
			gp('a'),
			gp('b', false, { AM: false, PM: true }),
			anp('n', {}, { AM: false, PM: true }),
			anp('m', { '1:PM': 'east_calder' }, { AM: false, PM: true })
		];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:PM': 'working:east_calder' },
				b: { '1:PM': 'working:east_calder:duty_team' },
				n: { '1:PM': 'working:east_calder:duty_team' }
			}),
			s
		);
		expect(fixed['n']['1:PM'].role).toBeNull(); // stripped, not re-added
		expect(fixed['b']['1:PM'].role).not.toBe('duty_team'); // stripped (takes duty instead)
		expect(fixed['m']).toBeUndefined(); // not brought in
	});

	it('does not top up the duty team with a GP excluded that period', () => {
		const s = settings();
		s.dutyTeamMin['1:AM'] = 1;
		const staff = [gp('a'), gp('b', false, { AM: true, PM: false })];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' }
			}),
			s
		);
		// a takes duty (b is excluded from AM duty); b must not be used for
		// the team either — it stays unmet rather than using an exempt GP.
		expect(fixed['a']['1:AM'].role).toBe('duty');
		expect(fixed['b']['1:AM'].role).toBeNull();
	});

	it('tops the duty team up with the lowest-tally GP, not staff order', () => {
		const s = settings();
		s.dutyTeamMin['1:AM'] = 1;
		// d already holds duty; a is first in staff order but far ahead on
		// the tally, so the team place goes to b.
		const staff = [gp('a'), gp('b'), gp('d')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder' },
				b: { '1:AM': 'working:east_calder' },
				d: { '1:AM': 'working:east_calder:duty' }
			}),
			s,
			{ tallies: { a: { worked: 10, duty: 5 }, b: { worked: 10, duty: 0 } } }
		);
		expect(fixed['b']['1:AM'].role).toBe('duty_team');
		expect(fixed['a']['1:AM'].role).toBeNull();
	});

	it('never puts a trainee on the duty team', () => {
		const s = settings();
		s.dutyTeamMin['1:PM'] = 1;
		const staff = [gp('a'), trainee('t')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:PM': 'working:east_calder:duty' },
				t: { '1:PM': 'working:east_calder' }
			}),
			s
		);
		// The team stays short rather than using the trainee.
		expect(fixed['t']['1:PM'].role).toBeNull();
	});

	it('tops the duty team up with GPs once the ANPs are on it', () => {
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
		expect(fixed['n']['1:AM'].role).toBe('duty_team'); // ANP always on the team
		// One GP takes duty, the other joins the team to reach 2.
		const teamGps = ['a', 'b'].filter((u) => fixed[u]['1:AM'].role === 'duty_team');
		expect(teamGps).toHaveLength(1);
	});

	it('always puts an EC trainee on house visits in AM sessions, never PM', () => {
		const staff = [gp('a'), trainee('t')];
		const { grid: fixed, changes } = autoFixWeek(
			staff,
			grid({
				a: { '1:AM': 'working:east_calder', '1:PM': 'working:east_calder' },
				t: { '1:AM': 'working:east_calder', '1:PM': 'working:east_calder' }
			}),
			settings()
		);
		expect(keyAt(fixed, 't', '1:AM')).toBe('working:east_calder:house_visits');
		expect(changes.some((c) => c.reason.includes('house visits in AM'))).toBe(true);
		expect(fixed['t']['1:PM'].role).toBeNull(); // PM untouched
	});

	it('fills a visit allocation with 2 trainees when no GP is spare', () => {
		const s = settings();
		s.houseVisitsRequired['1:PM'] = 1;
		const staff = [gp('a'), trainee('t1'), trainee('t2')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:PM': 'working:east_calder' },
				t1: { '1:PM': 'working:east_calder' },
				t2: { '1:PM': 'working:east_calder' }
			}),
			s
		);
		// a takes duty; both trainees go to visits (2 trainees = 1 GP).
		expect(fixed['t1']['1:PM'].role).toBe('house_visits');
		expect(fixed['t2']['1:PM'].role).toBe('house_visits');
	});

	it('does not waste a lone trainee on visits when they cannot complete a pair', () => {
		const s = settings();
		s.houseVisitsRequired['1:PM'] = 1;
		const staff = [gp('a'), trainee('t1')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				a: { '1:PM': 'working:east_calder' },
				t1: { '1:PM': 'working:east_calder' }
			}),
			s
		);
		// a takes duty; a single trainee counts for 0 visits, so they stay
		// on routine clinics rather than being burned for no credit.
		expect(fixed['t1']['1:PM'].role).toBeNull();
	});

	it('respects the routine minimum when allocating house visits', () => {
		const s = settings();
		s.minRoutineClinicians.east_calder = 2;
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
		// One duty (counts towards the minimum of 2), so visits can only take
		// one GP before the routine minimum bites.
		const roles = ['a', 'b', 'c'].map((u) => fixed[u]['1:AM'].role).sort();
		expect(roles).toEqual(['duty', 'house_visits', null].sort());
	});

	it('lets the duty GP satisfy the routine minimum on their own', () => {
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
		// The duty GP covers the minimum of 1, freeing both others for visits.
		const roles = ['a', 'b', 'c'].map((u) => fixed[u]['1:AM'].role).sort();
		expect(roles).toEqual(['duty', 'house_visits', 'house_visits'].sort());
	});

	it('clears invalid roles before filling', () => {
		const staff = [anp('n'), anp('m'), gp('a')];
		const { grid: fixed } = autoFixWeek(
			staff,
			grid({
				n: { '1:AM': 'working:east_calder:duty' }, // ANP can't hold duty → duty team
				m: { '1:AM': 'working:ratho:duty' }, // ANP can't hold duty → routine
				a: { '1:AM': 'working:east_calder' }
			}),
			settings()
		);
		expect(fixed['n']['1:AM'].role).toBe('duty_team');
		expect(fixed['m']['1:AM'].role).toBeNull();
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
