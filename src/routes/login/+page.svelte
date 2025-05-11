<script lang="ts">
  import { supabase } from '$lib/supabaseClient';
  import authStore from '$lib/authStore';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let loading = false;
  let errorMsg: string | null = null;

  async function signInWithGoogle() {
    loading = true;
    errorMsg = null;
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
      });
      if (error) {
        console.error('Error signing in with Google:', error);
        errorMsg = error.message;
      }
      // Redirect is handled by Supabase
    } catch (err) {
      console.error('Unexpected error signing in with Google:', err);
      if (err instanceof Error) {
        errorMsg = err.message;
      } else {
        errorMsg = 'An unexpected error occurred.';
      }
    } finally {
      loading = false;
    }
  }

  let unsubscribe: () => void;

  onMount(() => {
    unsubscribe = authStore.subscribe(state => {
      if (state.user && !state.loading) {
        goto('/'); // Redirect to home if user is logged in
      }
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  });
</script>

<div class="flex flex-col items-center justify-center min-h-screen p-4">
  <div class="w-full max-w-md p-8 space-y-6 bg-white rounded-lg shadow-md">
    <h1 class="text-3xl font-bold text-center text-gray-800">Welcome to Eatelligence</h1>
    <p class="text-center text-gray-600">Sign in to continue</p>

    {#if errorMsg}
      <div class="p-3 text-sm text-red-700 bg-red-100 border border-red-400 rounded-md" role="alert">
        <span class="font-medium">Error:</span> {errorMsg}
      </div>
    {/if}

    <button
      on:click={signInWithGoogle}
      disabled={loading}
      class="w-full px-4 py-2 font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
    >
      <!-- Google Icon (SVG or Font Icon can be added here) -->
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16" class="mr-2">
        <path d="M15.545 6.558a9.42 9.42 0 0 1 .139 1.626c0 2.434-.87 4.492-2.384 5.885h.002C11.978 15.292 10.158 16 8 16A8 8 0 1 1 8 0a7.689 7.689 0 0 1 5.352 2.082l-2.284 2.284A4.347 4.347 0 0 0 8 3.166c-2.087 0-3.86 1.408-4.492 3.304a4.792 4.792 0 0 0 0 3.063h.003c.635 1.893 2.405 3.301 4.492 3.301 1.078 0 2.004-.276 2.722-.764h-.003a3.702 3.702 0 0 0 1.599-2.431H8v-3.08h7.545z"/>
      </svg>
      <span>Sign in with Google</span>
      {#if loading}
        <svg class="w-5 h-5 ml-2 text-white animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      {/if}
    </button>
     <p class="text-xs text-center text-gray-500">
      By signing in, you agree to our terms and conditions.
    </p>
  </div>
</div>
