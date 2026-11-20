/**
 * Build the anonymised DEMO database: fictional staff at two fictional
 * practices, realistic staffing rules, and ~3 months of saved rota history
 * rostered by the app's own Auto-fix, so the Duty balance and Absences
 * pages have real-looking data. Nothing here comes from a real database.
 *
 *   npm run demo:seed    (re)creates demo.db — DELETES any existing copy
 *   npm run demo         runs the app against it (vite dev --mode demo)
 *
 * The practice names shown in the app come from .env.demo
 * (Riverside = main practice, Hillcrest = branch). In the database they are
 * stored under the usual internal keys.
 *
 * Demo logins (initials as username):
 *   ADM  / demo-admin   admin — edits the rota, users and rules
 *   any staff initials / demo-staff   read-only viewer (e.g. HB)
 *
 * Weeks, relative to today: the previous 12 weeks and the current week are
 * saved; the current week has one GP phoning in sick AFTER Auto-fix, so it
 * opens with a red session to fix live. Next week is left empty, so
 * opening it offers "Use default values (with auto fix)".
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { ALL_SLOTS, slotPeriod, type CellValue, type LocationValue } from '$lib/constants';
import { addWeeks, currentWeekStart } from '$lib/dates';
import { autoFixWeek } from '$lib/rules/autofix';
import { validateWeek } from '$lib/rules/validate';
import type {
	DutyHistory,
	PreviousDuty,
	RotaRuleSettings,
	StaffMember,
	WeekGrid
} from '$lib/rules/types';

const dbPath = process.env.DEMO_DATABASE_URL ?? 'demo.db';
// This script deletes the file it seeds — refuse anything not obviously a demo.
if (!basename(dbPath).toLowerCase().includes('demo')) {
	console.error(`Refusing to seed "${dbPath}": the demo database's filename must contain "demo".`);
	process.exit(1);
}

// --- Deterministic randomness, so every reseed gives the same demo. ---
let seed = 20261113;
function random(): number {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- Fictional staff. Pattern: Mon AM/PM … Fri AM/PM; M = main, B = branch, - = off. ---
type Person = {
	name: string;
	initials: string;
	category: 'doctor' | 'gp_trainee' | 'anp';
	pattern: string;
	canWorkBranch?: boolean;
	exemptPm?: boolean;
	alwaysDuty?: string[];
	leaveDays?: number;
};

const PEOPLE: Person[] = [
	{ name: 'Hannah Brooks', initials: 'HB', category: 'doctor', pattern: 'MM MM -- MM MM', canWorkBranch: true },
	{ name: 'Samuel Okoro', initials: 'SO', category: 'doctor', pattern: 'MM -- MM MM --' },
	{ name: 'Priya Nair', initials: 'PN', category: 'doctor', pattern: '-- MM MM -- MM', canWorkBranch: true },
	{ name: 'Tom Fletcher', initials: 'TF', category: 'doctor', pattern: 'MM MM MM -- --', alwaysDuty: ['3:AM'] },
	{ name: 'Leila Haddad', initials: 'LH', category: 'doctor', pattern: 'MM -- MM -- MM', exemptPm: true },
	{ name: 'Owen Price', initials: 'OP', category: 'doctor', pattern: '-M MM -M MM M-' },
	{ name: 'Fiona Grant', initials: 'FG', category: 'doctor', pattern: 'MM MM MB -- --', canWorkBranch: true },
	{ name: 'James Whitaker', initials: 'JW', category: 'doctor', pattern: '-- -- MM MM MM' },
	{ name: 'Aisha Rahman', initials: 'AR', category: 'doctor', pattern: 'MM -- -- MM MM', canWorkBranch: true },
	{ name: 'Chris Hall', initials: 'CH', category: 'doctor', pattern: '-- MM MM MM --' },
	{ name: 'Rachel Moore', initials: 'RM', category: 'doctor', pattern: 'BB BB -- BB --', canWorkBranch: true },
	{ name: 'Daniel Reid', initials: 'DR', category: 'doctor', pattern: '-- BB BB -- BB', canWorkBranch: true },
	{ name: 'Mei Lin', initials: 'ML', category: 'doctor', pattern: 'B- -- B- MB MM', canWorkBranch: true },
	{ name: 'Ben Carter', initials: 'BC', category: 'gp_trainee', pattern: 'MM MM MM MM --' },
	{ name: 'Zoe Patel', initials: 'ZP', category: 'gp_trainee', pattern: '-- MM MM MM MM' },
	{ name: 'Kate Morgan', initials: 'KM', category: 'anp', pattern: 'MM MM MM -- --' },
	{ name: 'Liam Shaw', initials: 'LS', category: 'anp', pattern: '-- MM MM MM MM' },
	{ name: 'Nina Kowalski', initials: 'NK', category: 'anp', pattern: 'MM -- MM -- MM' }
];

const RULES: RotaRuleSettings = {
	minRoutineClinicians: { east_calder: 2, ratho: 1 },
	dutyTeamMin: Object.fromEntries(ALL_SLOTS.map((s) => [s, 2])),
	dutyTeamDesired: Object.fromEntries(ALL_SLOTS.map((s) => [s, 3])),
	houseVisitsRequired: Object.fromEntries(
		ALL_SLOTS.map((s) => [s, slotPeriod(s) === 'AM' ? 1.5 : 1])
	)
};

const HISTORY_WEEKS = 12;

// --- Build the people as the rules engine sees them. ---
const PRACTICE: Record<string, LocationValue> = { M: 'east_calder', B: 'ratho' };
const staff: (StaffMember & { name: string })[] = PEOPLE.map((p) => {
	const codes = p.pattern.replace(/\s+/g, '');
	const standardSlots: StaffMember['standardSlots'] = {};
	ALL_SLOTS.forEach((slot, i) => {
		if (PRACTICE[codes[i]]) standardSlots[slot] = PRACTICE[codes[i]];
	});
	return {
		id: randomUUID(),
		name: p.name,
		initials: p.initials,
		category: p.category,
		canWorkRatho: Boolean(p.canWorkBranch),
		dutyExempt: { AM: false, PM: Boolean(p.exemptPm) },
		standardSlots,
		standardDuty: p.alwaysDuty ?? []
	};
});

// --- Weeks ---
const NOT_WORKING: CellValue = { status: 'not_working', location: null, role: null };

/** "Use default values": everyone at their usual practice, always-duty as duty. */
function defaultsGrid(): WeekGrid {
	const grid: WeekGrid = {};
	for (const member of staff) {
		grid[member.id] = {};
		for (const slot of ALL_SLOTS) {
			const practice = member.standardSlots[slot];
			grid[member.id][slot] = practice
				? {
						status: 'working',
						location: practice,
						role: member.standardDuty.includes(slot) ? 'duty' : null
					}
				: { ...NOT_WORKING };
		}
	}
	return grid;
}

