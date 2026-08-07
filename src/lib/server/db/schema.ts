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
	 * The half-day sessions this person works at all, stored as a JSON
	 * array of "<ISO weekday>:<period>" keys (1 = Monday … 5 = Friday),
	 * e.g. '["1:AM","1:PM","2:AM"]' for Monday all day plus Tuesday
	 * morning. Sessions can only be scheduled on these slots; all other
	 * slots are always "Not working".
	 */
	workingSlots: text('working_slots')
		.notNull()
		.default('["1:AM","1:PM","2:AM","2:PM","3:AM","3:PM","4:AM","4:PM","5:AM","5:PM"]'),
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
		/** 'working' | 'not_working' — see $lib/constants.ts */
		status: text('status').notNull().default('not_working'),
		/** Where a working session happens, e.g. 'east_calder' | 'ratho'; null unless working */
		location: text('location'),
		/** Whether this working session carries the Duty flag */
		duty: integer('duty', { mode: 'boolean' }).notNull().default(false),
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
