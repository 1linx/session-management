<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import {
		ALL_SLOTS,
		CELL_OPTIONS,
		CELL_OPTION_GROUPS,
		NOT_WORKING,
		PERIODS,
		WEEKDAYS,
		categoryLabel,
		cellLabel,
		decodeCell,
		locationLabel,
		roleChip,
		slotKey
	} from '$lib/constants';
	import { addWeeks, dayDateLabel, weekLabel } from '$lib/dates';
	import { validateWeek, slotHasErrors } from '$lib/rules/validate';
	import { autoFixWeek } from '$lib/rules/autofix';
	import { encodeCell } from '$lib/constants';
	import type { WeekGrid } from '$lib/rules/types';

	let { data, form } = $props();

	const isAdmin = $derived(data.user?.role === 'admin');
	let saving = $state(false);

	const prevWeek = $derived(addWeeks(data.week, -1));
	const nextWeek = $derived(addWeeks(data.week, 1));

	// Row per weekday × period: Monday AM, Monday PM, … Friday PM.
	const rows = WEEKDAYS.flatMap((day) =>
		PERIODS.map((period) => ({
			day,
			period,
			slot: slotKey(day.value, period.value),
			label: `${day.label} ${period.label}`
		}))
	);

	// Editable state per cell, keyed "<userId>|<weekday>:<period>". Values are
	// encoded cell keys ("working:ratho:duty"). Initialised during render so
	// the server-rendered page already shows real values, then rebuilt
	// whenever server data changes.
	function buildCellValues(): Record<string, string> {
		const next: Record<string, string> = {};
		for (const user of data.rotaUsers) {
			for (const slot of ALL_SLOTS) {
				next[`${user.id}|${slot}`] = data.grid[user.id]?.[slot] ?? 'not_working';
			}
		}
		return next;
	}
	let cellValues = $state(buildCellValues());
	$effect(() => {
		cellValues = buildCellValues();
	});

	const dirty = $derived(
		data.rotaUsers.some((user) =>
			ALL_SLOTS.some(
				(slot) =>
					(cellValues[`${user.id}|${slot}`] ?? 'not_working') !==
					(data.grid[user.id]?.[slot] ?? 'not_working')
			)
		)
	);

	beforeNavigate((navigation) => {
		if (dirty && !confirm('You have unsaved changes on this week. Discard them?')) {
			navigation.cancel();
		}
	});

	// --- Live rule validation (recomputes as cells are edited) ---
	const staffForRules = $derived(
		data.rotaUsers.map((u) => ({
			id: u.id,
			initials: u.initials,
			category: u.category,
			canWorkRatho: u.canWorkRatho
		}))
	);

	function currentGrid(): WeekGrid {
		const grid: WeekGrid = {};
		for (const user of data.rotaUsers) {
			grid[user.id] = {};
			for (const slot of ALL_SLOTS) {
				grid[user.id][slot] = decodeCell(cellValues[`${user.id}|${slot}`] ?? 'not_working') ?? {
					...NOT_WORKING
				};
			}
		}
		return grid;
	}

	const problems = $derived.by(() => validateWeek(staffForRules, currentGrid(), data.ruleSettings));
	const problemSlots = $derived(rows.filter((row) => (problems[row.slot] ?? []).length > 0));

	// --- Auto fix: runs in the browser on the grid as shown (including any
	// unsaved edits). Applies results as unsaved edits, so the normal
	// "Unsaved changes — press Save" flow takes over for review + persist.
	let autofixChanges = $state<string[] | null>(null);
	$effect(() => {
		// A new week's data invalidates any previous auto-fix report.
		void data.week;
		autofixChanges = null;
	});

	function runAutoFix() {
		const { changes } = autoFixWeek(staffForRules, currentGrid(), data.ruleSettings);
		for (const change of changes) {
			cellValues[`${change.userId}|${change.slot}`] = encodeCell(change.to);
		}
		const slotLabel = (slot: string) => rows.find((r) => r.slot === slot)?.label ?? slot;
		autofixChanges = changes.map((c) => `${c.initials}, ${slotLabel(c.slot)}: ${c.reason}`);
	}

	// --- Status picker dialog ---
	let dialog = $state<HTMLDialogElement>();
	let picker = $state<{ cellKey: string; title: string } | null>(null);

	function openPicker(user: { id: string; initials: string }, row: (typeof rows)[number]) {
		picker = {
			cellKey: `${user.id}|${row.slot}`,
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
		if (!cell) return 'bg-white';
		switch (cell.status) {
			case 'working':
				return cell.location === 'ratho' ? 'bg-sky' : 'bg-mint';
			case 'sick':
				return 'bg-coral';
			case 'annual_leave':
				return 'bg-lilac';
			case 'not_working':
				return 'bg-white';
			default:
				return 'bg-accent'; // admin work / minor surgery / special activity
		}
	}
</script>

{#snippet cellContent(key: string)}
	{@const cell = decodeCell(key) ?? NOT_WORKING}
	{#if cell.status === 'working'}
		<span class="font-bold">{locationLabel(cell.location)}</span>
		{#if cell.role}
			<span class="ml-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-widest text-white uppercase">
				{roleChip(cell.role)}
			</span>
		{/if}
	{:else if cell.status === 'not_working'}
		<span class="text-neutral-700">Not working</span>
	{:else}
		<span class="font-bold">{cellLabel(cell)}</span>
	{/if}
{/snippet}

<svelte:head><title>Rota — Time Management</title></svelte:head>

<div class="mb-4 flex flex-wrap items-center gap-4">
	<h1 class="text-3xl font-black uppercase">Weekly rota</h1>
	{#if isAdmin}
		<p class="text-sm font-bold">Click a session to change it, then press Save.</p>
	{/if}
</div>

<nav aria-label="Week" class="mb-6 flex flex-wrap items-center gap-3">
	<a href={`/?week=${prevWeek}`} class="nb-btn nb-btn-secondary px-3 py-1.5" data-sveltekit-noscroll>
		← <span class="sr-only">Previous week, </span>{weekLabel(prevWeek).replace(/^\w+ /, 'w/c ')}
	</a>
	<h2 class="border-2 border-ink bg-lilac px-4 py-1.5 font-black uppercase shadow-brutal-sm">
		Week commencing {weekLabel(data.week)}
		{#if data.week === data.currentWeek}
			<span class="ml-1 bg-ink px-1.5 py-0.5 text-[10px] tracking-widest text-white">This week</span>
		{/if}
	</h2>
	<a href={`/?week=${nextWeek}`} class="nb-btn nb-btn-secondary px-3 py-1.5" data-sveltekit-noscroll>
		<span class="sr-only">Next week, </span>{weekLabel(nextWeek).replace(/^\w+ /, 'w/c ')} →
	</a>
	{#if data.week !== data.currentWeek}
		<a href="/" class="nb-btn px-3 py-1.5" data-sveltekit-noscroll>Back to this week</a>
	{/if}
	<a
		href={`/export?week=${data.week}`}
		data-sveltekit-preload-data="off"
		class="nb-btn ms-auto bg-mint px-3 py-1.5"
	>
		Export this week (.xlsx)
	</a>
</nav>

<p aria-live="polite" role="status" class="mb-4">
	{#if form?.saved && !dirty}
		<span class="inline-block border-2 border-ink bg-mint px-3 py-1 font-bold">Rota saved.</span>
	{:else if form?.copied}
		<span class="inline-block border-2 border-ink bg-mint px-3 py-1 font-bold">
			Copied from the previous week — remember to Save any further changes.
		</span>
	{:else if form?.defaulted}
		<span class="inline-block border-2 border-ink bg-mint px-3 py-1 font-bold">
			Filled in from standard availability — remember to Save any further changes.
		</span>
	{:else if autofixChanges !== null && autofixChanges.length === 0}
		<span class="inline-block border-2 border-ink bg-accent px-3 py-1 font-bold">
			Auto fix found nothing it can change — the remaining issues need staff who aren't
			rostered, or manual changes.
		</span>
	{:else if autofixChanges !== null && !dirty}
		<span class="inline-block border-2 border-ink bg-mint px-3 py-1 font-bold">
			Auto fix applied and saved.
		</span>
	{:else if autofixChanges !== null}
		<span class="inline-block border-2 border-ink bg-accent px-3 py-1 font-bold">
			Auto fix changed {autofixChanges.length}
			session{autofixChanges.length === 1 ? '' : 's'} — review below, then press Save.
		</span>
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
	action={`?week=${data.week}&/save`}
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			saving = false;
			await update({ reset: false });
		};
	}}
>
	{#if isAdmin}
		<input type="hidden" name="week" value={data.week} />
		{#each data.rotaUsers as user (user.id)}
			{#each ALL_SLOTS as slot (slot)}
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
				Sessions for all staff. AM is 8am–1pm, PM is 1pm–6pm. Greyed cells are outside that
				person's standard sessions but can still be set. Rows outlined in red break a staffing
				rule — details under the table.
			</caption>
			<thead>
				<tr>
					<th scope="col" class="border-2 border-ink bg-accent px-3 py-2 text-left uppercase">
						Session
					</th>
					{#each data.rotaUsers as user (user.id)}
						<th scope="col" class="border-2 border-ink bg-accent px-3 py-2 text-center">
							<span class="block text-base font-black">{user.initials}</span>
							<span class="block text-xs font-bold uppercase">{categoryLabel(user.category)}</span>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.label)}
					{@const hasErrors = slotHasErrors(problems, row.slot)}
					<tr class={hasErrors ? 'rule-fail' : ''}>
						<th
							scope="row"
							class="border-2 border-ink px-3 py-2 text-left whitespace-nowrap {hasErrors
								? 'bg-coral'
								: 'bg-paper'}"
						>
							{row.label}
							{#if hasErrors}
								<span class="ml-1 font-black" aria-hidden="true">⚠</span>
								<span class="sr-only">— staffing rules not met, see issues below the table</span>
							{/if}
							<span class="block text-xs font-normal">
								{dayDateLabel(data.week, row.day.value)} · {row.period.times}
							</span>
						</th>
						{#each data.rotaUsers as user (user.id)}
							{@const isStandard = row.slot in user.standardSlots}
							{@const key = cellValues[`${user.id}|${row.slot}`] ?? 'not_working'}
							{@const isOff = (decodeCell(key) ?? NOT_WORKING).status === 'not_working'}
							<td
								class="border-2 border-ink p-0 text-center has-[button:hover]:shadow-[inset_0_0_0_3px_var(--color-ink)] {isOff &&
								!isStandard
									? 'bg-neutral-200'
									: classesFor(key)}"
							>
								{#if isAdmin}
									<button
										type="button"
										class="block h-full w-full min-w-32 cursor-pointer px-2 py-2.5"
										aria-haspopup="dialog"
										aria-label={`${user.initials}, ${row.label}: ${cellLabel(decodeCell(key) ?? NOT_WORKING)}${isStandard ? '' : ' (not a standard session)'}. Change status`}
										onclick={() => openPicker(user, row)}
									>
										{@render cellContent(key)}
									</button>
								{:else}
									<span class="block px-2 py-2.5">
										{@render cellContent(key)}
										{#if !isStandard && isOff}
											<span class="sr-only">(not a standard session)</span>
										{/if}
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
		<div class="mt-4 flex flex-wrap items-center gap-4">
			<button
				class="nb-btn disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-600 disabled:shadow-none"
				disabled={saving || !dirty}
			>
				{saving ? 'Saving…' : 'Save rota'}
			</button>
			{#if !dirty && !saving}
				<span class="text-sm text-neutral-700">No unsaved changes</span>
			{/if}
		</div>
	{/if}
</form>

{#if isAdmin && problemSlots.length > 0}
	<div class="mt-4">
		<button type="button" class="nb-btn bg-coral" onclick={runAutoFix}>
			Auto fix staffing issues
		</button>
		<span class="ml-2 text-sm">
			Best-guess reassignment of people already working. Changes appear on the grid as
			unsaved edits for you to review — nothing is stored until you press Save.
		</span>
	</div>
{/if}

{#if (autofixChanges?.length ?? 0) > 0}
	<section class="nb-card mt-4 max-w-3xl" aria-label="Auto fix changes">
		<h2 class="mb-2 font-bold uppercase">Auto fix changes {dirty ? '(unsaved)' : ''}</h2>
		<ul class="list-inside list-disc text-sm">
			{#each autofixChanges ?? [] as change (change)}
				<li>{change}</li>
			{/each}
		</ul>
	</section>
{/if}

{#if problemSlots.length > 0}
	<section class="mt-6 max-w-3xl border-2 border-ink bg-white p-4 shadow-brutal" aria-label="Staffing issues">
		<h2 class="mb-2 font-bold uppercase">Staffing issues this week</h2>
		<dl class="flex flex-col gap-3 text-sm">
			{#each problemSlots as row (row.slot)}
				<div>
					<dt class="font-bold">{row.label}</dt>
					{#each problems[row.slot] ?? [] as problem (problem.message)}
						<dd class="ml-4">
							{#if problem.severity === 'error'}
								<span class="mr-1 inline-block bg-red-600 px-1 text-[10px] font-bold tracking-widest text-white uppercase">Rule</span>
							{:else}
								<span class="mr-1 inline-block bg-ink px-1 text-[10px] font-bold tracking-widest text-white uppercase">Note</span>
							{/if}
							{problem.message}
						</dd>
					{/each}
				</div>
			{/each}
		</dl>
	</section>
{:else}
	<p class="mt-6 text-sm font-bold" role="status">✓ All staffing rules met this week.</p>
{/if}

{#if isAdmin && data.weekIsEmpty}
	<div class="mt-6">
		<p class="mb-2 text-sm font-bold">This week has no rota yet. Start from:</p>
		<div class="flex flex-wrap gap-3">
			<form method="POST" action={`?week=${data.week}&/useDefaults`} use:enhance>
				<input type="hidden" name="week" value={data.week} />
				<button class="nb-btn">Use default values</button>
			</form>
			<form method="POST" action={`?week=${data.week}&/copyWeek`} use:enhance>
				<input type="hidden" name="week" value={data.week} />
				<button class="nb-btn nb-btn-secondary">
					Copy from week commencing {weekLabel(prevWeek)}
				</button>
			</form>
		</div>
		<p class="mt-2 max-w-prose text-sm">
			Default values mark everyone as Working at their usual practice on the sessions they
			normally work, from their user settings.
		</p>
	</div>
{/if}

<section class="mt-8" aria-label="Key">
	<h2 class="mb-2 text-sm font-bold uppercase">Key</h2>
	<ul class="flex flex-wrap items-center gap-3 text-sm">
		<li><span class="inline-block border-2 border-ink bg-mint px-2 py-0.5 font-bold">East Calder</span></li>
		<li><span class="inline-block border-2 border-ink bg-sky px-2 py-0.5 font-bold">Ratho</span></li>
		<li><span class="inline-block border-2 border-ink bg-coral px-2 py-0.5 font-bold">Off sick</span></li>
		<li><span class="inline-block border-2 border-ink bg-lilac px-2 py-0.5 font-bold">Annual leave</span></li>
		<li>
			<span class="inline-block border-2 border-ink bg-accent px-2 py-0.5 font-bold">
				Admin / surgery / special
			</span>
		</li>
		<li>
			<span class="inline-block border-2 border-ink bg-white px-2 py-0.5 font-bold">
				<span class="mr-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-widest text-white uppercase">Duty</span>
				Duty doctor
				<span class="mx-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-widest text-white uppercase">Duty team</span>
				<span class="mr-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-widest text-white uppercase">Visits</span>
				House visits
			</span>
		</li>
		<li><span class="inline-block border-2 border-ink bg-white px-2 py-0.5">Not working</span></li>
		<li>
			<span class="inline-block border-2 border-ink bg-neutral-200 px-2 py-0.5">
				Not a standard session
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
		<div class="flex max-h-[80vh] flex-col gap-4 overflow-y-auto p-4">
			{#each CELL_OPTION_GROUPS as group (group)}
				<div>
					<h3 class="mb-2 text-xs font-bold tracking-widest uppercase">{group}</h3>
					<ul class="flex flex-col gap-2.5">
						{#each CELL_OPTIONS.filter((o) => o.group === group) as option (option.key)}
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
										{option.pickerLabel}
										{#if option.value.role}
											<span class="ml-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-widest text-white uppercase">
												{roleChip(option.value.role)}
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
				</div>
			{/each}
		</div>
	{/if}
</dialog>
