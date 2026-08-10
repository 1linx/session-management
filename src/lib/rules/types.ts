/**
 * Shared types for the rota rules engine.
 *
 * THIS DIRECTORY IS DELIBERATELY SEPARATE from the rest of the app: the
 * staffing rules will need the most fine-tuning over time, so everything in
 * src/lib/rules/ is pure data-in/data-out — no database, no SvelteKit, no
 * side effects. The rota page runs validateWeek() live in the browser; the
 * Auto-fix server action runs autoFixWeek() on saved data.
 */
import type { CellValue, Period, StandardSlots } from '$lib/constants';

/** The subset of a user the rules need. */
export type StaffMember = {
	id: string;
	initials: string;
	/** 'doctor' | 'gp_trainee' | 'anp' */
	category: string;
	/** May Auto-fix relocate them to Ratho? */
	canWorkRatho: boolean;
	/** Periods in which they may never hold duty (duty doctor or EC duty team). */
	dutyExempt: Record<Period, boolean>;
	/**
	 * Standard availability (slot → practice). Auto-fix uses it to bring an
	 * ANP with a blank "Not working" cell onto the EC duty team.
	 */
	standardSlots: StandardSlots;
};

/** One week of cells: userId → slotKey ("1:AM") → cell state. */
export type WeekGrid = Record<string, Record<string, CellValue>>;

/**
 * Admin-configurable staffing requirements (see /settings).
 * Slot-keyed maps use "1:AM" … "5:PM"; missing keys mean 0.
 */
export type RotaRuleSettings = {
	/** Minimum GPs+trainees on routine clinics, per practice, every session. */
	minRoutineClinicians: { east_calder: number; ratho: number };
	/** East Calder duty team: minimum acceptable headcount per slot. */
	dutyTeamMin: Record<string, number>;
	/** East Calder duty team: desirable headcount per slot. */
	dutyTeamDesired: Record<string, number>;
	/** East Calder house visit allocations required per slot. */
	houseVisitsRequired: Record<string, number>;
};

export const DEFAULT_RULE_SETTINGS: RotaRuleSettings = {
	minRoutineClinicians: { east_calder: 0, ratho: 0 },
	dutyTeamMin: {},
	dutyTeamDesired: {},
	houseVisitsRequired: {}
};

export type Problem = {
	/** errors shade the row red; warnings are listed but don't. */
	severity: 'error' | 'warning';
	message: string;
};

/** slotKey → problems found for that session. */
export type WeekProblems = Record<string, Problem[]>;

export type Change = {
	userId: string;
	initials: string;
	slot: string;
	from: CellValue;
	to: CellValue;
	reason: string;
};
