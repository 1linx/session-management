/**
 * Seed the database with an admin account and the sample rota from
 * example.xlsx. Safe to re-run: it skips seeding if any users exist.
 *
 * Usage: node scripts/seed.js
 */
import Database from 'better-sqlite3';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';

const dbPath = process.env.DATABASE_URL ?? 'local.db';
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
	INSERT INTO users (id, email, password_hash, name, initials, role, category, working_slots, can_work_ratho, display_order, on_rota, active, created_at)
	VALUES (@id, @email, @passwordHash, @name, @initials, @role, @category, @standardSlots, @canWorkRatho, @displayOrder, @onRota, 1, @createdAt)
`);
const insertEntry = db.prepare(`
	INSERT INTO schedule_entries (id, user_id, week_start, weekday, period, status, location, role, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
`);

// The sample rota goes into the current week (Monday, Europe/London).
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const todayUtc = new Date(`${today}T00:00:00Z`);
const weekStart = new Date(todayUtc.getTime() - ((todayUtc.getUTCDay() + 6) % 7) * 86400000)
	.toISOString()
	.slice(0, 10);

// Sample rota lifted from example.xlsx.
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

const seedAll = db.transaction(() => {
	insertUser.run({
		id: randomUUID(),
		email: 'admin@example.com',
		passwordHash: hashPassword('changeme-admin'),
		name: 'Administrator',
		initials: 'ADM',
		role: 'admin',
		category: 'doctor',
		standardSlots: JSON.stringify(
			Object.fromEntries([1, 2, 3, 4, 5].flatMap((d) => [
				[`${d}:AM`, 'east_calder'],
				[`${d}:PM`, 'east_calder']
			]))
		),
		canWorkRatho: 0,
		displayOrder: 0,
		onRota: 0,
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
			email: `${p.initials.toLowerCase()}@example.com`,
			passwordHash: hashPassword('changeme'),
			name: p.initials,
			initials: p.initials,
			role: 'viewer',
			category: p.category,
			standardSlots: JSON.stringify(standardSlots),
			canWorkRatho: p.canWorkRatho,
			displayOrder: (i + 1) * 10,
			onRota: 1,
			createdAt: now
		});
		for (let d = 1; d <= 5; d++) {
			['AM', 'PM'].forEach((period, pi) => {
				const cell = STATUS[sessions[(d - 1) * 2 + pi]];
				insertEntry.run(randomUUID(), userId, weekStart, d, period, cell.status, cell.location, cell.duty, now);
			});
		}
	});
});

seedAll();
console.log('Seeded admin@example.com (password: changeme-admin) and 9 sample rota users (password: changeme).');
