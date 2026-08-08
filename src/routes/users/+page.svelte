<script lang="ts">
	import { USER_ROLES, categoryLabel, locationLabel } from '$lib/constants';

	let { data } = $props();

	function roleLabel(value: string): string {
		return USER_ROLES.find((r) => r.value === value)?.label ?? value;
	}
	function slotsLabel(slots: Record<string, string>): string {
		const entries = Object.values(slots);
		if (entries.length === 0) return 'None';
		const counts = new Map<string, number>();
		for (const practice of entries) {
			counts.set(practice, (counts.get(practice) ?? 0) + 1);
		}
		const parts = [...counts.entries()].map(
			([practice, n]) => `${n} ${locationLabel(practice)}`
		);
		return `${entries.length} session${entries.length === 1 ? '' : 's'} (${parts.join(', ')})`;
	}
</script>

<svelte:head><title>Users — Time Management</title></svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-4">
	<h1 class="text-3xl font-black uppercase">Users</h1>
	<a href="/users/new" class="nb-btn">Add user</a>
</div>

<div class="nb-scroll">
	<table class="nb-table shadow-brutal">
		<caption class="sr-only">All users, in rota order</caption>
		<thead>
			<tr>
				<th scope="col">Initials</th>
				<th scope="col">Name</th>
				<th scope="col">Email</th>
				<th scope="col">Category</th>
				<th scope="col">User type</th>
				<th scope="col">Standard sessions</th>
				<th scope="col">Rota order</th>
				<th scope="col">Status</th>
				<th scope="col"><span class="sr-only">Actions</span></th>
			</tr>
		</thead>
		<tbody>
			{#each data.users as user (user.id)}
				<tr class={user.active ? '' : 'bg-neutral-200'}>
					<td class="font-black">{user.initials}</td>
					<td>{user.name}</td>
					<td>{user.email}</td>
					<td>{categoryLabel(user.category)}</td>
					<td>{roleLabel(user.role)}</td>
					<td>
						{slotsLabel(user.standardSlots)}{user.canWorkRatho ? ' · can cover Ratho' : ''}
					</td>
					<td>{user.displayOrder}</td>
					<td>
						{user.active ? 'Active' : 'Inactive'}{user.onRota ? '' : ', not on rota'}
					</td>
					<td>
						<a
							href={`/users/${user.id}`}
							class="inline-block border-2 border-ink bg-white px-2 py-0.5 text-xs font-bold uppercase shadow-brutal-sm"
						>
							Edit<span class="sr-only"> {user.name}</span>
						</a>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
