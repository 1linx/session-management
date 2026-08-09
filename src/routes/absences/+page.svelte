<script lang="ts">
	import { categoryLabel } from '$lib/constants';
	import { weekLabel } from '$lib/dates';

	let { data } = $props();

	// "1 April 2026" from the ISO date (weekLabel includes the weekday, so trim it).
	const leaveYearLabel = $derived(weekLabel(data.leaveYear.start).replace(/^\w+ /, ''));
</script>

<svelte:head><title>Absences — Time Management</title></svelte:head>

<h1 class="mb-2 text-3xl font-black uppercase">Absences & leave</h1>
<p class="mb-8 max-w-prose">
	Totals come from sessions marked on the rota. Half a day is one session.
</p>

<section class="mb-10">
	<h2 class="mb-1 text-xl font-bold uppercase">Annual leave</h2>
	<p class="mb-3 text-sm">
		Leave year from {leaveYearLabel}. Entitlements are set per user on their settings page.
	</p>
	<div class="nb-scroll max-w-3xl">
		<table class="nb-table shadow-brutal">
			<caption class="sr-only">Annual leave taken against entitlement, current leave year</caption>
			<thead>
				<tr>
					<th scope="col">Initials</th>
					<th scope="col">Name</th>
					<th scope="col">Category</th>
					<th scope="col">Entitlement</th>
					<th scope="col">Taken</th>
					<th scope="col">Remaining</th>
				</tr>
			</thead>
			<tbody>
				{#each data.absences as member (member.id)}
					<tr>
						<td class="font-black">{member.initials}</td>
						<td>{member.name}</td>
						<td>{categoryLabel(member.category)}</td>
						<td>{member.leaveEntitlement}</td>
						<td class={member.leaveTaken > 0 ? 'font-bold' : ''}>{member.leaveTaken}</td>
						<td class={member.leaveRemaining < 0 ? 'font-bold text-red-700' : ''}>
							{member.leaveRemaining}
							{#if member.leaveRemaining < 0}
								<span class="sr-only">(over entitlement)</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<section>
	<h2 class="mb-1 text-xl font-bold uppercase">Sickness</h2>
	<p class="mb-3 text-sm">Raw totals across all weeks.</p>
	<div class="nb-scroll max-w-2xl">
		<table class="nb-table shadow-brutal">
			<caption class="sr-only">Total sickness absence per staff member</caption>
			<thead>
				<tr>
					<th scope="col">Initials</th>
					<th scope="col">Name</th>
					<th scope="col">Category</th>
					<th scope="col">Sick sessions</th>
					<th scope="col">Weeks affected</th>
				</tr>
			</thead>
			<tbody>
				{#each data.absences as member (member.id)}
					<tr>
						<td class="font-black">{member.initials}</td>
						<td>{member.name}</td>
						<td>{categoryLabel(member.category)}</td>
						<td class={member.sickSessions > 0 ? 'font-bold' : ''}>{member.sickSessions}</td>
						<td>{member.weeksAffected}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
