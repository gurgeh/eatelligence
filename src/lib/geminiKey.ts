const STORAGE_KEY = 'geminiApiKey';

export function loadGeminiKey(): string {
	return typeof window !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) ?? '') : '';
}

export function saveGeminiKey(key: string): void {
	if (typeof window !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, key);
	}
}
