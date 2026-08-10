<script lang="ts">
	import { enhance } from '$app/forms';
	import { PERIODS, WEEKDAYS, slotKey } from '$lib/constants';

	let { data, form } = $props();
</script>

<svelte:head><title>Staffing rules — Time Management</title></svelte:head>

<h1 class="mb-2 text-3xl font-black uppercase">Staffing rules</h1>
<p class="mb-6 max-w-prose">
	These requirements drive the red-row warnings and the Auto-fix on the rota. The duty-doctor
	rule (exactly one GP on duty at each practice, every session) is always on. Set a count to 0
	to disable that check.
</p>

<p aria-live="polite" role="status" class="mb-4">
	{#if form?.saved}
		<span class="inline-block border-2 border-ink bg-mint px-3 py-1 font-bold">Rules saved.</span>
	{:else if form?.message}
		<span class="inline-block border-2 border-ink bg-coral px-3 py-1 font-bold">{form.message}</span>
	{/if}
</p>

<!-- reset: false — the default enhance behaviour resets inputs to their
     SSR-era defaults after saving, which visually zeroes the other sections;
     the next save would then persist those zeros (data loss). -->
<form
	method="POST"
	use:enhance={() =>
		async ({ update }) => {
			await update({ reset: false });
		}}
	class="flex max-w-4xl flex-col gap-8"
>
	<fieldset class="nb-card">
		<legend class="border-2 border-ink bg-accent px-3 py-1 font-bold uppercase shadow-brutal-sm">
			Routine clinics
		</legend>
		<p class="mb-4 text-sm">
			Minimum GPs + GP trainees who must be on routine clinics (no other role), every session.
		</p>
		<div class="grid max-w-md gap-4 sm:grid-cols-2">
			<div>
				<label for="minRoutine-ec" class="nb-label">East Calder</label>
				<input
					id="minRoutine-ec"
					name="minRoutine:east_calder"
					type="number"
					min="0"
					max="50"
					value={data.ruleSettings.minRoutineClinicians.east_calder}
					class="nb-input"
				/>
			</div>
			<div>
				<label for="minRoutine-ratho" class="nb-label">Ratho</label>
				<input
					id="minRoutine-ratho"
					name="minRoutine:ratho"
					type="number"
					min="0"
					max="50"
					value={data.ruleSettings.minRoutineClinicians.ratho}
					class="nb-input"
				/>
			</div>
		</div>
	</fieldset>

	<fieldset class="nb-card">
		<legend class="border-2 border-ink bg-accent px-3 py-1 font-bold uppercase shadow-brutal-sm">
			East Calder duty team
		</legend>
		<p class="mb-4 text-sm">
			Staff required on the duty team per session. Minimum shades the row red when missed;
			desirable is a softer target. ANPs are used first, then GPs.
		</p>
		<div class="nb-scroll">
			<table class="nb-table">
				<thead>
					<tr>
						<th scope="col">Session</th>
						{#each WEEKDAYS as day (day.value)}
							<th scope="col" class="text-center">{day.label.slice(0, 3)}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each PERIODS as period (period.value)}
						{#each [{ prefix: 'dutyTeamMin', label: 'Minimum', values: data.ruleSettings.dutyTeamMin }, { prefix: 'dutyTeamDesired', label: 'Desirable', values: data.ruleSettings.dutyTeamDesired }] as kind (kind.prefix + period.value)}
							<tr>
								<th scope="row">{period.label} — {kind.label}</th>
								{#each WEEKDAYS as day (day.value)}
									{@const slot = slotKey(day.value, period.value)}
									<td class="text-center">
										<input
											type="number"
											min="0"
											max="50"
											name={`${kind.prefix}:${slot}`}
											value={kind.values[slot] ?? 0}
											aria-label={`${kind.label} duty team, ${day.label} ${period.label}`}
											class="w-16 border-2 border-ink px-1 py-1 text-center"
										/>
									</td>
								{/each}
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
	</fieldset>

	<fieldset class="nb-card">
		<legend class="border-2 border-ink bg-accent px-3 py-1 font-bold uppercase shadow-brutal-sm">
			East Calder house visits
		</legend>
		<p class="mb-4 text-sm">
			GP/trainee allocations required for house visits (12–1pm and 2–3pm) per session.
		</p>
		<div class="nb-scroll">
			<table class="nb-table">
				<thead>
					<tr>
						<th scope="col">Session</th>
						{#each WEEKDAYS as day (day.value)}
							<th scope="col" class="text-center">{day.label.slice(0, 3)}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each PERIODS as period (period.value)}
						<tr>
							<th scope="row">{period.label}</th>
							{#each WEEKDAYS as day (day.value)}
								{@const slot = slotKey(day.value, period.value)}
								<td class="text-center">
									<input
										type="number"
										min="0"
										max="50"
										name={`houseVisits:${slot}`}
										value={data.ruleSettings.houseVisitsRequired[slot] ?? 0}
										aria-label={`House visits required, ${day.label} ${period.label}`}
										class="w-16 border-2 border-ink px-1 py-1 text-center"
									/>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</fieldset>

	<div>
		<button class="nb-btn">Save rules</button>
	</div>
</form>
