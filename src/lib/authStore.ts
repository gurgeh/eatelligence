import { writable } from 'svelte/store';
import { supabase } from './supabaseClient';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';

interface AuthState {
	user: User | null;
	session: Session | null;
	loading: boolean;
	error: Error | null;
}

const initialState: AuthState = {
	user: null,
	session: null,
	loading: true,
	error: null
};

const authStore = writable<AuthState>(initialState);

supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
	authStore.set({
		user: session?.user ?? null,
		session,
		loading: false,
		error: null
	});
});

export default authStore;
