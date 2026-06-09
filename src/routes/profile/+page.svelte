<script lang="ts">
	import { goto } from '$app/navigation';
	import authStore from '$lib/authStore';
	import {
		clearGeminiKeyForUser,
		loadGeminiKeyForUser,
		saveGeminiKeyForUser,
		type GeminiKeyResult,
		type GeminiKeySource
	} from '$lib/geminiKey';
	import { supabase } from '$lib/supabaseClient';
	import { getErrorMessage } from '$lib/utils';
	import { Home, KeyRound, LogOut, Save, Trash2, UploadCloud } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let errorMsg: string | null = null;
	let currentUserEmail: string | null | undefined = null;
	let currentUserId: string | null = null;
	let lastLoadedUserId: string | null = null;

	let geminiApiKeyInput = '';
	let savedGeminiKey = '';
	let geminiKeySource: GeminiKeySource = 'none';
	let geminiKeyStorageReady = false;
	let geminiKeyMessage: string | null = null;
	let geminiKeyError: string | null = null;
	let isLoadingGeminiKey = false;
	let isSavingGeminiKey = false;

	function applyGeminiKeyResult(result: GeminiKeyResult) {
		savedGeminiKey = result.key;
		geminiKeySource = result.source;
		geminiKeyStorageReady = result.profileStorageReady;
		geminiKeyError = result.errorMessage ?? null;
	}

	function getGeminiKeyStatus() {
		if (geminiKeySource === 'profile') return 'Saved in profile';
		if (geminiKeySource === 'browser') return 'Saved on this device';
		return 'Not saved';
	}

	async function loadProfileGeminiKey(userId: string) {
		if (lastLoadedUserId === userId) return;
		lastLoadedUserId = userId;
		isLoadingGeminiKey = true;
		geminiKeyMessage = null;

		try {
			applyGeminiKeyResult(await loadGeminiKeyForUser());
		} catch (err: unknown) {
			geminiKeyError = getErrorMessage(err);
		} finally {
			isLoadingGeminiKey = false;
		}
	}

	async function handleSaveGeminiKey() {
		const key = geminiApiKeyInput.trim();
		if (!key) return;

		isSavingGeminiKey = true;
		geminiKeyError = null;
		geminiKeyMessage = null;

		try {
			const result = await saveGeminiKeyForUser(key);
			applyGeminiKeyResult(result);
			geminiApiKeyInput = '';
			geminiKeyMessage =
				result.source === 'profile' ? 'Gemini key saved to profile.' : 'Gemini key saved here.';
		} catch (err: unknown) {
			geminiKeyError = getErrorMessage(err);
		} finally {
			isSavingGeminiKey = false;
		}
	}

	async function handlePromoteBrowserKey() {
		if (!savedGeminiKey) return;

		isSavingGeminiKey = true;
		geminiKeyError = null;
		geminiKeyMessage = null;

		try {
			const result = await saveGeminiKeyForUser(savedGeminiKey);
			applyGeminiKeyResult(result);
			geminiKeyMessage =
				result.source === 'profile' ? 'Current browser key saved to profile.' : 'Still saved here.';
		} catch (err: unknown) {
			geminiKeyError = getErrorMessage(err);
		} finally {
			isSavingGeminiKey = false;
		}
	}

	async function handleClearGeminiKey() {
		isSavingGeminiKey = true;
		geminiKeyError = null;
		geminiKeyMessage = null;

		try {
			const result = await clearGeminiKeyForUser();
			applyGeminiKeyResult(result);
			geminiApiKeyInput = '';
			geminiKeyMessage = 'Gemini key cleared.';
		} catch (err: unknown) {
			geminiKeyError = getErrorMessage(err);
		} finally {
			isSavingGeminiKey = false;
		}
	}

	async function handleLogout() {
		errorMsg = null;
		try {
			const { error } = await supabase.auth.signOut();
			if (error) {
				console.error('Error signing out:', error);
				errorMsg = error.message;
			}
		} catch (err: unknown) {
			console.error('Unexpected error signing out:', err);
			errorMsg = getErrorMessage(err) || 'An unexpected error occurred during logout.';
		}
	}

	let unsubscribe: () => void;
	onMount(() => {
		unsubscribe = authStore.subscribe((state) => {
			if (!state.user && !state.loading) {
				goto('/login');
			} else {
				currentUserEmail = state.user?.email;
				currentUserId = state.user?.id ?? null;
				if (currentUserId) {
					loadProfileGeminiKey(currentUserId);
				}
			}
		});
		return () => {
			if (unsubscribe) unsubscribe();
		};
	});
