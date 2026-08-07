<script lang="ts">
	import { enhance } from '$app/forms';
	import { PERIODS, SESSION_STATUSES, STATUS_LABELS, WEEKDAYS, slotKey } from '$lib/constants';

	let { data, form } = $props();

	const isAdmin = $derived(data.user?.role === 'admin');
	let saving = $state(false);

	// Row per weekday × period: Monday AM, Monday PM, … Friday PM.
	const rows = WEEKDAYS.flatMap((day) =>
		PERIODS.map((period) => ({
			day,
			period,
			label: `${day.label} ${period.label}`
		}))
	);

	const statusClasses: Record<string, string> = {
		working: 'bg-mint',
		working_ratho: 'bg-sky',
		not_working: 'bg-white'
	};

	function statusOf(userId: string, weekday: number, period: string): string {
		return data.grid[userId]?.[`${weekday}:${period}`] ?? 'not_working';
	}
</script>

<svelte:head><title>Rota — Time Management</title></svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-4">
	<h1 class="text-3xl font-black uppercase">Weekly rota</h1>
	{#if isAdmin}
		<p class="text-sm font-bold">Change any session below, then press Save.</p>
	{/if}
</div>

<p aria-live="polite" role="status" class="mb-4">
	{#if form?.saved}
		<span class="inline-block border-2 border-ink bg-mint px-3 py-1 font-bold">Rota saved.</span>
	{:else if form?.message}
		<span class="inline-block border-2 border-ink bg-coral px-3 py-1 font-bold">
			{form.message}
		</span>
	{/if}
</p>

<form
	method="POST"
	action="?/save"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			saving = false;
			await update({ reset: false });
		};
	}}
>
	<div class="nb-scroll border-2 border-ink bg-white shadow-brutal">
		<table class="w-full border-collapse text-sm">
			<caption class="border-b-2 border-ink bg-paper px-3 py-2 text-left font-bold">
				Sessions for all staff. AM is 8am–1pm, PM is 1pm–6pm. Greyed cells are sessions that
				person does not work.
			</caption>
			<thead>
				<tr>
					<th scope="col" class="border-2 border-ink bg-accent px-3 py-2 text-left uppercase">
						Session
					</th>
					{#each data.rotaUsers as user (user.id)}
						<th scope="col" class="border-2 border-ink bg-accent px-3 py-2 text-center">
							<span class="block text-base font-black">{user.initials}</span>
							<span class="block text-xs font-bold uppercase">
								{user.category === 'anp' ? 'ANP' : 'Doctor'}
							</span>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.label)}
					<tr>
						<th scope="row" class="border-2 border-ink bg-paper px-3 py-2 text-left whitespace-nowrap">
							{row.label}
							<span class="block text-xs font-normal">{row.period.times}</span>
						</th>
						{#each data.rotaUsers as user (user.id)}
							{@const worksSlot = user.workingSlots.includes(
								slotKey(row.day.value, row.period.value)
							)}
							{@const status = worksSlot
								? statusOf(user.id, row.day.value, row.period.value)
								: 'not_working'}
							<td
								class="border-2 border-ink p-1 text-center {worksSlot
									? statusClasses[status]
									: 'bg-neutral-200'}"
							>
								{#if isAdmin && worksSlot}
									<select
										name={`cell:${user.id}:${row.day.value}:${row.period.value}`}
										aria-label={`${user.initials}, ${row.label}`}
										class="w-full min-w-32 border-2 border-ink bg-white px-1 py-1.5"
									>
										{#each SESSION_STATUSES as option (option.value)}
											<option value={option.value} selected={option.value === status}>
												{option.label}
											</option>
										{/each}
									</select>
								{:else if worksSlot}
									<span class="block px-1 py-1 font-bold">{STATUS_LABELS[status]}</span>
								{:else}
									<span class="block px-1 py-1 text-neutral-700">
										Not working
										<span class="sr-only">(does not work this session)</span>
									</span>
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if isAdmin}
		<div class="mt-4 flex items-center gap-4">
			<button class="nb-btn" disabled={saving}>
				{saving ? 'Saving…' : 'Save rota'}
			</button>
		</div>
	{/if}
</form>

<section class="mt-8" aria-label="Key">
	<h2 class="mb-2 text-sm font-bold uppercase">Key</h2>
	<ul class="flex flex-wrap gap-3 text-sm">
		<li><span class="inline-block border-2 border-ink bg-mint px-2 py-0.5 font-bold">Working</span></li>
		<li><span class="inline-block border-2 border-ink bg-sky px-2 py-0.5 font-bold">Working (Ratho)</span></li>
		<li><span class="inline-block border-2 border-ink bg-white px-2 py-0.5">Not working</span></li>
		<li>
			<span class="inline-block border-2 border-ink bg-neutral-200 px-2 py-0.5">
				Does not work this session
			</span>
		</li>
	</ul>
</section>
