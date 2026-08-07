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
	INSERT INTO users (id, email, password_hash, name, initials, role, category, working_slots, display_order, on_rota, active, created_at)
	VALUES (@id, @email, @passwordHash, @name, @initials, @role, @category, @workingSlots, @displayOrder, @onRota, 1, @createdAt)
`);
const insertEntry = db.prepare(`
	INSERT INTO schedule_entries (id, user_id, weekday, period, status, updated_at)
	VALUES (?, ?, ?, ?, ?, ?)
`);

// Sample rota lifted from example.xlsx.
// Weekdays: 1 = Monday … 5 = Friday. W = working, N = not working, R = working (Ratho).
const STATUS = { W: 'working', N: 'not_working', R: 'working_ratho' };
const people = [
	{ initials: 'DR1', category: 'doctor', rota: 'WW WW WW NN NN' },
	{ initials: 'DR2', category: 'doctor', rota: 'NN WW NN WW WW' },
	{ initials: 'DR3', category: 'doctor', rota: 'WW NN WW WN NN' },
	{ initials: 'DR4', category: 'doctor', rota: 'NN WW WW WW WW' },
	{ initials: 'DR5', category: 'doctor', rota: 'RR RR RR NN NR' },
	{ initials: 'DR6', category: 'doctor', rota: 'NN NN NN RR RN' },
	{ initials: 'DR7', category: 'doctor', rota: 'WW NN WW WN NN' },
	{ initials: 'ANP1', category: 'anp', rota: 'NN WW NN WW WW' },
	{ initials: 'ANP2', category: 'anp', rota: 'WW NN WW WN NN' }
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
		workingSlots: JSON.stringify(
			[1, 2, 3, 4, 5].flatMap((d) => [`${d}:AM`, `${d}:PM`])
		),
		displayOrder: 0,
		onRota: 0,
		createdAt: now
	});

	people.forEach((p, i) => {
		const userId = randomUUID();
		const sessions = p.rota.replace(/\s+/g, ''); // 10 chars: Mon AM/PM … Fri AM/PM
		// Available slots: both halves of any day with at least one worked
		// session (mirrors the old per-day behaviour for the sample data).
		const workingSlots = [1, 2, 3, 4, 5]
			.filter((d) => sessions[(d - 1) * 2] !== 'N' || sessions[(d - 1) * 2 + 1] !== 'N')
			.flatMap((d) => [`${d}:AM`, `${d}:PM`]);
		insertUser.run({
			id: userId,
			email: `${p.initials.toLowerCase()}@example.com`,
			passwordHash: hashPassword('changeme'),
			name: p.initials,
			initials: p.initials,
			role: 'viewer',
			category: p.category,
			workingSlots: JSON.stringify(workingSlots),
			displayOrder: (i + 1) * 10,
			onRota: 1,
			createdAt: now
		});
		for (let d = 1; d <= 5; d++) {
			['AM', 'PM'].forEach((period, pi) => {
				const code = sessions[(d - 1) * 2 + pi];
				insertEntry.run(randomUUID(), userId, d, period, STATUS[code], now);
			});
		}
	});
});

seedAll();
console.log('Seeded admin@example.com (password: changeme-admin) and 9 sample rota users (password: changeme).');
