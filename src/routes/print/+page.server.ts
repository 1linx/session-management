import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import { resolveWeek } from '$lib/dates';
import { statusFromDb, type CellValue, type LocationValue, type SessionRole } from '$lib/constants';
import type { PageServerLoad } from './$types';

/**
 * Print sheet — recreates the practice's paper "GP ROTA TEMPLATE":
 * GPs/trainees across the top, sessions down the side, blank cells where
 * someone works at East Calder (room for handwritten notes), grey where
 * they're unavailable, RATHO where they're at Ratho. ANPs are left off,
 * matching the paper original.
 */
export const load: PageServerLoad = async ({ url }) => {
	const week = resolveWeek(url.searchParams.get('week'));

	const staff = await db
		.select({ id: users.id, name: users.name, initials: users.initials })
		.from(users)
		.where(
			and(
				eq(users.active, true),
				eq(users.onRota, true),
				inArray(users.category, ['doctor', 'gp_trainee'])
			)
		)
		.orderBy(asc(users.displayOrder), asc(users.initials));

	const entries =
		staff.length === 0
			? []
			: await db
					.select()
					.from(scheduleEntries)
					.where(
						and(
							eq(scheduleEntries.weekStart, week),
							inArray(
								scheduleEntries.userId,
								staff.map((s) => s.id)
							)
						)
					);

	const grid: Record<string, Record<string, CellValue>> = {};
	for (const entry of entries) {
		(grid[entry.userId] ??= {})[`${entry.weekday}:${entry.period}`] = {
			status: statusFromDb(entry.status),
			location: (entry.location as LocationValue | null) ?? null,
			role: (entry.role as SessionRole | null) ?? null
		};
	}

	return { week, staff, grid };
};
