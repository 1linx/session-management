<script lang="ts">
	import UserForm from '$lib/components/UserForm.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>Edit {data.editUser.name} — Time Management</title></svelte:head>

<h1 class="mb-6 text-3xl font-black uppercase">Edit user: {data.editUser.name}</h1>

<UserForm
	values={form?.values ?? data.editUser}
	errorMessage={form?.message}
	submitLabel="Save changes"
/>
