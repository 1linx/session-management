/**
 * Rota validation — checks one week's grid against the staffing rules.
 *
 * Implemented rules (from the client brief):
 *  R1  Each practice must have exactly one duty doctor per session, and the
 *      duty doctor must be a GP (not a trainee or ANP).
 *  R2  Each practice must have at least the configured minimum of GPs +
 *      GP trainees on routine clinics (role = none) per session.
 *  R3  East Calder duty team must meet the configured minimum per session
 *      (error) and ideally the desirable number (warning). ANPs should be
 *      used before GPs (warning when a GP is on the team while a routine
 *      ANP is available).
 *  R4  East Calder house visits must meet the configured allocation per
 *      session, and only GPs/trainees may be allocated.
 *  R5  Duty team and house visits are East Calder concepts — flagged at
 *      Ratho.
 *
 * Not yet implemented (tracked in the brief): annual leave, special
 * activities, cross-site auto-allocation history.
 */
import {
	ALL_SLOTS,
	isClinician,
	locationLabel,
	type CellValue,
	type LocationValue
} from '$lib/constants';
import type { Problem, RotaRuleSettings, StaffMember, WeekGrid, WeekProblems } from './types';

const PRACTICES: LocationValue[] = ['east_calder', 'ratho'];

type SlotView = {
	member: StaffMember;
	cell: CellValue;
};

function cellsAt(staff: StaffMember[], grid: WeekGrid, slot: string): SlotView[] {
	return staff.map((member) => ({
		member,
		cell: grid[member.id]?.[slot] ?? { status: 'not_working', location: null, role: null }
	}));
}

const working = (views: SlotView[], practice: LocationValue) =>
	views.filter((v) => v.cell.status === 'working' && v.cell.location === practice);

const names = (views: SlotView[]) => views.map((v) => v.member.initials).join(', ');

/** Validate every session of the week. Returns problems keyed by slot. */
export function validateWeek(
	staff: StaffMember[],
	grid: WeekGrid,
	settings: RotaRuleSettings
): WeekProblems {
	const problems: WeekProblems = {};

	for (const slot of ALL_SLOTS) {
		const found: Problem[] = [];
		const views = cellsAt(staff, grid, slot);

		for (const practice of PRACTICES) {
			const here = working(views, practice);
			const label = locationLabel(practice);

			// R1 — exactly one duty doctor, and a GP.
			const duty = here.filter((v) => v.cell.role === 'duty');
			if (duty.length === 0) {
				found.push({ severity: 'error', message: `${label}: no duty doctor` });
			} else if (duty.length > 1) {
				found.push({
					severity: 'error',
					message: `${label}: more than one duty doctor (${names(duty)})`
				});
			}
			const nonGpDuty = duty.filter((v) => v.member.category !== 'doctor');
			if (nonGpDuty.length > 0) {
				found.push({
					severity: 'error',
					message: `${label}: duty doctor must be a GP (${names(nonGpDuty)})`
				});
			}

			// R2 — minimum routine clinicians.
			const minRoutine = settings.minRoutineClinicians[practice] ?? 0;
			const routineClinicians = here.filter(
				(v) => v.cell.role === null && isClinician(v.member.category)
			);
			if (routineClinicians.length < minRoutine) {
				found.push({
					severity: 'error',
					message: `${label}: ${routineClinicians.length} of ${minRoutine} required routine GPs/trainees`
				});
			}

			// R5 — EC-only roles at Ratho.
			if (practice === 'ratho') {
				const misplaced = here.filter(
					(v) => v.cell.role === 'duty_team' || v.cell.role === 'house_visits'
				);
				if (misplaced.length > 0) {
					found.push({
						severity: 'error',
						message: `${label}: duty team / house visits only exist at East Calder (${names(misplaced)})`
					});
				}
			}
		}

		// R3 — East Calder duty team.
		const ec = working(views, 'east_calder');
		const team = ec.filter((v) => v.cell.role === 'duty_team');
		const teamMin = settings.dutyTeamMin[slot] ?? 0;
		const teamDesired = settings.dutyTeamDesired[slot] ?? 0;
		if (team.length < teamMin) {
			found.push({
				severity: 'error',
				message: `East Calder: duty team has ${team.length} of ${teamMin} required`
			});
		} else if (team.length < teamDesired) {
			found.push({
				severity: 'warning',
				message: `East Calder: duty team has ${team.length}, below the desirable ${teamDesired}`
			});
		}
		const gpOnTeam = team.filter((v) => v.member.category !== 'anp');
		const spareAnps = ec.filter((v) => v.cell.role === null && v.member.category === 'anp');
		if (gpOnTeam.length > 0 && spareAnps.length > 0) {
			found.push({
				severity: 'warning',
				message: `East Calder: ANPs should fill the duty team before GPs (${names(spareAnps)} available)`
			});
		}

		// R4 — East Calder house visits.
		const visits = ec.filter((v) => v.cell.role === 'house_visits');
		const visitsRequired = settings.houseVisitsRequired[slot] ?? 0;
		if (visits.length < visitsRequired) {
			found.push({
				severity: 'error',
				message: `East Calder: ${visits.length} of ${visitsRequired} required house-visit allocations`
			});
		}
		const nonClinicianVisits = visits.filter((v) => !isClinician(v.member.category));
		if (nonClinicianVisits.length > 0) {
			found.push({
				severity: 'error',
				message: `East Calder: house visits are for GPs/trainees only (${names(nonClinicianVisits)})`
			});
		}

		if (found.length > 0) problems[slot] = found;
	}

	return problems;
}

/** True when a slot has at least one error (row shades red). */
export function slotHasErrors(problems: WeekProblems, slot: string): boolean {
	return (problems[slot] ?? []).some((p) => p.severity === 'error');
}
