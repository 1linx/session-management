<script lang="ts">
	import { tick } from 'svelte';
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
			canWorkRatho: u.canWorkRatho,
			dutyExempt: { AM: u.dutyExemptAm, PM: u.dutyExemptPm },
			standardSlots: u.standardSlots
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
	const problemCounts = $derived.by(() => {
		let errors = 0;
		let warnings = 0;
		for (const row of problemSlots) {
			for (const problem of problems[row.slot] ?? []) {
				if (problem.severity === 'error') errors += 1;
				else warnings += 1;
			}
		}
		return { errors, warnings };
	});

	// --- Auto fix: runs in the browser on the grid as shown (including any
	// unsaved edits). Applies results as unsaved edits, so the normal
	// "Unsaved changes — press Save" flow takes over for review + persist.
	let autofixChanges = $state<string[] | null>(null);
	$effect(() => {
		// A new week's data invalidates any previous auto-fix report.
		void data.week;
		autofixChanges = null;
		filledFrom = null;
	});

	// Empty-week bootstraps: fill the grid as unsaved edits — nothing is
	// stored until the admin presses Save.
	let filledFrom = $state<'defaults' | 'defaults-autofix' | null>(null);

	/** Everyone Working at their usual practice, from standard availability. */
	function useDefaultValues() {
		for (const user of data.rotaUsers) {
			for (const slot of ALL_SLOTS) {
				const practice = user.standardSlots[slot];
				if (practice) cellValues[`${user.id}|${slot}`] = `working:${practice}`;
			}
		}
		filledFrom = 'defaults';
	}

	/** Defaults fill, then Auto-fix allocates duty/team/visits on top. */
	function useDefaultValuesWithAutoFix() {
		useDefaultValues();
		runAutoFix();
		filledFrom = 'defaults-autofix';
	}

	/** Clear every cell to Not working — as unsaved edits, like everything else. */
	function resetWeek() {
		if (!confirm('Clear every session this week? Nothing is stored until you press Save rota.')) {
			return;
		}
		for (const user of data.rotaUsers) {
			for (const slot of ALL_SLOTS) {
				cellValues[`${user.id}|${slot}`] = 'not_working';
			}
		}
		// Any pending auto-fix proposal or fill report no longer describes the grid.
		autofixChanges = null;
		filledFrom = null;
	}

	// On entering an empty week, offer the bootstraps in a popup (same style
	// as the cell picker). Dismissing it leaves a blank grid; the inline
	// buttons under the table remain as a fallback. The offered flag stops
	// data refreshes (saves, realtime pings) re-opening a dismissed popup,
	// and is re-armed whenever the visible week has data — so returning to
	// an empty week, or resetting this one, offers again.
	let bootstrapDialog = $state<HTMLDialogElement | null>(null);
	let bootstrapOfferedFor = $state<string | null>(null);
	$effect(() => {
		if (!isAdmin) return;
		if (!data.weekIsEmpty) {
			bootstrapOfferedFor = null;
			return;
		}
		if (bootstrapOfferedFor === data.week) return;
		bootstrapOfferedFor = data.week;
		bootstrapDialog?.showModal();
	});

	function runAutoFix() {
		const { changes } = autoFixWeek(staffForRules, currentGrid(), data.ruleSettings, {
			tallies: data.dutyTallies,
			previousDuty: data.previousDuty
		});
		for (const change of changes) {
			cellValues[`${change.userId}|${change.slot}`] = encodeCell(change.to);
		}
		const slotLabel = (slot: string) => rows.find((r) => r.slot === slot)?.label ?? slot;
		autofixChanges = changes.map((c) => `${c.initials}, ${slotLabel(c.slot)}: ${c.reason}`);
	}

	// --- Status picker dialog (two stages: pick a group, then the detail) ---
	let dialog = $state<HTMLDialogElement>();
	let dialogBody = $state<HTMLElement>();
	let picker = $state<{ cellKey: string; title: string; group: string | null } | null>(null);

	function openPicker(user: { id: string; initials: string }, row: (typeof rows)[number]) {
		picker = {
			cellKey: `${user.id}|${row.slot}`,
			title: `${user.initials} — ${row.label}`,
			group: null // stage 1: choose East Calder / Ratho / Not available
		};
		dialog?.showModal();
	}

	async function focusFirstOption() {
		await tick();
		dialogBody?.querySelector('button')?.focus();
	}

	function chooseGroup(group: string) {
		if (!picker) return;
		picker = { ...picker, group };
		focusFirstOption();
	}

	function backToGroups() {
		if (!picker) return;
		picker = { ...picker, group: null };
		focusFirstOption();
	}

	function choose(key: string) {
		if (picker) cellValues[picker.cellKey] = key;
		dialog?.close(); // native <dialog> returns focus to the cell button
	}

	/** The group the cell's current value belongs to, for the ✓ hint on stage 1. */
	function groupOf(key: string): string | undefined {
		return CELL_OPTIONS.find((o) => o.key === key)?.group;
	}

	const groupClasses: Record<string, string> = {
		'East Calder': 'bg-mint',
		Ratho: 'bg-sky',
		'Not available': 'bg-white'
	};

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
			<span class="ml-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-xxs font-bold tracking-widest text-white uppercase">
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
			<span class="ml-1 bg-ink px-1.5 py-0.5 text-xxs tracking-widest text-white">This week</span>
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
	{:else if filledFrom && dirty}
		<span class="inline-block border-2 border-ink bg-accent px-3 py-1 font-bold">
			{filledFrom === 'defaults'
				? 'Filled in from standard availability'
				: 'Filled in from standard availability and auto-fixed (changes listed below)'} as
			unsaved edits — review, then press Save.
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
		<!-- border-separate (not collapse): collapsed borders don't travel with
		     position:sticky cells, which would leave the frozen Session column
		     borderless while scrolled. Each cell owns its right/bottom edge
		     instead, which renders the same 2px grid. -->
		<table class="w-full border-separate border-spacing-0 text-sm">
			<caption class="border-b-2 border-ink bg-paper px-3 py-2 text-left font-bold">
				Sessions for all staff. AM is 8am–1pm, PM is 1pm–6pm. Greyed cells are outside that
				person's standard sessions but can still be set. Rows outlined in red break a staffing
				rule — details under the table.
			</caption>
			<thead>
				<tr>
					<th
						scope="col"
						class="sticky left-0 z-10 border-r-2 border-b-2 border-ink bg-accent px-3 py-2 text-left uppercase"
					>
						Session
					</th>
					{#each data.rotaUsers as user (user.id)}
						<th scope="col" class="border-r-2 border-b-2 border-ink bg-accent px-3 py-2 text-center">
							<span class="block text-base font-black">{user.initials}</span>
							<span class="block text-xxs font-bold uppercase">{categoryLabel(user.category)}</span>
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
							class="sticky left-0 z-10 border-r-2 border-b-2 border-ink px-3 py-2 text-left whitespace-nowrap {hasErrors
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
								class="border-r-2 border-b-2 border-ink p-0 text-center has-[button:hover]:shadow-[inset_0_0_0_3px_var(--color-ink)] {isOff &&
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
			<button type="button" class="nb-btn nb-btn-secondary" onclick={resetWeek}>
				Reset week
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
	<details class="mt-4 max-w-3xl border-2 border-ink bg-white shadow-brutal">
		<summary class="cursor-pointer px-4 py-3 font-bold uppercase select-none">
			Auto fix changes {dirty ? '(unsaved)' : ''}
			<span class="ml-2 inline-block bg-ink px-1.5 text-xxs font-bold tracking-widest text-white uppercase">
				{autofixChanges?.length}
				{autofixChanges?.length === 1 ? 'change' : 'changes'}
			</span>
		</summary>
		<ul class="list-inside list-disc border-t-2 border-ink p-4 text-sm">
			{#each autofixChanges ?? [] as change (change)}
				<li>{change}</li>
			{/each}
		</ul>
	</details>
{/if}

{#if isAdmin && data.weekIsEmpty && !dirty}
	<div class="mt-6">
		<p class="mb-2 text-sm font-bold">This week has no rota yet. Start from:</p>
		<div class="flex flex-wrap gap-3">
			<button type="button" class="nb-btn" onclick={useDefaultValues}>Use default values</button>
			<button type="button" class="nb-btn nb-btn-secondary" onclick={useDefaultValuesWithAutoFix}>
				Use default values with auto fix
			</button>
		</div>
		<p class="mt-2 max-w-prose text-sm">
			Default values mark everyone as Working at their usual practice on the sessions they
			normally work, from their user settings; "with auto fix" also allocates duty, duty team
			and house visits. Either way the grid fills as unsaved edits for you to review, then
			Save.
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
				<span class="mr-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-xxs font-bold tracking-widest text-white uppercase">Duty</span>
				Duty doctor
				<span class="mx-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-xxs font-bold tracking-widest text-white uppercase">Duty team</span>
				<span class="mr-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-xxs font-bold tracking-widest text-white uppercase">Visits</span>
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

{#if problemSlots.length > 0}
	<details class="mt-6 max-w-3xl border-2 border-ink bg-white shadow-brutal">
		<summary class="cursor-pointer px-4 py-3 font-bold uppercase select-none">
			Staffing issues this week
			{#if problemCounts.errors > 0}
				<span class="ml-2 inline-block bg-red-600 px-1.5 text-xxs font-bold tracking-widest text-white uppercase">
					{problemCounts.errors} rule{problemCounts.errors === 1 ? '' : 's'} broken
				</span>
			{/if}
			{#if problemCounts.warnings > 0}
				<span class="ml-2 inline-block bg-ink px-1.5 text-xxs font-bold tracking-widest text-white uppercase">
					{problemCounts.warnings} note{problemCounts.warnings === 1 ? '' : 's'}
				</span>
			{/if}
		</summary>
		<dl class="flex flex-col gap-3 border-t-2 border-ink p-4 text-sm">
			{#each problemSlots as row (row.slot)}
				<div>
					<dt class="font-bold">{row.label}</dt>
					{#each problems[row.slot] ?? [] as problem (problem.message)}
						<dd class="ml-4">
							{#if problem.severity === 'error'}
								<span class="mr-1 inline-block bg-red-600 px-1 text-xxs font-bold tracking-widest text-white uppercase">Rule</span>
							{:else}
								<span class="mr-1 inline-block bg-ink px-1 text-xxs font-bold tracking-widest text-white uppercase">Note</span>
							{/if}
							{problem.message}
						</dd>
					{/each}
				</div>
			{/each}
		</dl>
	</details>
{:else}
	<p class="mt-6 text-sm font-bold" role="status">✓ All staffing rules met this week.</p>
{/if}

<dialog
	bind:this={dialog}
	class="m-auto w-[min(100%-1.5rem,24rem)] border-4 border-ink bg-paper p-0 shadow-brutal backdrop:bg-ink/60"
	onclose={() => (picker = null)}
>
	{#if picker}
		{@const current = cellValues[picker.cellKey] ?? 'not_working'}
		<div class="flex items-center justify-between gap-4 border-b-2 border-ink bg-lilac px-4 py-3">
			<h2 class="font-black uppercase">
				{picker.title}
				{#if picker.group}
					<span class="block text-xs font-bold tracking-widest">{picker.group}</span>
				{/if}
			</h2>
			<button
				type="button"
				class="cursor-pointer border-2 border-ink bg-white px-2 py-0.5 font-bold shadow-brutal-sm"
				aria-label="Close without changing"
				onclick={() => dialog?.close()}
			>
				✕
			</button>
		</div>
		<div class="flex max-h-[80vh] flex-col gap-2.5 overflow-y-auto p-4" bind:this={dialogBody}>
			{#if picker.group === null}
				<h3 class="sr-only">Step 1 of 2: where are they?</h3>
				{#each CELL_OPTION_GROUPS as group (group)}
					<button
						type="button"
						class="flex w-full cursor-pointer items-center justify-between border-2 border-ink px-3 py-3 text-left font-bold shadow-brutal-sm hover:-translate-x-0.5 hover:-translate-y-0.5 {groupClasses[
							group
						] ?? 'bg-white'}"
						onclick={() => chooseGroup(group)}
					>
						<span>{group}</span>
						<span class="text-xs uppercase">
							{#if groupOf(current) === group}✓ Current ·{/if} →
						</span>
					</button>
				{/each}
			{:else}
				<h3 class="sr-only">Step 2 of 2: {picker.group} options</h3>
				<button
					type="button"
					class="mb-1 flex w-fit cursor-pointer items-center gap-1 border-2 border-ink bg-white px-2 py-1 text-xs font-bold uppercase shadow-brutal-sm"
					onclick={backToGroups}
				>
					← Back
				</button>
				{#each CELL_OPTIONS.filter((o) => o.group === picker?.group) as option (option.key)}
					<button
						type="button"
						aria-pressed={current === option.key}
						class="flex w-full cursor-pointer items-center justify-between border-2 border-ink px-3 py-2.5 text-left font-bold shadow-brutal-sm hover:-translate-x-0.5 hover:-translate-y-0.5 {classesFor(
							option.key
						)}"
						onclick={() => choose(option.key)}
					>
						<span>
							{option.pickerLabel}
							{#if option.value.role}
								<span class="ml-1 inline-block bg-ink px-1.5 py-0.5 align-middle text-xxs font-bold tracking-widest text-white uppercase">
									{roleChip(option.value.role)}
								</span>
							{/if}
						</span>
						{#if current === option.key}
							<span class="text-xs uppercase">✓ Current</span>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</dialog>

<!-- Empty-week bootstrap: offered once per empty week. Both choices fill
     the grid as unsaved edits — nothing is stored until Save. -->
<dialog
	bind:this={bootstrapDialog}
	class="m-auto w-[min(100%-1.5rem,26rem)] border-4 border-ink bg-paper p-0 shadow-brutal backdrop:bg-ink/60"
>
	<div class="flex items-center justify-between gap-4 border-b-2 border-ink bg-lilac px-4 py-3">
		<h2 class="font-black uppercase">
			Start this week
			<span class="block text-xs font-bold tracking-widest">No sessions set yet</span>
		</h2>
		<button
			type="button"
			class="cursor-pointer border-2 border-ink bg-white px-2 py-0.5 font-bold shadow-brutal-sm"
			aria-label="Close and start from a blank grid"
			onclick={() => bootstrapDialog?.close()}
		>
			✕
		</button>
	</div>
	<div class="flex flex-col gap-2.5 p-4">
		<button
			type="button"
			class="w-full cursor-pointer border-2 border-ink bg-mint px-3 py-3 text-left font-bold shadow-brutal-sm hover:-translate-x-0.5 hover:-translate-y-0.5"
			onclick={() => {
				useDefaultValues();
				bootstrapDialog?.close();
			}}
		>
			Use default values
			<span class="block text-xs font-normal">
				Everyone Working at their usual practice, from their user settings.
			</span>
		</button>
		<button
			type="button"
			class="w-full cursor-pointer border-2 border-ink bg-accent px-3 py-3 text-left font-bold shadow-brutal-sm hover:-translate-x-0.5 hover:-translate-y-0.5"
			onclick={() => {
				useDefaultValuesWithAutoFix();
				bootstrapDialog?.close();
			}}
		>
			Use default values with auto fix
			<span class="block text-xs font-normal">
				As above, then Auto-fix allocates duty, duty team and house visits.
			</span>
		</button>
		<p class="text-xs">Nothing is saved until you press Save rota — or close this to start blank.</p>
	</div>
</dialog>