/** Leave in whole-week blocks (pre-planned), plus the odd sick day. */
function applyAbsences(grid: WeekGrid, weekIndex: number, leaveWeeks: Map<string, Set<number>>) {
	for (const member of staff) {
		const onLeave = leaveWeeks.get(member.id)?.has(weekIndex);
		for (const slot of ALL_SLOTS) {
			if (grid[member.id][slot].status !== 'working') continue;
			if (onLeave) grid[member.id][slot] = { status: 'annual_leave', location: null, role: null };
		}
		// A sick day knocks out both sessions of one day.
		if (!onLeave && random() < 0.05) {
			const day = 1 + Math.floor(random() * 5);
			for (const period of ['AM', 'PM']) {
				const slot = `${day}:${period}`;
				if (grid[member.id][slot].status === 'working') {
					grid[member.id][slot] = { status: 'sick', location: null, role: null };
				}
			}
		}
	}
}

/** Running Duty Tally inputs: main-practice sessions only, duty team = duty. */
function addToTallies(tallies: DutyHistory, grid: WeekGrid) {
	for (const [userId, slots] of Object.entries(grid)) {
		for (const cell of Object.values(slots)) {
			if (cell.status !== 'working' || cell.location !== 'east_calder') continue;
			const t = (tallies[userId] ??= { worked: 0, duty: 0 });
			t.worked += 1;
			if (cell.role === 'duty' || cell.role === 'duty_team') t.duty += 1;
		}
	}
}

function dutySlots(grid: WeekGrid): PreviousDuty {
	const out: PreviousDuty = {};
	for (const [userId, slots] of Object.entries(grid)) {
		for (const [slot, cell] of Object.entries(slots)) {
			if (cell.role === 'duty') (out[userId] ??= []).push(slot);
		}
	}
	return out;
}

// --- Write the database ---
for (const suffix of ['', '-wal', '-shm', '-journal']) {
	if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
}
const sqlite = new Database(dbPath);
migrate(drizzle(sqlite), { migrationsFolder: 'drizzle' });

function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(password.normalize('NFKC'), salt, 64);
	return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

