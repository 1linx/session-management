<script lang="ts">
	import { categoryLabel } from '$lib/constants';

	let { data } = $props();
</script>

<svelte:head><title>Absences — Time Management</title></svelte:head>

<h1 class="mb-2 text-3xl font-black uppercase">Sickness absences</h1>
<p class="mb-6 max-w-prose">
	Sessions marked “Off sick” on the rota, totalled per staff member across all weeks. Half a day
	is one session. (Annual leave tracking is planned separately.)
</p>

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
