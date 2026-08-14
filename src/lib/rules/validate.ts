/**
 * Rota validation — checks one week's grid against the staffing rules.
 *
 * Implemented rules (from the client brief):
 *  R1  Each practice must have exactly one duty doctor per session, and the
 *      duty doctor must be a GP (not a trainee or ANP) who is not excluded
 *      from duty in that period (per-user AM/PM exemptions).
 *  R2  Each practice must have at least the configured minimum of GPs +
 *      GP trainees on routine clinics per session. The duty doctor counts
 *      towards this minimum (they still see routine patients); duty team
 *      and house-visit allocations do not.
 *  R3  East Calder duty team must meet the configured minimum per session
 *      (error) and ideally the desirable number (warning). The EC duty
 *      doctor counts towards both. ANPs working at East Calder are always
 *      on the duty team — one that isn't marked as such is flagged
 *      (warning; Auto-fix corrects it). The per-user AM/PM duty exemption
 *      covers the duty team too: an exempt member on it is an error, and
 *      exempt ANPs aren't expected to join.
 *  R4  East Calder house visits must meet the configured allocation per
 *      session (settable in halves), and only GPs/trainees may be
 *      allocated. A trainee counts as exactly 0.5 of a GP, and trainees
 *      working at EC always do house visits in AM sessions (warning when
 *      not marked; Auto-fix corrects it).
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
	slotPeriod,
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
			const exemptDuty = duty.filter((v) => v.member.dutyExempt[slotPeriod(slot)]);
			if (exemptDuty.length > 0) {
				found.push({
					severity: 'error',
					message: `${label}: excluded from ${slotPeriod(slot)} duty (${names(exemptDuty)})`
				});
			}

			// R2 — minimum routine clinicians. A duty GP counts: duty is worked
			// alongside routine patients, unlike duty team / house visits.
			const minRoutine = settings.minRoutineClinicians[practice] ?? 0;
			const routineClinicians = here.filter(
				(v) =>
					(v.cell.role === null || v.cell.role === 'duty') && isClinician(v.member.category)
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

		// R3 — East Calder duty team. The EC duty doctor counts towards the
		// minimum/desirable numbers: duty is duty-team work.
		const ec = working(views, 'east_calder');
		const team = ec.filter((v) => v.cell.role === 'duty_team');
		const teamCount = team.length + ec.filter((v) => v.cell.role === 'duty').length;
		const teamMin = settings.dutyTeamMin[slot] ?? 0;
		const teamDesired = settings.dutyTeamDesired[slot] ?? 0;
		if (teamCount < teamMin) {
			found.push({
				severity: 'error',
				message: `East Calder: duty team has ${teamCount} of ${teamMin} required (incl. duty doctor)`
			});
		} else if (teamCount < teamDesired) {
			found.push({
				severity: 'warning',
				message: `East Calder: duty team has ${teamCount}, below the desirable ${teamDesired}`
			});
		}
		const exemptTeam = team.filter((v) => v.member.dutyExempt[slotPeriod(slot)]);
		if (exemptTeam.length > 0) {
			found.push({
				severity: 'error',
				message: `East Calder: excluded from ${slotPeriod(slot)} duty team (${names(exemptTeam)})`
			});
		}
		const unmarkedAnps = ec.filter(
			(v) =>
				v.member.category === 'anp' &&
				v.cell.role !== 'duty_team' &&
				!v.member.dutyExempt[slotPeriod(slot)]
		);
		if (unmarkedAnps.length > 0) {
			found.push({
				severity: 'warning',
				message: `East Calder: ANPs always join the duty team (${names(unmarkedAnps)} not marked)`
			});
		}

		// R4 — East Calder house visits. A trainee counts as exactly 0.5 of a
		// GP, and the requirement itself may be set in halves.
		const visits = ec.filter((v) => v.cell.role === 'house_visits');
		const visitTrainees = visits.filter((v) => v.member.category === 'gp_trainee').length;
		const visitsCount =
			visits.filter((v) => v.member.category === 'doctor').length + visitTrainees * 0.5;
		const visitsRequired = settings.houseVisitsRequired[slot] ?? 0;
		if (visitsCount < visitsRequired) {
			found.push({
				severity: 'error',
				message: `East Calder: ${visitsCount} of ${visitsRequired} required house-visit allocations${
					visitTrainees > 0 ? ' (trainees count as 0.5)' : ''
				}`
			});
		}
		const nonClinicianVisits = visits.filter((v) => !isClinician(v.member.category));
		if (nonClinicianVisits.length > 0) {
			found.push({
				severity: 'error',
				message: `East Calder: house visits are for GPs/trainees only (${names(nonClinicianVisits)})`
			});
		}
		// Trainees working at EC always do house visits in AM sessions.
		if (slotPeriod(slot) === 'AM') {
			const unmarkedTrainees = ec.filter(
				(v) => v.member.category === 'gp_trainee' && v.cell.role !== 'house_visits'
			);
			if (unmarkedTrainees.length > 0) {
				found.push({
					severity: 'warning',
					message: `East Calder: GP trainees do house visits in AM sessions (${names(unmarkedTrainees)} not marked)`
				});
			}
		}

		if (found.length > 0) problems[slot] = found;
	}

	return problems;
}

/** True when a slot has at least one error (row shades red). */
export function slotHasErrors(problems: WeekProblems, slot: string): boolean {
	return (problems[slot] ?? []).some((p) => p.severity === 'error');
}
