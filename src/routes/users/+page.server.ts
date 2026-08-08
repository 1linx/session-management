import { asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const allUsers = await db
		.select({
			id: users.id,
			name: users.name,
			initials: users.initials,
			email: users.email,
			role: users.role,
			category: users.category,
			standardSlots: users.standardSlots,
			canWorkRatho: users.canWorkRatho,
			displayOrder: users.displayOrder,
			onRota: users.onRota,
			active: users.active
		})
		.from(users)
		.orderBy(asc(users.displayOrder), asc(users.initials));

	return {
		users: allUsers.map((u) => ({
			...u,
			standardSlots: JSON.parse(u.standardSlots) as Record<string, string>
		}))
	};
};
