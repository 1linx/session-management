<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Raw data — Time Management</title></svelte:head>

<h1 class="mb-6 text-3xl font-black uppercase">Raw stored data</h1>
<p class="mb-8 max-w-prose">
	Unprocessed contents of the database, for checking what is actually stored. Password hashes are
	never shown.
</p>

<section class="mb-10">
	<h2 class="mb-3 text-xl font-bold uppercase">users ({data.rawUsers.length})</h2>
	<div class="nb-scroll">
		<table class="nb-table shadow-brutal">
			<thead>
				<tr>
					<th scope="col">id</th>
					<th scope="col">email</th>
					<th scope="col">name</th>
					<th scope="col">initials</th>
					<th scope="col">role</th>
					<th scope="col">category</th>
					<th scope="col">working_slots</th>
					<th scope="col">display_order</th>
					<th scope="col">active</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rawUsers as user (user.id)}
					<tr>
						<td class="font-mono text-xs">{user.id}</td>
						<td>{user.email}</td>
						<td>{user.name}</td>
						<td>{user.initials}</td>
						<td>{user.role}</td>
						<td>{user.category}</td>
						<td class="font-mono">{user.workingSlots}</td>
						<td>{user.displayOrder}</td>
						<td>{user.active}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<section>
	<h2 class="mb-3 text-xl font-bold uppercase">schedule_entries ({data.rawEntries.length})</h2>
	<div class="nb-scroll">
		<table class="nb-table shadow-brutal">
			<thead>
				<tr>
					<th scope="col">id</th>
					<th scope="col">user</th>
					<th scope="col">weekday</th>
					<th scope="col">period</th>
					<th scope="col">status</th>
					<th scope="col">location</th>
					<th scope="col">duty</th>
					<th scope="col">updated_at</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rawEntries as entry (entry.id)}
					<tr>
						<td class="font-mono text-xs">{entry.id}</td>
						<td>{entry.initials}</td>
						<td>{entry.weekday}</td>
						<td>{entry.period}</td>
						<td class="font-mono">{entry.status}</td>
						<td class="font-mono">{entry.location ?? 'null'}</td>
						<td>{entry.duty}</td>
						<td>{entry.updatedAt.toISOString()}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
