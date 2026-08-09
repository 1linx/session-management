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
import type { Actions, PageServerLoad } from './$types';

async function loadRotaUsers() {
	return db
		.select({
			id: users.id,
			name: users.name,
			initials: users.initials,
			category: users.category,
			standardSlots: users.standardSlots,
			canWorkRatho: users.canWorkRatho
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

	return {
		rotaUsers: rotaUsers.map((u) => ({
			...u,
			standardSlots: JSON.parse(u.standardSlots) as StandardSlots
		})),
		grid,
		week,
		currentWeek: currentWeekStart(),
		weekIsEmpty: entries.length === 0,
		ruleSettings: await getRuleSettings()
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

	/**
	 * Populate an empty week from standard availability: every session each
	 * person normally works becomes Working at their usual practice.
	 */
	useDefaults: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') {
			return fail(403, { message: 'Only admins can edit the rota.' });
		}

		const data = await request.formData();
		const week = weekFromForm(data);
		if (!week) return fail(400, { message: 'Invalid week.' });

		const rotaUsers = await loadRotaUsers();
		const existing = await entriesForWeek(
			week,
			rotaUsers.map((u) => u.id)
		);
		if (existing.length > 0) {
			return fail(400, {
				message: 'This week already has entries — defaults are only for empty weeks.'
			});
		}

		const values = rotaUsers.flatMap((user) =>
			Object.entries(JSON.parse(user.standardSlots) as StandardSlots).map(
				([slot, practice]) => {
					const [weekdayRaw, period] = slot.split(':');
					return {
						userId: user.id,
						weekStart: week,
						weekday: Number(weekdayRaw),
						period,
						status: 'working',
						location: practice ?? 'east_calder',
						role: null
					};
				}
			)
		);
		if (values.length === 0) {
			return fail(400, { message: 'No one on the rota has any standard availability set.' });
		}

		await db.insert(scheduleEntries).values(values);

		broadcastChange('rota');
		return { defaulted: true };
	},

	/** Populate an empty week from the week before it. */
	copyWeek: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') {
			return fail(403, { message: 'Only admins can edit the rota.' });
		}

		const data = await request.formData();
		const week = weekFromForm(data);
		if (!week) return fail(400, { message: 'Invalid week.' });

		const rotaUsers = await loadRotaUsers();
		const userIds = rotaUsers.map((u) => u.id);

		const existing = await entriesForWeek(week, userIds);
		if (existing.length > 0) {
			return fail(400, { message: 'This week already has entries — copy is only for empty weeks.' });
		}

		const sourceWeek = addWeeks(week, -1);
		const source = await entriesForWeek(sourceWeek, userIds);
		if (source.length === 0) {
			return fail(400, { message: 'The previous week is empty — nothing to copy.' });
		}

		await db.insert(scheduleEntries).values(
			source.map((entry) => ({
				userId: entry.userId,
				weekStart: week,
				weekday: entry.weekday,
				period: entry.period,
				status: entry.status,
				location: entry.location,
				role: entry.role
			}))
		);

		broadcastChange('rota');
		return { copied: true };
	}
};
