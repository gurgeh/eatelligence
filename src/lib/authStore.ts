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
  error: null,
};

const authStore = writable<AuthState>(initialState);

// Set initial auth state
supabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    authStore.set({ user: null, session: null, loading: false, error });
  } else {
    authStore.set({
      user: data.session?.user ?? null,
      session: data.session,
      loading: false,
      error: null,
    });
  }
});

// Listen for auth changes
supabase.auth.onAuthStateChange(
  (event: AuthChangeEvent, session: Session | null) => {
    authStore.set({
      user: session?.user ?? null,
      session,
      loading: false,
      error: null,
    });
  }
);

export default authStore;
