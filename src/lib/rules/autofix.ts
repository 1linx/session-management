/**
 * Auto-fix — best-guess reassignment to satisfy the staffing rules.
 *
 * Pure function: takes the week grid, returns a corrected copy plus a list
 * of every change made (who, which session, from → to, why). It NEVER:
 *   - touches sick / leave / activity cells,
 *   - brings anyone in from "Not working" — EXCEPT an ANP whose standard
 *     availability covers that session at East Calder (they join the duty
 *     team; a blank cell for an available ANP means "not yet rostered"),
 *   - removes anyone from work,
 *   - moves anyone to Ratho unless their "can be sent to Ratho" flag is set.
 *
 * Order of operations per session (Monday AM → Friday PM):
 *   1. Normalise roles: ANPs at East Calder — working there, or available
 *      there per their standard sessions but left "Not working" — are
 *      ALWAYS on the duty team (whatever role their cell held), ahead of
 *      any GP; strip invalid roles elsewhere (duty team / house visits at
 *      Ratho; duty held by a non-GP; duty or duty team held by someone
 *      excluded from duty in that period — the AM/PM exemption covers
 *      both; duplicate duty doctors — the fairest keeps it).
 *   2. Ensure one duty doctor at each practice. Candidates are routine GPs
 *      already working there who aren't excluded from duty that period; if
 *      Ratho has none, a routine East Calder GP with canWorkRatho (same
 *      exclusion applies) is relocated — but only if East Calder still
 *      meets its own duty + routine minimum afterwards.
 *   3. Top the East Calder duty team up to its minimum with routine
 *      GPs/trainees (every EC ANP is already on it after step 1), never
 *      dropping routine clinicians below the configured minimum.
 *   4. Fill East Calder house visits: routine GPs/trainees only, same
 *      minimum-preserving constraint. GP trainees working at EC are
 *      ALWAYS on house visits in AM sessions (step 1), and trainees on
 *      visits count as half a GP, rounded down.
 *
 * Duty fairness — the running Duty Tally (DT): duty sessions ÷ sessions
 * worked, counting EAST CALDER sessions only (Ratho duty falls to whoever
 * is on site, so it would skew the balance; duty-team sessions count the
 * same as duty — both are the extra commitment being balanced), seeded
 * from up to a year of saved history (see
 * $lib/server/duty-history.ts) plus this week's grid, updating live as
 * fixes are applied. The candidate with the lowest DT gets duty, so duty
 * spreads proportionately to how much each person works. Tallies within
 * 0.02 of each other are treated as equal, and within such a band the pick
 * avoids giving anyone the same duty slot they held the previous week
 * (doctors dislike repeating slots week after week — a preference, never
 * a rule: a clearly lower tally still wins).
 *
 * Anything it cannot fix (e.g. no GP available for Ratho duty) is left
 * as-is and will still be flagged red by validation.
 */
import { ALL_SLOTS, isClinician, slotPeriod, type CellValue, type LocationValue } from '$lib/constants';
import type { Change, DutyContext, RotaRuleSettings, StaffMember, WeekGrid } from './types';

type Ctx = {
	staff: StaffMember[];
	grid: WeekGrid;
	settings: RotaRuleSettings;
	changes: Change[];
	/** userId → duty sessions, history + this week (kept current as fixes apply). */
	dutyCount: Map<string, number>;
	/** userId → sessions worked, history + this week. */
	workCount: Map<string, number>;
	/** userId → duty slots held the previous week (rotation preference). */
	previousDuty: Record<string, string[]>;
};

function cellOf(ctx: Ctx, userId: string, slot: string): CellValue {
	return ctx.grid[userId]?.[slot] ?? { status: 'not_working', location: null, role: null };
}

/**
 * The Duty Tally counts EAST CALDER sessions only — Ratho duty falls to
 * whoever is on site, so it would skew the balancing. Duty team is the
 * same extra commitment as duty, so both accrue tally credit.
 */
const ecWorking = (cell: CellValue) => cell.status === 'working' && cell.location === 'east_calder';
const ecDutyCredit = (cell: CellValue) =>
	ecWorking(cell) && (cell.role === 'duty' || cell.role === 'duty_team');