const now = Math.floor(Date.now() / 1000);
const insertUser = sqlite.prepare(`
	INSERT INTO users (id, password_hash, name, initials, role, category, working_slots, standard_duty,
		can_work_ratho, duty_exempt_am, duty_exempt_pm, leave_entitlement, display_order, on_rota, active, created_at)
	VALUES (@id, @passwordHash, @name, @initials, @role, @category, @standardSlots, @standardDuty,
		@canWorkRatho, @dutyExemptAm, @dutyExemptPm, @leaveEntitlement, @displayOrder, @onRota, 1, @createdAt)
`);
const insertEntry = sqlite.prepare(`
	INSERT INTO schedule_entries (id, user_id, week_start, weekday, period, status, location, role, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const thisWeek = currentWeekStart();
const firstWeek = addWeeks(thisWeek, -HISTORY_WEEKS);

// Each person takes 1–2 whole weeks of leave in the history window.
const leaveWeeks = new Map<string, Set<number>>();
for (const member of staff) {
	const weeks = new Set<number>();
	const count = random() < 0.5 ? 1 : 2;
	while (weeks.size < count) weeks.add(Math.floor(random() * HISTORY_WEEKS));
	leaveWeeks.set(member.id, weeks);
}

const tallies: DutyHistory = {};
let previousDuty: PreviousDuty = {};
const residual: string[] = [];
let sickNote = '';

sqlite.transaction(() => {
	const staffPassword = hashPassword('demo-staff');
	insertUser.run({
		id: randomUUID(),
		passwordHash: hashPassword('demo-admin'),
		name: 'Practice Manager',
		initials: 'ADM',
		role: 'admin',
		category: 'doctor',
		standardSlots: '{}',
		standardDuty: '[]',
		canWorkRatho: 0,
		dutyExemptAm: 0,
		dutyExemptPm: 0,
		leaveEntitlement: 0,
		displayOrder: 0,
		onRota: 0,
		createdAt: now
	});
	staff.forEach((member, i) => {
		insertUser.run({
			id: member.id,
			passwordHash: staffPassword,
			name: member.name,
			initials: member.initials,
			role: 'viewer',
			category: member.category,
			standardSlots: JSON.stringify(member.standardSlots),
			standardDuty: JSON.stringify(member.standardDuty),
			canWorkRatho: member.canWorkRatho ? 1 : 0,
			dutyExemptAm: 0,
			dutyExemptPm: member.dutyExempt.PM ? 1 : 0,
			leaveEntitlement: Object.keys(member.standardSlots).length * 6, // ~6 weeks' worth
			displayOrder: (i + 1) * 10,
			onRota: 1,
			createdAt: now
		});
	});
	sqlite
		.prepare("INSERT INTO settings (key, value) VALUES ('rota_rules', ?)")
		.run(JSON.stringify(RULES));

	// History weeks + the current week, oldest first so tallies accumulate.
	for (let w = 0; w <= HISTORY_WEEKS; w++) {
		const week = addWeeks(firstWeek, w);
		const grid = defaultsGrid();
		if (w < HISTORY_WEEKS) applyAbsences(grid, w, leaveWeeks);
		const { grid: fixed } = autoFixWeek(staff, grid, RULES, {
			tallies: structuredClone(tallies),
			previousDuty
		});

		if (week === thisWeek) {
			// Demo moment: a GP on duty phones in sick after the rota was set.
			const victim = staff.find((m) => fixed[m.id]['2:AM']?.role === 'duty' && m.category === 'doctor');
			if (victim) {
				fixed[victim.id]['2:AM'] = { status: 'sick', location: null, role: null };
				fixed[victim.id]['2:PM'] =
					fixed[victim.id]['2:PM'].status === 'working'
						? { status: 'sick', location: null, role: null }
						: fixed[victim.id]['2:PM'];
				sickNote = `${victim.initials} (${victim.name}) off sick Tuesday`;
			}
		}

		for (const [userId, slots] of Object.entries(fixed)) {
			for (const [slot, cell] of Object.entries(slots)) {
				if (cell.status === 'not_working') continue;
				const [weekday, period] = slot.split(':');
				insertEntry.run(randomUUID(), userId, week, Number(weekday), period, cell.status, cell.location, cell.role, now);
			}
		}
		const errors = Object.values(validateWeek(staff, fixed, RULES))
			.flat()
			.filter((p) => p.severity === 'error').length;
		residual.push(`${week}: ${errors} error${errors === 1 ? '' : 's'}`);
		addToTallies(tallies, fixed);
		previousDuty = dutySlots(fixed);
	}
})();

sqlite.close();
console.log(`Seeded ${dbPath}: ${staff.length} fictional staff + admin, ${HISTORY_WEEKS} weeks of history + this week.`);
console.log(`This week (${thisWeek}): ${sickNote || 'no sick call injected'} — opens with a red session.`);
console.log(`Next week (${addWeeks(thisWeek, 1)}) is empty — opening it offers "Use default values".`);
console.log('Rule errors left after Auto-fix, per saved week:\n  ' + residual.join('\n  '));