</script>

<div class="container mx-auto max-w-2xl p-4">
	<h1 class="mb-6 text-2xl font-bold tracking-tight text-gray-900">Profile</h1>

	<div class="space-y-5">
		<section class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
			<h2 class="mb-3 text-lg font-semibold text-gray-900">Account</h2>
			{#if currentUserEmail}
				<p class="text-sm text-gray-600">
					Logged in as <span class="font-semibold text-gray-900">{currentUserEmail}</span>
				</p>
			{/if}
		</section>

		<section class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
			<div class="mb-4 flex items-center gap-2">
				<KeyRound size={20} class="text-indigo-600" />
				<h2 class="text-lg font-semibold text-gray-900">Gemini API Key</h2>
			</div>

			<div class="mb-4 rounded-md bg-gray-50 p-3 text-sm">
				<div class="flex items-center justify-between gap-3">
					<span class="text-gray-600">Status</span>
					<span
						class="font-semibold"
						class:text-green-700={geminiKeySource === 'profile'}
						class:text-yellow-700={geminiKeySource === 'browser'}
						class:text-gray-700={geminiKeySource === 'none'}
					>
						{#if isLoadingGeminiKey}
							Loading...
						{:else}
							{getGeminiKeyStatus()}
						{/if}
					</span>
				</div>
			</div>

			<div class="space-y-3">
				<div>
					<label for="gemini-profile-key" class="block text-sm font-medium text-gray-700">
						New Gemini API key
					</label>
					<input
						id="gemini-profile-key"
						type="password"
						bind:value={geminiApiKeyInput}
						autocomplete="new-password"
						placeholder="Paste replacement key"
						class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
					/>
				</div>

				<div class="flex flex-col gap-2 sm:flex-row">
					<button
						type="button"
						on:click={handleSaveGeminiKey}
						disabled={isSavingGeminiKey || !geminiApiKeyInput.trim()}
						class="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Save size={16} />
						Save Key
					</button>

					{#if geminiKeySource === 'browser' && savedGeminiKey}
						<button
							type="button"
							on:click={handlePromoteBrowserKey}
							disabled={isSavingGeminiKey || !geminiKeyStorageReady}
							class="inline-flex items-center justify-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<UploadCloud size={16} />
							Save Current Key to Profile
						</button>
					{/if}

					<button
						type="button"
						on:click={handleClearGeminiKey}
						disabled={isSavingGeminiKey || (!savedGeminiKey && geminiKeySource === 'none')}
						class="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						<Trash2 size={16} />
						Clear
					</button>
				</div>

				{#if geminiKeyMessage}
					<p class="text-sm text-green-700">{geminiKeyMessage}</p>
				{/if}

				{#if geminiKeyError}
					<p class="text-sm text-yellow-700">{geminiKeyError}</p>
				{/if}
			</div>
		</section>

		{#if errorMsg}
			<div
				class="rounded-md border border-red-400 bg-red-100 p-3 text-sm text-red-700"
				role="alert"
			>
				<span class="font-medium">Error:</span>
				{errorMsg}
			</div>
		{/if}

		<div class="flex flex-col gap-3 sm:flex-row">
			<button
				type="button"
				on:click={handleLogout}
				class="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:outline-none"
			>
				<LogOut size={18} />
				Sign Out
			</button>

			<a
				href="/"
				class="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50"
			>
				<Home size={18} />
				Go to Homepage
			</a>
		</div>
	</div>
</div>
