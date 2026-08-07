<script lang="ts">
	import { ALL_SLOTS, USER_CATEGORIES, USER_ROLES, WEEKDAYS, slotKey } from '$lib/constants';

	let { data } = $props();

	function categoryLabel(value: string): string {
		return USER_CATEGORIES.find((c) => c.value === value)?.label ?? value;
	}
	function roleLabel(value: string): string {
		return USER_ROLES.find((r) => r.value === value)?.label ?? value;
	}
	function slotsLabel(slots: string[]): string {
		if (slots.length === ALL_SLOTS.length) return 'Mon–Fri, all day';
		if (slots.length === 0) return 'None';
		const parts: string[] = [];
		for (const day of WEEKDAYS) {
			const am = slots.includes(slotKey(day.value, 'AM'));
			const pm = slots.includes(slotKey(day.value, 'PM'));
			if (!am && !pm) continue;
			const abbrev = day.label.slice(0, 3);
			parts.push(am && pm ? abbrev : `${abbrev} ${am ? 'AM' : 'PM'}`);
		}
		return parts.join(', ');
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
					<td>{slotsLabel(user.workingSlots)}</td>
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
