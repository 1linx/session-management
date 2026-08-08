import { fail } from '@sveltejs/kit';
import { ALL_SLOTS } from '$lib/constants';
import { getRuleSettings, saveRuleSettings } from '$lib/server/settings';
import { broadcastChange } from '$lib/server/realtime';
import type { RotaRuleSettings } from '$lib/rules/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { ruleSettings: await getRuleSettings() };
};

function readCount(data: FormData, name: string): number | null {
	const raw = String(data.get(name) ?? '0').trim();
	const value = Number(raw === '' ? 0 : raw);
	if (!Number.isInteger(value) || value < 0 || value > 50) return null;
	return value;
}

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();

		const next: RotaRuleSettings = {
			minRoutineClinicians: { east_calder: 0, ratho: 0 },
			dutyTeamMin: {},
			dutyTeamDesired: {},
			houseVisitsRequired: {}
		};

		const minEc = readCount(data, 'minRoutine:east_calder');
		const minRatho = readCount(data, 'minRoutine:ratho');
		if (minEc === null || minRatho === null) {
			return fail(400, { message: 'Counts must be whole numbers between 0 and 50.' });
		}
		next.minRoutineClinicians = { east_calder: minEc, ratho: minRatho };

		for (const slot of ALL_SLOTS) {
			const min = readCount(data, `dutyTeamMin:${slot}`);
			const desired = readCount(data, `dutyTeamDesired:${slot}`);
			const visits = readCount(data, `houseVisits:${slot}`);
			if (min === null || desired === null || visits === null) {
				return fail(400, { message: 'Counts must be whole numbers between 0 and 50.' });
			}
			if (min > 0) next.dutyTeamMin[slot] = min;
			if (desired > 0) next.dutyTeamDesired[slot] = desired;
			if (visits > 0) next.houseVisitsRequired[slot] = visits;
		}

		await saveRuleSettings(next);
		broadcastChange('rota');
		return { saved: true };
	}
};
