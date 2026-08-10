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
 *      Ratho; duty held by a non-GP; duplicate duty doctors — the fairest
 *      keeps it).
 *   2. Ensure one duty doctor at each practice. Candidates are routine GPs
 *      already working there; if Ratho has none, a routine East Calder GP
 *      with canWorkRatho is relocated — but only if East Calder still meets
 *      its own duty + routine minimum afterwards.
 *   3. Top the East Calder duty team up to its minimum with routine
 *      GPs/trainees (every EC ANP is already on it after step 1), never
 *      dropping routine clinicians below the configured minimum.
 *   4. Fill East Calder house visits: routine GPs/trainees only, same
 *      minimum-preserving constraint.
 *
 * Duty fairness: among candidates, the pick is the GP with the lowest
 * (duty sessions ÷ sessions worked) ratio within this week, so duty spreads
 * proportionately to how much each person works. The count updates as
 * fixes are applied. (The rota period is currently one week; widening the
 * fairness window to a multi-week period is a known future refinement.)
 *
 * Anything it cannot fix (e.g. no GP available for Ratho duty) is left
 * as-is and will still be flagged red by validation.
 */
import { ALL_SLOTS, isClinician, type CellValue, type LocationValue } from '$lib/constants';
import type { Change, RotaRuleSettings, StaffMember, WeekGrid } from './types';

type Ctx = {
	staff: StaffMember[];
	grid: WeekGrid;
	settings: RotaRuleSettings;
	changes: Change[];
	/** userId → duty sessions this week (kept current as fixes apply). */
	dutyCount: Map<string, number>;
	/** userId → sessions worked this week. */
	workCount: Map<string, number>;
};

function cellOf(ctx: Ctx, userId: string, slot: string): CellValue {
	return ctx.grid[userId]?.[slot] ?? { status: 'not_working', location: null, role: null };
}

function setCell(ctx: Ctx, member: StaffMember, slot: string, to: CellValue, reason: string) {
	const from = cellOf(ctx, member.id, slot);
	(ctx.grid[member.id] ??= {})[slot] = to;
	ctx.changes.push({ userId: member.id, initials: member.initials, slot, from, to, reason });
	if (from.role === 'duty' && to.role !== 'duty') {
		ctx.dutyCount.set(member.id, (ctx.dutyCount.get(member.id) ?? 0) - 1);
	}
	if (to.role === 'duty' && from.role !== 'duty') {
		ctx.dutyCount.set(member.id, (ctx.dutyCount.get(member.id) ?? 0) + 1);
	}
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

/** Lowest duty-per-session-worked first; stable on staff order for ties. */
function byDutyFairness(ctx: Ctx) {
	return (a: StaffMember, b: StaffMember) => {
		const ratio = (m: StaffMember) =>
			(ctx.dutyCount.get(m.id) ?? 0) / Math.max(1, ctx.workCount.get(m.id) ?? 0);
		return ratio(a) - ratio(b);
	};
}

function fixSlot(ctx: Ctx, slot: string) {
	// 1. Normalise roles.
	for (const member of ctx.staff) {
		const cell = cellOf(ctx, member.id, slot);
		if (member.category === 'anp') {
			// ANPs working at East Calder are always on the duty team.
			if (cell.status === 'working' && cell.location === 'east_calder') {
				if (cell.role !== 'duty_team') {
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
			if (cell.status === 'not_working' && member.standardSlots[slot] === 'east_calder') {
				setCell(
					ctx,
					member,
					slot,
					{ status: 'working', location: 'east_calder', role: 'duty_team' },
					'available ANP brought in to the East Calder duty team'
				);
				ctx.workCount.set(member.id, (ctx.workCount.get(member.id) ?? 0) + 1);
				continue;
			}
		}
		if (cell.status !== 'working') continue;
		if (cell.location === 'ratho' && (cell.role === 'duty_team' || cell.role === 'house_visits')) {
			setCell(ctx, member, slot, { ...cell, role: null }, 'duty team/house visits only exist at East Calder');
		}
		if (cell.role === 'duty' && member.category !== 'doctor') {
			setCell(ctx, member, slot, { ...cell, role: null }, 'duty doctor must be a GP');
		}
	}

	for (const practice of ['east_calder', 'ratho'] as LocationValue[]) {
		// 1b. Demote duplicate duty doctors — the lowest-ratio one keeps it.
		const dutyDocs = workingAt(ctx, slot, practice)
			.filter((m) => cellOf(ctx, m.id, slot).role === 'duty')
			.sort(byDutyFairness(ctx));
		for (const extra of dutyDocs.slice(1)) {
			setCell(
				ctx,
				extra,
				slot,
				{ ...cellOf(ctx, extra.id, slot), role: null },
				'only one duty doctor per practice'
			);
		}

		// 2. Ensure a duty doctor.
		if (dutyDocs.length === 0) {
			const candidates = routine(ctx, slot, practice)
				.filter((m) => m.category === 'doctor')
				.sort(byDutyFairness(ctx));
			// Don't leave the routine minimum unmet by promoting the last clinician
			// unless there is no other option — duty doctor outranks the minimum.
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
					.filter((m) => m.category === 'doctor' && m.canWorkRatho)
					.sort(byDutyFairness(ctx))
					.find(() => {
						const ecDuty = workingAt(ctx, slot, 'east_calder').some(
							(m) => cellOf(ctx, m.id, slot).role === 'duty'
						);
						const ecRoutineAfter = routineClinicians(ctx, slot, 'east_calder').length - 1;
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
		const clinicians = routineClinicians(ctx, slot, 'east_calder');
		if (clinicians.length - 1 < ctx.settings.minRoutineClinicians.east_calder) break;
		const pick = clinicians[0];
		if (!pick) break;
		setCell(
			ctx,
			pick,
			slot,
			{ status: 'working', location: 'east_calder', role: 'duty_team' },
			'added to duty team (no ANP available)'
		);
	}

	// 4. East Calder house visits — GPs/trainees only.
	const visitsRequired = ctx.settings.houseVisitsRequired[slot] ?? 0;
	const visits = () =>
		workingAt(ctx, slot, 'east_calder').filter(
			(m) => cellOf(ctx, m.id, slot).role === 'house_visits'
		);
	while (visits().length < visitsRequired) {
		const clinicians = routineClinicians(ctx, slot, 'east_calder');
		if (clinicians.length === 0) break;
		if (clinicians.length - 1 < ctx.settings.minRoutineClinicians.east_calder) break;
		setCell(
			ctx,
			clinicians[0],
			slot,
			{ status: 'working', location: 'east_calder', role: 'house_visits' },
			'allocated to house visits'
		);
	}
}

/** Run the fixer over a deep copy of the grid; the input is not mutated. */
export function autoFixWeek(
	staff: StaffMember[],
	grid: WeekGrid,
	settings: RotaRuleSettings
): { grid: WeekGrid; changes: Change[] } {
	const copy: WeekGrid = structuredClone(grid);
	const ctx: Ctx = {
		staff,
		grid: copy,
		settings,
		changes: [],
		dutyCount: new Map(),
		workCount: new Map()
	};

	for (const member of staff) {
		let worked = 0;
		let duty = 0;
		for (const slot of ALL_SLOTS) {
			const cell = copy[member.id]?.[slot];
			if (cell?.status === 'working') {
				worked += 1;
				if (cell.role === 'duty') duty += 1;
			}
		}
		ctx.workCount.set(member.id, worked);
		ctx.dutyCount.set(member.id, duty);
	}

	for (const slot of ALL_SLOTS) fixSlot(ctx, slot);

	return { grid: copy, changes: ctx.changes };
}
