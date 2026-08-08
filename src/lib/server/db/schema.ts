import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * People in the system. Every rota member is a user; `role` controls what
 * they can do, `category` controls which working-hours standard applies.
 *
 * Extensibility notes:
 * - `category` and `role` are plain text so new values can be added without
 *   a migration (validated at the application layer — see $lib/constants.ts).
 * - A future `groupId` column can partition the app for other user sets.
 */
export const users = sqliteTable('users', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	name: text('name').notNull(),
	/** Short label shown on the rota / spreadsheet, e.g. "DR1", "ANP2" */
	initials: text('initials').notNull(),
	/** 'admin' | 'viewer' */
	role: text('role').notNull().default('viewer'),
	/** 'doctor' | 'anp' — the working-hours category */
	category: text('category').notNull().default('doctor'),
	/**
	 * Standard availability: a JSON object mapping slot keys to the practice
	 * normally worked there, e.g. '{"1:AM":"east_calder","2:AM":"ratho"}'.
	 * Slots absent from the map are not normally worked. This is a default
	 * for populating new weeks, never a restriction.
	 */
	standardSlots: text('working_slots').notNull().default('{}'),
	/** Whether this person can be sent to Ratho when cover is needed. */
	canWorkRatho: integer('can_work_ratho', { mode: 'boolean' }).notNull().default(false),
	/** Column order on the rota and in the exported spreadsheet */
	displayOrder: integer('display_order').notNull().default(0),
	/** Whether this person appears as a column on the rota/spreadsheet
	 *  (admin-only accounts can be hidden). */
	onRota: integer('on_rota', { mode: 'boolean' }).notNull().default(true),
	/** Inactive users keep their history but drop off the rota */
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/** App-wide configuration, one JSON document per key (e.g. 'rota_rules'). */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

/** Login sessions. `id` is the SHA-256 hash of the bearer token. */
export const authSessions = sqliteTable('auth_sessions', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

/**
 * One row per person / weekday / half-day session.
 * A cell is status + location + duty ($lib/constants.ts CellValue);
 * text columns keep new statuses/locations migration-free. Missing rows
 * mean "Not working".
 */
export const scheduleEntries = sqliteTable(
	'schedule_entries',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** The week this entry belongs to: its Monday as 'YYYY-MM-DD' */
		weekStart: text('week_start').notNull(),
		/** ISO weekday: 1 = Monday … 5 = Friday */
		weekday: integer('weekday').notNull(),
		/** 'AM' (8am–1pm) | 'PM' (1pm–6pm) */
		period: text('period').notNull(),
		/** 'working' | 'not_working' | 'sick' — see $lib/constants.ts */
		status: text('status').notNull().default('not_working'),
		/** Where a working session happens, e.g. 'east_calder' | 'ratho'; null unless working */
		location: text('location'),
		/** Session role: 'duty' | 'duty_team' | 'house_visits' | null (routine) */
		role: text('role'),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [
		uniqueIndex('schedule_slot_unique').on(
			table.userId,
			table.weekStart,
			table.weekday,
			table.period
		)
	]
);
