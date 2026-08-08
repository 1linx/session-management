<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<svelte:head><title>Log in — Time Management</title></svelte:head>

<div class="mx-auto mt-16 max-w-md">
	<h1 class="mb-6 text-4xl font-black uppercase">Time Management</h1>

	<form method="POST" use:enhance class="nb-card flex flex-col gap-4">
		<h2 class="text-xl font-bold uppercase">Log in</h2>

		{#if form?.message}
			<p role="alert" class="border-2 border-ink bg-coral px-3 py-2 font-bold">
				{form.message}
			</p>
		{/if}

		<div>
			<label for="initials" class="nb-label">Initials</label>
			<input
				id="initials"
				name="initials"
				type="text"
				autocomplete="username"
				autocapitalize="characters"
				maxlength="8"
				required
				value={form?.initials ?? ''}
				class="nb-input uppercase"
			/>
		</div>

		<div>
			<label for="password" class="nb-label">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				class="nb-input"
			/>
		</div>

		<button class="nb-btn self-start">Log in</button>
	</form>
</div>
