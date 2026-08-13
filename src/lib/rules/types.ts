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

/**
 * Historical worked/duty session totals per userId (rolling window), used
 * to seed the Duty Tally: duty ÷ worked. EAST CALDER sessions only, on
 * both sides — Ratho duty/work is excluded from the balancing. Users
 * absent from the map count as 0/0 — a brand-new doctor has the lowest
 * tally and gets duty first.
 */
export type DutyHistory = Record<string, { worked: number; duty: number }>;

/** userId → slot keys ("1:AM") where they held duty the PREVIOUS week. */
export type PreviousDuty = Record<string, string[]>;

/** Optional balancing context for Auto-fix's duty assignment. */
export type DutyContext = {
	tallies?: DutyHistory;
	previousDuty?: PreviousDuty;
};
