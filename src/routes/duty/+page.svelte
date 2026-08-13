<script lang="ts">
	import { PERIODS, WEEKDAYS, slotKey } from '$lib/constants';
	import { weekLabel } from '$lib/dates';

	let { data } = $props();

	const percent = (tally: number) => `${(tally * 100).toFixed(1)}%`;

	function exemptLabel(doc: { dutyExemptAm: boolean; dutyExemptPm: boolean }): string | null {
		if (doc.dutyExemptAm && doc.dutyExemptPm) return 'AM + PM';
		if (doc.dutyExemptAm) return 'AM';
		if (doc.dutyExemptPm) return 'PM';
		return null;
	}
</script>

<svelte:head><title>Duty balance — Time Management</title></svelte:head>

<h1 class="mb-2 text-3xl font-black uppercase">Duty balance</h1>
<p class="mb-6 max-w-prose">
	How duty is being spread across the GPs, over the last {data.windowDays} days (since
	{weekLabel(data.windowStart)}). Auto-fix assigns duty to the lowest tally first — the tally is
	duty sessions ÷ sessions worked, counting <strong>East Calder sessions only</strong> (Ratho
	duty falls to whoever is on site, so it would skew the balance) and counting a duty-team
	session the same as duty. Someone working twice the EC sessions is expected to carry twice
	the duty. Doctors aren't given AM and PM duty on the same day unless unavoidable, and
	near-equal tallies avoid repeating the slot a doctor held the previous week.
</p>

<section aria-label="Duty tally" class="mb-8">
	<h2 class="mb-2 text-xl font-black uppercase">Running tally</h2>
	<div class="nb-scroll max-w-3xl">
		<table class="nb-table">
			<thead>
				<tr>
					<th scope="col">GP</th>
					<th scope="col" class="text-right">EC sessions worked</th>
					<th scope="col" class="text-right">EC duty + duty team</th>
					<th scope="col" class="text-right">Duty tally</th>
					<th scope="col">Excluded from duty</th>
				</tr>
			</thead>
			<tbody>
				{#each [...data.tally].sort((a, b) => a.tally - b.tally) as doc (doc.id)}
					<tr class={doc.rathoOnly ? 'bg-sky' : ''}>
						<th scope="row">
							{doc.name}
							<span class="ml-1 border-2 border-ink bg-paper px-1 text-xs">{doc.initials}</span>
							{#if doc.rathoOnly}
								<span class="sr-only">(works Ratho sessions only)</span>
							{/if}
						</th>
						<td class="text-right tabular-nums">{doc.worked}</td>
						<td class="text-right tabular-nums">{doc.duty}</td>
						<td class="text-right font-bold tabular-nums">{percent(doc.tally)}</td>
						<td>{exemptLabel(doc) ?? '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="mt-2 max-w-prose text-sm">
		Lowest tally = next in line for duty. Only saved weeks count; the rota page's Auto-fix also
		counts the week on screen, including unsaved edits.
		<span class="mt-1 block">
			<span class="mr-1 inline-block border-2 border-ink bg-sky px-2 py-0.5 font-bold">Blue rows</span>
			work Ratho sessions only (per their standard availability), so they sit outside the
			East Calder balancing — their duty can only be the Ratho slot.
		</span>
	</p>
</section>

<section aria-label="Duty log">
	<h2 class="mb-2 text-xl font-black uppercase">Who held duty, week by week</h2>
	{#if data.dutyLog.length === 0}
		<p class="text-sm font-bold">No duty assignments saved within the window yet.</p>
	{:else}
		<div class="nb-scroll">
			<table class="nb-table whitespace-nowrap">
				<thead>
					<tr>
						<th scope="col">Week commencing</th>
						{#each WEEKDAYS as day (day.value)}
							{#each PERIODS as period (period.value)}
								<th scope="col" class="text-center">{day.label.slice(0, 3)} {period.label}</th>
							{/each}
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each data.dutyLog as week (week.weekStart)}
						<tr>
							<th scope="row">{weekLabel(week.weekStart)}</th>
							{#each WEEKDAYS as day (day.value)}
								{#each PERIODS as period (period.value)}
									{@const holders = week.slots[slotKey(day.value, period.value)] ?? []}
									<td class="text-center">
										{#each holders as holder (holder.initials + (holder.location ?? ''))}
											<span class="mr-1 inline-block font-bold">
												{holder.initials}<span class="font-normal"
													>&nbsp;({holder.location === 'ratho' ? 'R' : 'EC'})</span
												>
											</span>
										{:else}
											<span aria-label="No duty doctor recorded">—</span>
										{/each}
									</td>
								{/each}
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="mt-2 max-w-prose text-sm">
			EC = East Calder, R = Ratho. Every saved duty assignment in the window appears here — this
			is the record to answer any fairness questions.
		</p>
	{/if}
</section>
