<script lang="ts">
	import '../app.css';
	import authStore from '$lib/authStore';
	import { supabase } from '$lib/supabaseClient';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store'; // Import get
	import { CirclePlus, Database, Goal, CircleUserRound } from 'lucide-svelte';

	let { children } = $props();

	// Use $authStore for direct reactivity in template if possible,
	// or manage local state derived from the store.
	// For script logic, especially in onMount or $effect, ensure correct access.

	let currentAuth = $state(get(authStore)); // Initialize with current store value

	onMount(() => {
		const unsubscribeStore = authStore.subscribe(value => {
			currentAuth = value; // Update local reactive state when store changes
		});

		// Initial check, currentAuth is already initialized from store via get(authStore)
		// The $effect below will handle ongoing reactive redirection.
		// This onMount check can be an immediate one if $effect doesn't run fast enough initially.
		if (!currentAuth.loading && !currentAuth.user && $page.url.pathname !== '/login') {
			   goto('/login');
		}

		return () => {
			unsubscribeStore();
		};
	});

	// Reactive effect for navigation based on auth state
	$effect(() => {
		// currentAuth is reactively updated from the authStore subscription in onMount
		if (!currentAuth.loading && !currentAuth.user && $page.url.pathname !== '/login') {
			goto('/login');
		}
	});

	async function handleLogout() {
		try {
			const { error } = await supabase.auth.signOut();
			if (error) {
				console.error('Error signing out:', error);
				// Optionally show an error message to the user
			} else {
				// authStore will update, and the $effect above should redirect to /login
			}
		} catch (err) {
			console.error('Unexpected error signing out:', err);
		}
	}
</script>

{#if currentAuth.loading}
	<div class="flex items-center justify-center min-h-screen">
		<p class="text-xl">Loading...</p>
		<!-- Or a more sophisticated loading spinner -->
	</div>
{:else if !currentAuth.user && $page.url.pathname !== '/login'}
	<!-- This block might not be strictly necessary if the $effect handles redirection promptly -->
	<!-- It can serve as a fallback or for pages that might render briefly before redirect -->
	<div class="flex items-center justify-center min-h-screen">
		<p class="text-xl">Redirecting to login...</p>
	</div>
{:else}
	<header class="bg-gray-100 shadow-sm">
		<nav class="container mx-auto px-4 py-2 flex justify-between items-center max-w-5xl">
			<a href="/" class="text-lg font-semibold text-indigo-600 hover:text-indigo-800">Eatelligence</a>
			<div class="flex items-center space-x-1 lg:space-x-4">
				{#if currentAuth.user}
					<a href="/" title="Log" class="hover:text-indigo-600 p-2 lg:p-0 lg:flex lg:items-center" class:text-indigo-600={$page.url.pathname === '/'} class:text-gray-700={$page.url.pathname !== '/'}>
						<CirclePlus size={$page.url.pathname === '/' ? 28 : 24} />
						<span class="hidden lg:inline lg:ml-1.5" class:font-semibold={$page.url.pathname === '/'}>Log</span>
					</a>
					<a href="/food-items" title="Foods" class="hover:text-indigo-600 p-2 lg:p-0 lg:flex lg:items-center" class:text-indigo-600={$page.url.pathname === '/food-items'} class:text-gray-700={$page.url.pathname !== '/food-items'}>
						<Database size={$page.url.pathname === '/food-items' ? 28 : 24} />
						<span class="hidden lg:inline lg:ml-1.5" class:font-semibold={$page.url.pathname === '/food-items'}>Foods</span>
					</a>
					<a href="/settings/targets" title="Targets" class="hover:text-indigo-600 p-2 lg:p-0 lg:flex lg:items-center" class:text-indigo-600={$page.url.pathname === '/settings/targets'} class:text-gray-700={$page.url.pathname !== '/settings/targets'}>
						<Goal size={$page.url.pathname === '/settings/targets' ? 28 : 24} />
						<span class="hidden lg:inline lg:ml-1.5" class:font-semibold={$page.url.pathname === '/settings/targets'}>Targets</span>
					</a>
					<a href="/profile" title="Profile" class="hover:text-indigo-600 p-2 lg:p-0 lg:flex lg:items-center" class:text-indigo-600={$page.url.pathname === '/profile'} class:text-gray-700={$page.url.pathname !== '/profile'}>
						<CircleUserRound size={$page.url.pathname === '/profile' ? 28 : 24} />
						<span class="hidden lg:inline lg:ml-1.5" class:font-semibold={$page.url.pathname === '/profile'}>Profile</span>
					</a>
				{:else}
					{#if $page.url.pathname !== '/login'}
						<a href="/login" class="text-gray-700 hover:text-indigo-600">Login</a>
					{/if}
				{/if}
			</div>
		</nav>
	</header>

	<main class="container mx-auto p-4 max-w-5xl">
		{@render children()}
	</main>
{/if}
