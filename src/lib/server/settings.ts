import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { DEFAULT_RULE_SETTINGS, type RotaRuleSettings } from '$lib/rules/types';

const RULES_KEY = 'rota_rules';

/** Load the staffing-rule settings, falling back to inert defaults. */
export async function getRuleSettings(): Promise<RotaRuleSettings> {
	const [row] = await db.select().from(settings).where(eq(settings.key, RULES_KEY));
	if (!row) return structuredClone(DEFAULT_RULE_SETTINGS);
	try {
		const parsed = JSON.parse(row.value) as Partial<RotaRuleSettings>;
		return {
			minRoutineClinicians: {
				...DEFAULT_RULE_SETTINGS.minRoutineClinicians,
				...parsed.minRoutineClinicians
			},
			dutyTeamMin: parsed.dutyTeamMin ?? {},
			dutyTeamDesired: parsed.dutyTeamDesired ?? {},
			houseVisitsRequired: parsed.houseVisitsRequired ?? {}
		};
	} catch {
		return structuredClone(DEFAULT_RULE_SETTINGS);
	}
}

export async function saveRuleSettings(value: RotaRuleSettings): Promise<void> {
	await db
		.insert(settings)
		.values({ key: RULES_KEY, value: JSON.stringify(value) })
		.onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } });
}
