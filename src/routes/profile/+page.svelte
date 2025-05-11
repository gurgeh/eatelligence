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
    unsubscribe = authStore.subscribe(state => {
      if (!state.user && !state.loading) {
        goto('/login');
      } else {
        currentUserEmail = state.user?.email;
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    }
  });
</script>

<div class="container mx-auto p-4 max-w-md">
  <h1 class="text-2xl font-bold mb-6 text-center">Profile</h1>

  {#if currentUserEmail}
    <div class="mb-4 p-4 bg-gray-100 rounded-md">
      <p class="text-lg">Logged in as: <span class="font-semibold">{currentUserEmail}</span></p>
    </div>
  {/if}

  {#if errorMsg}
    <div class="p-3 mb-4 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md" role="alert">
      <span class="font-medium">Error:</span> {errorMsg}
    </div>
  {/if}

  <button
    on:click={handleLogout}
    class="w-full px-4 py-2 font-semibold text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
  >
    Sign Out
  </button>

  <div class="mt-6 text-center">
    <a href="/" class="text-blue-600 hover:underline">Go to Homepage</a>
  </div>
</div>