function setCell(ctx: Ctx, member: StaffMember, slot: string, to: CellValue, reason: string) {
	const from = cellOf(ctx, member.id, slot);
	(ctx.grid[member.id] ??= {})[slot] = to;
	ctx.changes.push({ userId: member.id, initials: member.initials, slot, from, to, reason });
	const bump = (map: Map<string, number>, by: number) =>
		map.set(member.id, (map.get(member.id) ?? 0) + by);
	if (ecWorking(from) !== ecWorking(to)) bump(ctx.workCount, ecWorking(to) ? 1 : -1);
	if (ecDutyCredit(from) !== ecDutyCredit(to)) bump(ctx.dutyCount, ecDutyCredit(to) ? 1 : -1);
}

function workingAt(ctx: Ctx, slot: string, practice: LocationValue) {
	return ctx.staff.filter((m) => {
		const cell = cellOf(ctx, m.id, slot);
		return cell.status === 'working' && cell.location === practice;
	});
}

const routine = (ctx: Ctx, slot: string, practice: LocationValue) =>
	workingAt(ctx, slot, practice).filter((m) => cellOf(ctx, m.id, slot).role === null);

const routineClinicians = (ctx: Ctx, slot: string, practice: LocationValue) =>
	routine(ctx, slot, practice).filter((m) => isClinician(m.category));

/**
 * Headcount that satisfies the routine-clinic minimum: GPs/trainees on
 * routine OR on duty (a duty doctor still sees routine patients; duty team
 * and house visits don't count).
 */
const routineMinCount = (ctx: Ctx, slot: string, practice: LocationValue) =>
	workingAt(ctx, slot, practice).filter((m) => {
		const role = cellOf(ctx, m.id, slot).role;
		return isClinician(m.category) && (role === null || role === 'duty');
	}).length;

/**
 * Lowest Duty Tally (duty ÷ sessions worked) first. Tallies are compared
 * in bands of 0.02 — exact float ratios almost never tie, so without the
 * bands the rotation preference below would never engage. Within a band,
 * whoever did NOT hold duty in this same slot last week comes first; then
 * the exact tally; ties beyond that keep staff order (sort is stable).
 */
function byDutyFairness(ctx: Ctx, slot: string) {
	const ratio = (m: StaffMember) =>
		(ctx.dutyCount.get(m.id) ?? 0) / Math.max(1, ctx.workCount.get(m.id) ?? 0);
	const repeatsSlot = (m: StaffMember) => ((ctx.previousDuty[m.id] ?? []).includes(slot) ? 1 : 0);
	return (a: StaffMember, b: StaffMember) => {
		const bandA = Math.round(ratio(a) * 50);
		const bandB = Math.round(ratio(b) * 50);
		if (bandA !== bandB) return bandA - bandB;
		if (repeatsSlot(a) !== repeatsSlot(b)) return repeatsSlot(a) - repeatsSlot(b);
		return ratio(a) - ratio(b);
	};
}

