import { fail } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import {
	ALL_SLOTS,
	decodeCell,
	encodeCell,
	statusFromDb,
	type CellValue,
	type LocationValue,
	type SessionRole,
	type StandardSlots
} from '$lib/constants';
import { addWeeks, currentWeekStart, isISODate, mondayOf, resolveWeek } from '$lib/dates';
import { broadcastChange } from '$lib/server/realtime';
import { getRuleSettings } from '$lib/server/settings';
import { getDutyTallies, getPreviousDuty } from '$lib/server/duty-history';
import type { Actions, PageServerLoad } from './$types';

async function loadRotaUsers() {
	return db
		.select({
			id: users.id,
			name: users.name,
			initials: users.initials,
			category: users.category,
			standardSlots: users.standardSlots,
			canWorkRatho: users.canWorkRatho,
			dutyExemptAm: users.dutyExemptAm,
			dutyExemptPm: users.dutyExemptPm
		})
		.from(users)
		.where(and(eq(users.active, true), eq(users.onRota, true)))
		.orderBy(asc(users.displayOrder), asc(users.initials));
}

/** Read and strictly validate the posted target week. */
function weekFromForm(data: FormData): string | null {
	const value = data.get('week');
	if (typeof value !== 'string' || !isISODate(value) || mondayOf(value) !== value) return null;
	return value;
}

async function entriesForWeek(week: string, userIds: string[]) {
	if (userIds.length === 0) return [];
	return db
		.select()
		.from(scheduleEntries)
		.where(and(eq(scheduleEntries.weekStart, week), inArray(scheduleEntries.userId, userIds)));
}

function toCellValue(entry: {
	status: string;
	location: string | null;
	role: string | null;
}): CellValue {
	return {
		status: statusFromDb(entry.status),
		location: (entry.location as LocationValue | null) ?? null,
		role: (entry.role as SessionRole | null) ?? null
	};
}

export const load: PageServerLoad = async ({ url }) => {
	const week = resolveWeek(url.searchParams.get('week'));
	const rotaUsers = await loadRotaUsers();
	const entries = await entriesForWeek(
		week,
		rotaUsers.map((u) => u.id)
	);

	// grid[userId]["<weekday>:<period>"] = encoded cell key (e.g. "working:ratho:duty")
	const grid: Record<string, Record<string, string>> = {};
	for (const entry of entries) {
		(grid[entry.userId] ??= {})[`${entry.weekday}:${entry.period}`] = encodeCell(
			toCellValue(entry)
		);
	}

	// A week whose entries are all "Not working" counts as empty — that's
	// what "Reset week" + Save leaves behind — so the bootstrap offers
	// (popup + buttons) come back. [] is trivially all-not-working.
	const weekIsEmpty = entries.every((e) => e.status === 'not_working');

	return {
		rotaUsers: rotaUsers.map((u) => ({
			...u,
			standardSlots: JSON.parse(u.standardSlots) as StandardSlots
		})),
		grid,
		week,
		currentWeek: currentWeekStart(),
		weekIsEmpty,
		ruleSettings: await getRuleSettings(),
		// Duty-balancing context for Auto-fix: historical tallies (this week
		// excluded — the live grid supplies it) + last week's duty slots.
		dutyTallies: await getDutyTallies(week),
		previousDuty: await getPreviousDuty(week)
	};
};

async function upsertCell(userId: string, week: string, weekday: number, period: string, cell: CellValue) {
	const fields = { status: cell.status, location: cell.location, role: cell.role };
	await db
		.insert(scheduleEntries)
		.values({ userId, weekStart: week, weekday, period, ...fields })
		.onConflictDoUpdate({
			target: [
				scheduleEntries.userId,
				scheduleEntries.weekStart,
				scheduleEntries.weekday,
				scheduleEntries.period
			],
			set: { ...fields, updatedAt: new Date() }
		});
}

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') {
			return fail(403, { message: 'Only admins can edit the rota.' });
		}

		const data = await request.formData();
		const week = weekFromForm(data);
		if (!week) return fail(400, { message: 'Invalid week.' });

		const rotaUsers = await loadRotaUsers();

		for (const user of rotaUsers) {
			for (const slot of ALL_SLOTS) {
				const [weekdayRaw, period] = slot.split(':');
				const weekday = Number(weekdayRaw);
				const value = data.get(`cell:${user.id}:${weekday}:${period}`);
				if (typeof value !== 'string') continue;
				const cell = decodeCell(value);
				if (!cell) continue;
				await upsertCell(user.id, week, weekday, period, cell);
			}
		}

		broadcastChange('rota');
		return { saved: true };
	},

	// "Use default values" (with or without auto fix) is client-side: it
	// fills the grid as unsaved edits, so the admin reviews and Saves
	// manually.
};
