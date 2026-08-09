/**
 * Seed the database. Safe to re-run: it skips seeding if any users exist.
 *
 * Two modes:
 *  - If scripts/seed-data.json exists (created by scripts/snapshot.js), it
 *    seeds those users and staffing rules — the real data set. Users whose
 *    snapshot has no password hash get the password "changeme".
 *  - Otherwise it falls back to the built-in sample: admin ADM plus the
 *    DR1–ANP2 rota from example.xlsx in the current week.
 *
 * Usage: node scripts/seed.js
 */
import Database from 'better-sqlite3';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const dbPath = process.env.DATABASE_URL ?? 'local.db';
const snapshotPath = 'scripts/seed-data.json';
const db = new Database(dbPath);

const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get();
if (existing.n > 0) {
	console.log(`Database already has ${existing.n} user(s) — nothing to do.`);
	process.exit(0);
}

function hashPassword(password) {
	const salt = randomBytes(16);
	const hash = scryptSync(password.normalize('NFKC'), salt, 64);
	return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

const now = Math.floor(Date.now() / 1000);

const insertUser = db.prepare(`
	INSERT INTO users (id, password_hash, name, initials, role, category, working_slots, can_work_ratho, leave_entitlement, display_order, on_rota, active, created_at)
	VALUES (@id, @passwordHash, @name, @initials, @role, @category, @standardSlots, @canWorkRatho, @leaveEntitlement, @displayOrder, @onRota, @active, @createdAt)
`);
const insertEntry = db.prepare(`
	INSERT INTO schedule_entries (id, user_id, week_start, weekday, period, status, location, role, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
`);
const insertSetting = db.prepare(
	'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

// --- Mode 1: snapshot data set (scripts/snapshot.js output) ---
function seedFromSnapshot(snapshot) {
	let defaultPasswords = 0;
	db.transaction(() => {
		snapshot.users.forEach((user, i) => {
			if (!user.passwordHash) defaultPasswords += 1;
			insertUser.run({
				id: randomUUID(),
				passwordHash: user.passwordHash ?? hashPassword('changeme'),
				name: user.name,
				initials: user.initials,
				role: user.role,
				category: user.category,
				standardSlots: JSON.stringify(user.standardSlots ?? {}),
				canWorkRatho: user.canWorkRatho ? 1 : 0,
				leaveEntitlement: user.leaveEntitlement ?? 0,
				displayOrder: user.displayOrder ?? i * 10,
				onRota: user.onRota ? 1 : 0,
				active: user.active ? 1 : 0,
				createdAt: now
			});
		});
		if (snapshot.ruleSettings) {
			insertSetting.run('rota_rules', JSON.stringify(snapshot.ruleSettings));
		}
	})();
	console.log(
		`Seeded ${snapshot.users.length} users from ${snapshotPath} (captured ${snapshot.generatedAt})` +
			`${snapshot.ruleSettings ? ' with staffing rules' : ''}.` +
			(defaultPasswords > 0
				? ` ${defaultPasswords} user(s) had no captured password — set to "changeme".`
				: '')
	);
}

// --- Mode 2: built-in sample (example.xlsx) ---
function seedSample() {
	// The sample rota goes into the current week (Monday, Europe/London).
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
	const todayUtc = new Date(`${today}T00:00:00Z`);
	const weekStart = new Date(todayUtc.getTime() - ((todayUtc.getUTCDay() + 6) % 7) * 86400000)
		.toISOString()
		.slice(0, 10);

	// Weekdays: 1 = Monday … 5 = Friday. W = working (East Calder), N = not working, R = working (Ratho).
	const STATUS = {
		W: { status: 'working', location: 'east_calder' },
		N: { status: 'not_working', location: null },
		R: { status: 'working', location: 'ratho' }
	};
	const people = [
		{ initials: 'DR1', category: 'doctor', rota: 'WW WW WW NN NN', canWorkRatho: 1 },
		{ initials: 'DR2', category: 'doctor', rota: 'NN WW NN WW WW', canWorkRatho: 0 },
		{ initials: 'DR3', category: 'doctor', rota: 'WW NN WW WN NN', canWorkRatho: 1 },
		{ initials: 'DR4', category: 'doctor', rota: 'NN WW WW WW WW', canWorkRatho: 0 },
		{ initials: 'DR5', category: 'doctor', rota: 'RR RR RR NN NR', canWorkRatho: 1 },
		{ initials: 'DR6', category: 'doctor', rota: 'NN NN NN RR RN', canWorkRatho: 1 },
		{ initials: 'DR7', category: 'gp_trainee', rota: 'WW NN WW WN NN', canWorkRatho: 0 },
		{ initials: 'ANP1', category: 'anp', rota: 'NN WW NN WW WW', canWorkRatho: 0 },
		{ initials: 'ANP2', category: 'anp', rota: 'WW NN WW WN NN', canWorkRatho: 0 }
	];

	db.transaction(() => {
		insertUser.run({
			id: randomUUID(),
			passwordHash: hashPassword('changeme-admin'),
			name: 'Administrator',
			initials: 'ADM',
			role: 'admin',
			category: 'doctor',
			standardSlots: JSON.stringify(
				Object.fromEntries(
					[1, 2, 3, 4, 5].flatMap((d) => [
						[`${d}:AM`, 'east_calder'],
						[`${d}:PM`, 'east_calder']
					])
				)
			),
			canWorkRatho: 0,
			leaveEntitlement: 0,
			displayOrder: 0,
			onRota: 0,
			active: 1,
			createdAt: now
		});

		people.forEach((p, i) => {
			const userId = randomUUID();
			const sessions = p.rota.replace(/\s+/g, ''); // 10 chars: Mon AM/PM … Fri AM/PM
			// Standard availability: slot → practice, straight from the rota codes.
			const standardSlots = {};
			for (let d = 1; d <= 5; d++) {
				['AM', 'PM'].forEach((period, pi) => {
					const code = sessions[(d - 1) * 2 + pi];
					if (code !== 'N') standardSlots[`${d}:${period}`] = STATUS[code].location;
				});
			}
			insertUser.run({
				id: userId,
				passwordHash: hashPassword('changeme'),
				name: p.initials,
				initials: p.initials,
				role: 'viewer',
				category: p.category,
				standardSlots: JSON.stringify(standardSlots),
				canWorkRatho: p.canWorkRatho,
				leaveEntitlement: 56, // 28 days
				displayOrder: (i + 1) * 10,
				onRota: 1,
				active: 1,
				createdAt: now
			});
			for (let d = 1; d <= 5; d++) {
				['AM', 'PM'].forEach((period, pi) => {
					const cell = STATUS[sessions[(d - 1) * 2 + pi]];
					insertEntry.run(randomUUID(), userId, weekStart, d, period, cell.status, cell.location, now);
				});
			}
		});
	})();
	console.log(
		'Seeded SAMPLE data: admin ADM (password: changeme-admin) and 9 sample rota users, login = initials (password: changeme).'
	);
}

if (existsSync(snapshotPath)) {
	seedFromSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')));
} else {
	seedSample();
}