function fixSlot(ctx: Ctx, slot: string) {
	// 1. Normalise roles.
	for (const member of ctx.staff) {
		const cell = cellOf(ctx, member.id, slot);
		// The AM/PM duty exemption covers all duty work: duty doctor AND the
		// East Calder duty team.
		const exempt = member.dutyExempt[slotPeriod(slot)];
		if (member.category === 'anp') {
			// ANPs working at East Calder are always on the duty team — unless
			// excluded from duty in this period, in which case they stay (or
			// are put back) on routine.
			if (cell.status === 'working' && cell.location === 'east_calder') {
				if (exempt && cell.role !== null) {
					setCell(
						ctx,
						member,
						slot,
						{ ...cell, role: null },
						`excluded from ${slotPeriod(slot)} duty`
					);
				} else if (!exempt && cell.role !== 'duty_team') {
					setCell(
						ctx,
						member,
						slot,
						{ status: 'working', location: 'east_calder', role: 'duty_team' },
						'ANPs at East Calder are always on the duty team'
					);
				}
				continue;
			}
			// An available ANP left "Not working" is brought in — a blank cell
			// in a session their standard availability covers at EC means
			// "not yet rostered", not "off". Absence statuses stay untouched.
			if (cell.status === 'not_working' && member.standardSlots[slot] === 'east_calder' && !exempt) {
				// setCell's tally bookkeeping counts them as working at EC.
				setCell(
					ctx,
					member,
					slot,
					{ status: 'working', location: 'east_calder', role: 'duty_team' },
					'available ANP brought in to the East Calder duty team'
				);
				continue;
			}
		}
		if (cell.status !== 'working') continue;
		// GP trainees working at East Calder always do house visits in AM
		// sessions, whatever role their cell held.
		if (
			member.category === 'gp_trainee' &&
			cell.location === 'east_calder' &&
			slotPeriod(slot) === 'AM'
		) {
			if (cell.role !== 'house_visits') {
				setCell(
					ctx,
					member,
					slot,
					{ status: 'working', location: 'east_calder', role: 'house_visits' },
					'GP trainees do house visits in AM sessions'
				);
			}
			continue;
		}
		if (cell.location === 'ratho' && (cell.role === 'duty_team' || cell.role === 'house_visits')) {
			setCell(ctx, member, slot, { ...cell, role: null }, 'duty team/house visits only exist at East Calder');
		} else if (cell.role === 'duty' && member.category !== 'doctor') {
			setCell(ctx, member, slot, { ...cell, role: null }, 'duty doctor must be a GP');
		} else if ((cell.role === 'duty' || cell.role === 'duty_team') && exempt) {
			setCell(
				ctx,
				member,
				slot,
				{ ...cell, role: null },
				`excluded from ${slotPeriod(slot)} duty`
			);
		}
	}

	for (const practice of ['east_calder', 'ratho'] as LocationValue[]) {
		// 1b. Demote duplicate duty doctors — the lowest-ratio one keeps it.
		const dutyDocs = workingAt(ctx, slot, practice)
			.filter((m) => cellOf(ctx, m.id, slot).role === 'duty')
			.sort(byDutyFairness(ctx, slot));
		for (const extra of dutyDocs.slice(1)) {
			setCell(
				ctx,
				extra,
				slot,
				{ ...cellOf(ctx, extra.id, slot), role: null },
				'only one duty doctor per practice'
			);
		}

		// 2. Ensure a duty doctor (never one excluded from duty this period).
		if (dutyDocs.length === 0) {
			const candidates = routine(ctx, slot, practice)
				.filter((m) => m.category === 'doctor' && !m.dutyExempt[slotPeriod(slot)])
				.sort(byDutyFairness(ctx, slot));
			// Promoting to duty never breaks the routine minimum: a duty GP
			// still counts towards it.
			const pick = candidates[0];
			if (pick) {
				setCell(
					ctx,
					pick,
					slot,
					{ status: 'working', location: practice, role: 'duty' },
					`assigned duty doctor at ${practice === 'ratho' ? 'Ratho' : 'East Calder'}`
				);
			} else if (practice === 'ratho') {
				// Relocate an EC routine GP who is allowed to travel, if EC survives it.
				const traveller = routine(ctx, slot, 'east_calder')
					.filter(
						(m) => m.category === 'doctor' && m.canWorkRatho && !m.dutyExempt[slotPeriod(slot)]
					)
					.sort(byDutyFairness(ctx, slot))
					.find(() => {
						const ecDuty = workingAt(ctx, slot, 'east_calder').some(
							(m) => cellOf(ctx, m.id, slot).role === 'duty'
						);
						const ecRoutineAfter = routineMinCount(ctx, slot, 'east_calder') - 1;
						return ecDuty && ecRoutineAfter >= ctx.settings.minRoutineClinicians.east_calder;
					});
				if (traveller) {
					setCell(
						ctx,
						traveller,
						slot,
						{ status: 'working', location: 'ratho', role: 'duty' },
						'sent to Ratho as duty doctor (no GP on site)'
					);
				}
			}
		}
	}

	// 3. East Calder duty team up to the minimum. Every EC ANP is already on
	// the team (step 1), so only routine GPs/trainees remain as top-ups.
	const teamMin = ctx.settings.dutyTeamMin[slot] ?? 0;
	const team = () =>
		workingAt(ctx, slot, 'east_calder').filter((m) => cellOf(ctx, m.id, slot).role === 'duty_team');
	while (team().length < teamMin) {
		const pick = routineClinicians(ctx, slot, 'east_calder').filter(
			(m) => !m.dutyExempt[slotPeriod(slot)]
		)[0];
		if (!pick) break;
		// Moving them off routine must not break the routine minimum (duty
		// GPs keep counting towards it, so only this pick drops out).
		if (routineMinCount(ctx, slot, 'east_calder') - 1 < ctx.settings.minRoutineClinicians.east_calder) break;
		setCell(
			ctx,
			pick,
			slot,
			{ status: 'working', location: 'east_calder', role: 'duty_team' },
			'added to duty team (no ANP available)'
		);
	}

	// 4. East Calder house visits — GPs/trainees only. Trainees count as
	// half a GP, rounded down (2 trainees = 1 GP, 3 trainees still = 1).
	const visitsRequired = ctx.settings.houseVisitsRequired[slot] ?? 0;
	const visits = () =>
		workingAt(ctx, slot, 'east_calder').filter(
			(m) => cellOf(ctx, m.id, slot).role === 'house_visits'
		);
	const visitsCount = () => {
		const onVisits = visits();
		const trainees = onVisits.filter((m) => m.category === 'gp_trainee').length;
		return onVisits.filter((m) => m.category === 'doctor').length + Math.floor(trainees / 2);
	};
	while (visitsCount() < visitsRequired) {
		const candidates = routineClinicians(ctx, slot, 'east_calder');
		// GPs first (full credit); a trainee only if they complete a pair —
		// a lone odd trainee would leave routine clinics for no gain.
		const traineesOnVisits = visits().filter((m) => m.category === 'gp_trainee').length;
		const routineTrainees = candidates.filter((m) => m.category === 'gp_trainee');
		const traineeHelps = traineesOnVisits % 2 === 1 || routineTrainees.length >= 2;
		const pick =
			candidates.find((m) => m.category === 'doctor') ??
			(traineeHelps ? routineTrainees[0] : undefined);
		if (!pick) break;
		if (routineMinCount(ctx, slot, 'east_calder') - 1 < ctx.settings.minRoutineClinicians.east_calder) break;
		setCell(
			ctx,
			pick,
			slot,
			{ status: 'working', location: 'east_calder', role: 'house_visits' },
			'allocated to house visits'
		);
	}
}

