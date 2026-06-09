<script lang="ts">
	import '../app.css';
	import authStore from '$lib/authStore';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store'; // Import get
	import { CirclePlus, Database, Goal, CircleUserRound, Salad } from 'lucide-svelte';

	let { children } = $props();

	let currentAuth = $state(get(authStore));

	onMount(() => {
		const unsubscribeStore = authStore.subscribe((value) => {
			currentAuth = value;
		});
		return () => unsubscribeStore();
	});

	$effect(() => {
		const isOAuthCallback =
			$page.url.searchParams.has('code') || $page.url.hash.includes('access_token');
		if (
			!currentAuth.loading &&
			!currentAuth.user &&
			$page.url.pathname !== '/login' &&
			!isOAuthCallback
		) {
			goto('/login');
		}
	});
</script>

{#if currentAuth.loading}
	<div class="flex min-h-screen items-center justify-center">
		<p class="text-xl">Loading...</p>
		<!-- Or a more sophisticated loading spinner -->
	</div>
{:else if !currentAuth.user && $page.url.pathname !== '/login'}
	<div class="flex min-h-screen items-center justify-center">
		<p class="text-xl">Redirecting to login...</p>
	</div>
{:else}
	<header class="sticky top-0 z-30 border-b border-gray-200 bg-white/85 backdrop-blur">
		<nav class="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5">
			<a
				href="/"
				class="flex items-center gap-2 text-lg font-extrabold tracking-tight text-indigo-600"
			>
				<span
					class="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm"
				>
					<Salad size={18} />
				</span>
				Eatelligence
			</a>
			<div class="flex items-center gap-0.5 lg:gap-1">
				{#if currentAuth.user}
					<a
						href="/"
						title="Log"
						class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors"
						class:bg-indigo-50={$page.url.pathname === '/'}
						class:text-indigo-700={$page.url.pathname === '/'}
						class:text-gray-600={$page.url.pathname !== '/'}
						class:hover:bg-gray-100={$page.url.pathname !== '/'}
					>
						<CirclePlus size={20} />
						<span class="hidden lg:inline">Log</span>
					</a>
					<a
						href="/food-items"
						title="Foods"
						class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors"
						class:bg-indigo-50={$page.url.pathname === '/food-items'}
						class:text-indigo-700={$page.url.pathname === '/food-items'}
						class:text-gray-600={$page.url.pathname !== '/food-items'}
						class:hover:bg-gray-100={$page.url.pathname !== '/food-items'}
					>
						<Database size={20} />
						<span class="hidden lg:inline">Foods</span>
					</a>
					<a
						href="/settings/targets"
						title="Targets"
						class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors"
						class:bg-indigo-50={$page.url.pathname === '/settings/targets'}
						class:text-indigo-700={$page.url.pathname === '/settings/targets'}
						class:text-gray-600={$page.url.pathname !== '/settings/targets'}
						class:hover:bg-gray-100={$page.url.pathname !== '/settings/targets'}
					>
						<Goal size={20} />
						<span class="hidden lg:inline">Targets</span>
					</a>
					<a
						href="/profile"
						title="Profile"
						class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors"
						class:bg-indigo-50={$page.url.pathname === '/profile'}
						class:text-indigo-700={$page.url.pathname === '/profile'}
						class:text-gray-600={$page.url.pathname !== '/profile'}
						class:hover:bg-gray-100={$page.url.pathname !== '/profile'}
					>
						<CircleUserRound size={20} />
						<span class="hidden lg:inline">Profile</span>
					</a>
				{:else if $page.url.pathname !== '/login'}
					<a href="/login" class="text-sm font-medium text-gray-600 hover:text-indigo-600">Login</a>
				{/if}
			</div>
		</nav>
	</header>

	<main class="mx-auto max-w-5xl p-4">
		{@render children()}
	</main>
{/if}
