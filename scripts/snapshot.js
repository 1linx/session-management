/**
 * Capture the current database's users and staffing rules as seed data.
 * After setting everything up through the UI, run this to make it the
 * default data set for future (re)seeds — scripts/seed.js prefers
 * scripts/seed-data.json over its built-in sample data.
 *
 * Rota entries are deliberately NOT captured: weeks start empty and get
 * bootstrapped with "Use default values" / "Copy previous week".
 *
 * Usage: node scripts/snapshot.js                  (passwords not captured;
 *                                                   reseeded users get 'changeme')
 *        node scripts/snapshot.js --with-passwords (capture password hashes so
 *                                                   reseeds keep everyone's login)
 */
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';

const withPasswords = process.argv.includes('--with-passwords');
const dbPath = process.env.DATABASE_URL ?? 'local.db';
const outPath = 'scripts/seed-data.json';

const db = new Database(dbPath, { readonly: true });

const users = db
	.prepare(
		`SELECT name, initials, role, category, working_slots, can_work_ratho,
		        display_order, on_rota, active, password_hash
		 FROM users ORDER BY display_order, initials`
	)
	.all();

if (users.length === 0) {
	console.error(`No users in ${dbPath} — nothing to snapshot.`);
	process.exit(1);
}
if (!users.some((u) => u.role === 'admin' && u.active)) {
	console.error('Refusing to snapshot: no active admin user — you would be locked out on reseed.');
	process.exit(1);
}

const rules = db.prepare("SELECT value FROM settings WHERE key = 'rota_rules'").get();

const data = {
	generatedAt: new Date().toISOString(),
	source: dbPath,
	users: users.map((u) => ({
		name: u.name,
		initials: u.initials,
		role: u.role,
		category: u.category,
		standardSlots: JSON.parse(u.working_slots),
		canWorkRatho: Boolean(u.can_work_ratho),
		displayOrder: u.display_order,
		onRota: Boolean(u.on_rota),
		active: Boolean(u.active),
		...(withPasswords ? { passwordHash: u.password_hash } : {})
	})),
	ruleSettings: rules ? JSON.parse(rules.value) : null
};

writeFileSync(outPath, JSON.stringify(data, null, '\t') + '\n');
console.log(
	`Wrote ${outPath}: ${data.users.length} users${data.ruleSettings ? ' + staffing rules' : ' (no staffing rules configured)'}${withPasswords ? ', including password hashes' : ' — passwords NOT captured; reseeded users get "changeme"'}.`
);
