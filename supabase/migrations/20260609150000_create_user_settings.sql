create table if not exists public.user_settings (
	user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
	gemini_api_key text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists "Users can manage their own settings" on public.user_settings;

create policy "Users can manage their own settings"
on public.user_settings
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
