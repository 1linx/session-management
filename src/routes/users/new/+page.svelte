<script lang="ts">
	import UserForm from '$lib/components/UserForm.svelte';

	let { form } = $props();
</script>

<svelte:head><title>Add user — Time Management</title></svelte:head>

<h1 class="mb-6 text-3xl font-black uppercase">Add user</h1>

<UserForm isNew values={form?.values ?? {}} errorMessage={form?.message} submitLabel="Add user" />
