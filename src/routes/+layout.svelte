<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { data, children } = $props();

	const navLinks = $derived([
		{ href: '/', label: 'Rota' },
		...(data.user?.role === 'admin' ? [{ href: '/users', label: 'Users' }] : []),
		{ href: '/raw', label: 'Raw data' }
	]);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<a
	href="#main"
	class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:border-2 focus:border-ink focus:bg-accent focus:px-4 focus:py-2 focus:font-bold"
>
	Skip to main content
</a>

{#if data.user}
	<header class="border-b-2 border-ink bg-lilac">
		<div class="flex flex-wrap items-center gap-4 px-2 py-3 sm:px-3">
			<span class="text-xl font-black tracking-tight uppercase">Time Management</span>
			<nav aria-label="Main">
				<ul class="flex flex-wrap items-center gap-2">
					{#each navLinks as link (link.href)}
						<li>
							<a
								href={link.href}
								aria-current={page.url.pathname === link.href ? 'page' : undefined}
								class="inline-block border-2 border-ink px-3 py-1 text-sm font-bold uppercase {page.url
									.pathname === link.href
									? 'bg-ink text-white'
									: 'bg-white shadow-brutal-sm'}"
							>
								{link.label}
							</a>
						</li>
					{/each}
					<li>
						<a
							href="/export"
							data-sveltekit-preload-data="off"
							class="inline-block border-2 border-ink bg-mint px-3 py-1 text-sm font-bold uppercase shadow-brutal-sm"
						>
							Export .xlsx
						</a>
					</li>
				</ul>
			</nav>
			<div class="ms-auto flex items-center gap-3">
				<span class="text-sm font-bold">
					{data.user.name}
					<span class="ml-1 border-2 border-ink bg-white px-1.5 py-0.5 text-xs uppercase">
						{data.user.role}
					</span>
				</span>
				<form method="POST" action="/logout">
					<button class="nb-btn nb-btn-secondary px-3 py-1">Log out</button>
				</form>
			</div>
		</div>
	</header>
{/if}

<main id="main" class="px-2 py-6 sm:px-3">
	{@render children()}
</main>
