<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		CELL_OPTIONS,
		NOT_WORKING,
		PERIODS,
		WEEKDAYS,
		cellLabel,
		decodeCell,
		locationLabel,
		slotKey
	} from '$lib/constants';

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

	// Editable state per cell, keyed "<userId>|<weekday>:<period>". Values are
	// encoded cell keys ("working:ratho:duty"). Rebuilt whenever server data
	// changes (i.e. after a save round-trips).
	let cellValues = $state<Record<string, string>>({});
	$effect(() => {
		const next: Record<string, string> = {};
		for (const user of data.rotaUsers) {
			for (const slot of user.workingSlots) {
				next[`${user.id}|${slot}`] = data.grid[user.id]?.[slot] ?? 'not_working';
			}
		}
		cellValues = next;
	});

	const dirty = $derived(
		data.rotaUsers.some((user) =>
			user.workingSlots.some(
				(slot) =>
					(cellValues[`${user.id}|${slot}`] ?? 'not_working') !==
					(data.grid[user.id]?.[slot] ?? 'not_working')
			)
		)
	);

	// --- Status picker dialog ---
	let dialog = $state<HTMLDialogElement>();
	let picker = $state<{ cellKey: string; title: string } | null>(null);

	function openPicker(user: { id: string; initials: string }, row: (typeof rows)[number]) {
		picker = {
			cellKey: `${user.id}|${slotKey(row.day.value, row.period.value)}`,
			title: `${user.initials} — ${row.label}`
		};
		dialog?.showModal();
	}

	function choose(key: string) {
		if (picker) cellValues[picker.cellKey] = key;
		dialog?.close(); // native <dialog> returns focus to the cell button
	}

	function classesFor(key: string): string {
		const cell = decodeCell(key);
		if (!cell || cell.status !== 'working') return 'bg-white';
		return cell.location === 'ratho' ? 'bg-sky' : 'bg-mint';
	}
</script>

{#snippet cellContent(key: string)}
	{@const cell = decodeCell(key) ?? NOT_WORKING}
	{#if cell.status === 'working'}
		<span class="font-bold">{locationLabel(cell.location)}</span>
		{#if cell.duty}
			<span class="ml-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-widest text-white uppercase">
				Duty
			</span>
		{/if}
	{:else}
		<span class="text-neutral-700">Not working</span>
	{/if}
{/snippet}

<svelte:head><title>Rota — Time Management</title></svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-4">
	<h1 class="text-3xl font-black uppercase">Weekly rota</h1>
	{#if isAdmin}
		<p class="text-sm font-bold">Click a session to change it, then press Save.</p>
	{/if}
</div>

<p aria-live="polite" role="status" class="mb-4">
	{#if form?.saved && !dirty}
		<span class="inline-block border-2 border-ink bg-mint px-3 py-1 font-bold">Rota saved.</span>
	{:else if form?.message}
		<span class="inline-block border-2 border-ink bg-coral px-3 py-1 font-bold">
			{form.message}
		</span>
	{:else if dirty}
		<span class="inline-block border-2 border-ink bg-accent px-3 py-1 font-bold">
			Unsaved changes — press Save.
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
	{#if isAdmin}
		{#each data.rotaUsers as user (user.id)}
			{#each user.workingSlots as slot (slot)}
				<input
					type="hidden"
					name={`cell:${user.id}:${slot}`}
					value={cellValues[`${user.id}|${slot}`] ?? 'not_working'}
				/>
			{/each}
		{/each}
	{/if}

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
							{@const slot = slotKey(row.day.value, row.period.value)}
							{@const worksSlot = user.workingSlots.includes(slot)}
							{@const key = worksSlot ? (cellValues[`${user.id}|${slot}`] ?? 'not_working') : 'not_working'}
							<td
								class="border-2 border-ink p-0 text-center {worksSlot
									? classesFor(key)
									: 'bg-neutral-200'}"
							>
								{#if isAdmin && worksSlot}
									<button
										type="button"
										class="block w-full min-w-32 cursor-pointer px-2 py-2.5 hover:shadow-[inset_0_0_0_3px_var(--color-ink)]"
										aria-haspopup="dialog"
										aria-label={`${user.initials}, ${row.label}: ${cellLabel(decodeCell(key) ?? NOT_WORKING)}. Change status`}
										onclick={() => openPicker(user, row)}
									>
										{@render cellContent(key)}
									</button>
								{:else if worksSlot}
									<span class="block px-2 py-2.5">{@render cellContent(key)}</span>
								{:else}
									<span class="block px-2 py-2.5 text-neutral-700">
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
	<ul class="flex flex-wrap items-center gap-3 text-sm">
		<li><span class="inline-block border-2 border-ink bg-mint px-2 py-0.5 font-bold">East Calder</span></li>
		<li><span class="inline-block border-2 border-ink bg-sky px-2 py-0.5 font-bold">Ratho</span></li>
		<li>
			<span class="inline-block border-2 border-ink bg-white px-2 py-0.5 font-bold">
				<span class="mr-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-widest text-white uppercase">Duty</span>
				On duty
			</span>
		</li>
		<li><span class="inline-block border-2 border-ink bg-white px-2 py-0.5">Not working</span></li>
		<li>
			<span class="inline-block border-2 border-ink bg-neutral-200 px-2 py-0.5">
				Does not work this session
			</span>
		</li>
	</ul>
</section>

<dialog
	bind:this={dialog}
	class="m-auto w-full max-w-sm border-4 border-ink bg-paper p-0 shadow-brutal backdrop:bg-ink/60"
	onclose={() => (picker = null)}
>
	{#if picker}
		{@const current = cellValues[picker.cellKey] ?? 'not_working'}
		<div class="flex items-center justify-between gap-4 border-b-2 border-ink bg-lilac px-4 py-3">
			<h2 class="font-black uppercase">{picker.title}</h2>
			<button
				type="button"
				class="cursor-pointer border-2 border-ink bg-white px-2 py-0.5 font-bold shadow-brutal-sm"
				aria-label="Close without changing"
				onclick={() => dialog?.close()}
			>
				✕
			</button>
		</div>
		<ul class="flex flex-col gap-3 p-4">
			{#each CELL_OPTIONS as option (option.key)}
				<li>
					<button
						type="button"
						aria-pressed={current === option.key}
						class="flex w-full cursor-pointer items-center justify-between border-2 border-ink px-3 py-2 text-left font-bold shadow-brutal-sm hover:-translate-x-0.5 hover:-translate-y-0.5 {classesFor(
							option.key
						)}"
						onclick={() => choose(option.key)}
					>
						<span>
							{option.pickerLabel.replace(' — Duty', '')}
							{#if option.value.duty}
								<span class="ml-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-widest text-white uppercase">
									Duty
								</span>
							{/if}
						</span>
						{#if current === option.key}
							<span class="text-xs uppercase">✓ Current</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</dialog>