/**
 * Run the fixer over a deep copy of the grid; the input is not mutated.
 * `duty` supplies the balancing context: historical worked/duty tallies
 * (this week's grid is added on top) and last week's duty slots for the
 * rotation preference. Omitted → fairness within this week only.
 */
export function autoFixWeek(
	staff: StaffMember[],
	grid: WeekGrid,
	settings: RotaRuleSettings,
	duty: DutyContext = {}
): { grid: WeekGrid; changes: Change[] } {
	const copy: WeekGrid = structuredClone(grid);
	const ctx: Ctx = {
		staff,
		grid: copy,
		settings,
		changes: [],
		dutyCount: new Map(),
		workCount: new Map(),
		previousDuty: duty.previousDuty ?? {}
	};

	for (const member of staff) {
		const past = duty.tallies?.[member.id];
		let worked = past?.worked ?? 0;
		let dutyHeld = past?.duty ?? 0;
		for (const slot of ALL_SLOTS) {
			const cell = copy[member.id]?.[slot];
			if (cell && ecWorking(cell)) {
				worked += 1;
				if (ecDutyCredit(cell)) dutyHeld += 1;
			}
		}
		ctx.workCount.set(member.id, worked);
		ctx.dutyCount.set(member.id, dutyHeld);
	}

	for (const slot of ALL_SLOTS) fixSlot(ctx, slot);

	return { grid: copy, changes: ctx.changes };
}
