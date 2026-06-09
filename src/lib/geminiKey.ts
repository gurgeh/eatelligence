import { supabase } from './supabaseClient';
import { getErrorMessage } from './utils';

const STORAGE_KEY = 'geminiApiKey';
const SETTINGS_TABLE = 'user_settings';

export type GeminiKeySource = 'profile' | 'browser' | 'none';

export interface GeminiKeyResult {
	key: string;
	source: GeminiKeySource;
	profileStorageReady: boolean;
	errorMessage?: string;
}

interface UserSettingsRow {
	gemini_api_key: string | null;
}

export function loadGeminiKey(): string {
	return typeof window !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) ?? '') : '';
}

export function saveGeminiKey(key: string): void {
	if (typeof window !== 'undefined') {
		const trimmedKey = key.trim();
		if (trimmedKey) {
			localStorage.setItem(STORAGE_KEY, trimmedKey);
		} else {
			localStorage.removeItem(STORAGE_KEY);
		}
	}
}

export function clearGeminiKey(): void {
	if (typeof window !== 'undefined') {
		localStorage.removeItem(STORAGE_KEY);
	}
}

export async function loadGeminiKeyForUser(): Promise<GeminiKeyResult> {
	const browserKey = loadGeminiKey().trim();
	const fallback: GeminiKeyResult = {
		key: browserKey,
		source: browserKey ? 'browser' : 'none',
		profileStorageReady: false
	};

	if (typeof window === 'undefined') return fallback;

	try {
		const { data, error } = await supabase
			.from(SETTINGS_TABLE)
			.select('gemini_api_key')
			.maybeSingle<UserSettingsRow>();

		if (error) {
			if (isProfileStorageMissing(error)) {
				return {
					...fallback,
					errorMessage: 'Profile Gemini key storage is not set up yet.'
				};
			}
			throw error;
		}

		const profileKey = data?.gemini_api_key?.trim() ?? '';
		if (profileKey) {
			saveGeminiKey(profileKey);
			return { key: profileKey, source: 'profile', profileStorageReady: true };
		}

		return {
			key: browserKey,
			source: browserKey ? 'browser' : 'none',
			profileStorageReady: true
		};
	} catch (error) {
		return {
			...fallback,
			errorMessage: `Could not load profile Gemini key: ${getErrorMessage(error)}`
		};
	}
}

export async function saveGeminiKeyForUser(key: string): Promise<GeminiKeyResult> {
	const trimmedKey = key.trim();

	if (!trimmedKey) {
		return clearGeminiKeyForUser();
	}

	try {
		const { error } = await supabase.from(SETTINGS_TABLE).upsert(
			{
				gemini_api_key: trimmedKey,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id' }
		);

		if (error) {
			if (isProfileStorageMissing(error)) {
				saveGeminiKey(trimmedKey);
				return {
					key: trimmedKey,
					source: 'browser',
					profileStorageReady: false,
					errorMessage: 'Profile Gemini key storage is not set up yet.'
				};
			}
			throw error;
		}

		saveGeminiKey(trimmedKey);
		return { key: trimmedKey, source: 'profile', profileStorageReady: true };
	} catch (error) {
		throw new Error(`Could not save profile Gemini key: ${getErrorMessage(error)}`);
	}
}

export async function clearGeminiKeyForUser(): Promise<GeminiKeyResult> {
	try {
		const { error } = await supabase.from(SETTINGS_TABLE).upsert(
			{
				gemini_api_key: null,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id' }
		);

		if (error) {
			if (isProfileStorageMissing(error)) {
				clearGeminiKey();
				return {
					key: '',
					source: 'none',
					profileStorageReady: false,
					errorMessage: 'Profile Gemini key storage is not set up yet.'
				};
			}
			throw error;
		}

		clearGeminiKey();
		return { key: '', source: 'none', profileStorageReady: true };
	} catch (error) {
		throw new Error(`Could not clear profile Gemini key: ${getErrorMessage(error)}`);
	}
}

function isProfileStorageMissing(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;

	const maybeError = error as { code?: unknown; message?: unknown };
	const code = typeof maybeError.code === 'string' ? maybeError.code : '';
	const message = typeof maybeError.message === 'string' ? maybeError.message : '';

	return (
		code === '42P01' ||
		code === 'PGRST205' ||
		(message.includes('schema cache') && message.includes('user_settings'))
	);
}
