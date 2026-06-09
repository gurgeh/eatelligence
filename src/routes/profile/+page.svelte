<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import authStore from '$lib/authStore';

	let errorMsg: string | null = null;
	let currentUserEmail: string | null | undefined = null;

	async function handleLogout() {
		errorMsg = null;
		try {
			const { error } = await supabase.auth.signOut();
			if (error) {
				console.error('Error signing out:', error);
				errorMsg = error.message;
			} else {
				// authStore will update and +layout.svelte will redirect to /login
				// or we can explicitly redirect here if needed after a small delay
				// For now, relying on +layout.svelte's reactivity to authStore
			}
		} catch (err) {
			console.error('Unexpected error signing out:', err);
			if (err instanceof Error) {
				errorMsg = err.message;
			} else {
				errorMsg = 'An unexpected error occurred during logout.';
			}
		}
	}

	let unsubscribe: () => void;
	onMount(() => {
		unsubscribe = authStore.subscribe((state) => {
			if (!state.user && !state.loading) {
				goto('/login');
			} else {
				currentUserEmail = state.user?.email;
			}
		});
		return () => {
			if (unsubscribe) unsubscribe();
		};
	});
</script>

<div class="container mx-auto max-w-md p-4">
	<h1 class="mb-6 text-center text-2xl font-bold">Profile</h1>

	{#if currentUserEmail}
		<div class="mb-4 rounded-md bg-gray-100 p-4">
			<p class="text-lg">Logged in as: <span class="font-semibold">{currentUserEmail}</span></p>
		</div>
	{/if}

	{#if errorMsg}
		<div
			class="mb-4 rounded-md border border-red-400 bg-red-100 p-3 text-sm text-red-700"
			role="alert"
		>
			<span class="font-medium">Error:</span>
			{errorMsg}
		</div>
	{/if}

	<button
		on:click={handleLogout}
		class="w-full rounded-md bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none"
	>
		Sign Out
	</button>

	<div class="mt-6 text-center">
		<a href="/" class="text-blue-600 hover:underline">Go to Homepage</a>
	</div>
</div>
