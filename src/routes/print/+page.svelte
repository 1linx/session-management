<script lang="ts">
	import { PERIODS, WEEKDAYS, slotKey, type CellValue } from '$lib/constants';
	import { weekLabel } from '$lib/dates';

	let { data } = $props();

	const rows = WEEKDAYS.flatMap((day) =>
		PERIODS.map((period) => ({
			slot: slotKey(day.value, period.value),
			day: day.label.slice(0, 3).toUpperCase(),
			period: period.value
		}))
	);

	/** "Iain McLeod" → "Dr McLeod", like the paper template's column heads. */
	const drName = (name: string) => `Dr ${name.trim().split(/\s+/).at(-1)}`;

	const blank: CellValue = { status: 'not_working', location: null, role: null };
	const cellOf = (userId: string, slot: string): CellValue => data.grid[userId]?.[slot] ?? blank;

	/** Grey = unavailable, like the paper template. */
	const isGrey = (cell: CellValue) => cell.status !== 'working';

	/** Short note printed in the cell, mirroring the template's wording. */
	function note(cell: CellValue): string {
		switch (cell.status) {
			case 'working':
				return cell.location === 'ratho' ? 'RATHO' : '';
			case 'sick':
				return 'SICK';
			case 'annual_leave':
				return 'LEAVE';
			case 'admin_work':
				return 'ADMIN';
			case 'minor_surgery':
				return 'SURGERY';
			case 'special':
				return 'SPECIAL';
			case 'public_holiday':
				return 'PUB HOL';
			default:
				return ''; // not_working: plain grey, room for notes
		}
	}

	const roleNote = (cell: CellValue) =>
		cell.status !== 'working'
			? ''
			: cell.role === 'duty'
				? 'DUTY'
				: cell.role === 'duty_team'
					? 'DUTY TEAM'
					: cell.role === 'house_visits'
						? 'VISITS'
						: '';
</script>

<svelte:head><title>Print rota — w/c {weekLabel(data.week)}</title></svelte:head>

<div class="no-print mb-4 flex flex-wrap items-center gap-3">
	<h1 class="text-xl font-black uppercase">Print sheet — week commencing {weekLabel(data.week)}</h1>
	<button type="button" class="nb-btn" onclick={() => window.print()}>Print / save as PDF</button>
	<a href={`/?week=${data.week}`} class="nb-btn nb-btn-secondary">Back to the rota</a>
	<p class="w-full max-w-prose text-sm">
		Recreates the paper GP rota: blank cells are East Calder sessions (space for notes), grey
		cells are unavailable, RATHO marks Ratho sessions. Prints landscape on one A4 page. ANPs are
		not included, matching the original.
	</p>
</div>

<table class="print-sheet">
	<thead>
		<tr>
			<th class="session-col" aria-label="Session"></th>
			{#each data.staff as person (person.id)}
				<th scope="col">{drName(person.name)}</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		{#each rows as row (row.slot)}
			<tr>
				<th scope="row" class="session-col">{row.day}<br />{row.period}</th>
				{#each data.staff as person (person.id)}
					{@const cell = cellOf(person.id, row.slot)}
					<td class={isGrey(cell) ? 'grey' : ''}>
						{#if note(cell)}<span class="note">{note(cell)}</span>{/if}
						{#if roleNote(cell)}<span class="role">{roleNote(cell)}</span>{/if}
					</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.print-sheet {
		width: 100%;
		border-collapse: collapse;
		background: #ffffff;
		table-layout: fixed;
	}
	.print-sheet th,
	.print-sheet td {
		border: 1.5px solid #000000;
		vertical-align: top;
		padding: 2px 3px;
	}
	.print-sheet thead th {
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		text-align: left;
		background: #ffffff;
		word-wrap: break-word;
	}
	.print-sheet tbody th {
		font-size: 11px;
		font-weight: 800;
		text-align: left;
		white-space: nowrap;
		background: #ffffff;
	}
	.print-sheet .session-col {
		width: 2.4rem;
	}
	.print-sheet td {
		height: 16mm;
	}
	.print-sheet td.grey {
		/* Match the template's shading; force it through when printing. */
		background: #c8c8c8;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.note {
		display: block;
		font-size: 10px;
		font-weight: 700;
	}
	.role {
		display: block;
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: #444444;
	}

	@page {
		size: A4 landscape;
		margin: 8mm;
	}
	@media print {
		/* Only the sheet itself: hide the app chrome and page padding. */
		:global(header),
		.no-print {
			display: none !important;
		}
		:global(main) {
			padding: 0 !important;
		}
		:global(body) {
			background: #ffffff !important;
		}
	}
</style>
