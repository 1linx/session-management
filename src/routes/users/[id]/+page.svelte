<script lang="ts">
	import { enhance } from '$app/forms';
	import UserForm from '$lib/components/UserForm.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>Edit {data.editUser.name} — Time Management</title></svelte:head>

<h1 class="mb-6 text-3xl font-black uppercase">Edit user: {data.editUser.name}</h1>

<UserForm
	values={form?.values ?? data.editUser}
	errorMessage={form?.message}
	submitLabel="Save changes"
	action="?/save"
/>

<section class="mt-8 max-w-2xl border-2 border-ink bg-white p-6 shadow-brutal" aria-label="Danger zone">
	<h2 class="mb-2 font-bold uppercase">Delete this user</h2>
	<p class="mb-4 text-sm">
		Permanently removes {data.editUser.name}, all their rota entries and their sickness-absence
		history. If you just want them off the rota, untick “Active” above instead.
	</p>
	<form
		method="POST"
		action="?/delete"
		use:enhance
		onsubmit={(event) => {
			if (
				!confirm(
					`Delete ${data.editUser.name} (${data.editUser.initials}) and all their rota history? This cannot be undone.`
				)
			) {
				event.preventDefault();
			}
		}}
	>
		<button class="nb-btn bg-coral">Delete user</button>
	</form>
</section>
