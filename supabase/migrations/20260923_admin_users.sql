create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username)),
  password_hash text not null,
  active boolean not null default true,
  must_change_password boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  token_hash text primary key,
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_sessions_user_idx on public.admin_sessions(admin_user_id);
create index if not exists admin_sessions_expiry_idx on public.admin_sessions(expires_at);

alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;

revoke all on public.admin_users from public, anon, authenticated;
revoke all on public.admin_sessions from public, anon, authenticated;

create or replace function public.admin_login(p_username text, p_password text)
returns table(token text, username text, must_change_password boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.admin_users%rowtype;
  v_token text;
  v_attempts integer;
begin
  delete from public.admin_sessions where expires_at <= now();

  select * into v_user
  from public.admin_users
  where admin_users.username = lower(trim(p_username))
  for update;

  if not found or not v_user.active or (v_user.locked_until is not null and v_user.locked_until > now()) then
    return;
  end if;

  if v_user.password_hash <> extensions.crypt(p_password, v_user.password_hash) then
    v_attempts := v_user.failed_attempts + 1;
    update public.admin_users
    set failed_attempts = v_attempts,
        locked_until = case when v_attempts >= 5 then now() + interval '15 minutes' else null end
    where id = v_user.id;
    return;
  end if;

  update public.admin_users set failed_attempts = 0, locked_until = null where id = v_user.id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.admin_sessions(token_hash, admin_user_id, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_user.id, now() + interval '12 hours');

  return query select v_token, v_user.username, v_user.must_change_password;
end;
$$;

create or replace function public.admin_validate_session(p_token text)
returns table(username text, must_change_password boolean)
language sql
security definer
stable
set search_path = public, extensions
as $$
  select u.username, u.must_change_password
  from public.admin_sessions s
  join public.admin_users u on u.id = s.admin_user_id
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now()
    and u.active;
$$;

create or replace function public.has_valid_admin_session()
returns boolean
language sql
security definer
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.admin_sessions s
    join public.admin_users u on u.id = s.admin_user_id
    where s.token_hash = encode(
      extensions.digest(
        coalesce(current_setting('request.headers', true)::json ->> 'x-admin-session', ''),
        'sha256'
      ),
      'hex'
    )
      and s.expires_at > now()
      and u.active
      and not u.must_change_password
  );
$$;

create or replace function public.admin_list_users(p_token text)
returns table(id uuid, username text, active boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from public.admin_sessions s
    join public.admin_users u on u.id = s.admin_user_id
    where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and s.expires_at > now() and u.active and not u.must_change_password
  ) then
    raise exception 'Sessão inválida';
  end if;

  return query
  select u.id, u.username, u.active, u.created_at
  from public.admin_users u
  order by u.created_at;
end;
$$;

create or replace function public.admin_create_user(p_token text, p_username text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.admin_sessions s
    join public.admin_users u on u.id = s.admin_user_id
    where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and s.expires_at > now() and u.active and not u.must_change_password
  ) then
    raise exception 'Sessão inválida';
  end if;

  if length(trim(p_username)) < 3 or trim(p_username) !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'Usuário inválido';
  end if;
  if length(p_password) < 8 then
    raise exception 'A senha precisa ter pelo menos 8 caracteres';
  end if;

  insert into public.admin_users(username, password_hash, must_change_password)
  values (lower(trim(p_username)), extensions.crypt(p_password, extensions.gen_salt('bf', 12)), true)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_change_own_password(p_token text, p_new_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
begin
  if length(p_new_password) < 8 then
    raise exception 'A senha precisa ter pelo menos 8 caracteres';
  end if;

  select s.admin_user_id into v_user_id
  from public.admin_sessions s
  join public.admin_users u on u.id = s.admin_user_id
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now() and u.active;

  if v_user_id is null then raise exception 'Sessão inválida'; end if;

  update public.admin_users
  set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
      must_change_password = false,
      failed_attempts = 0,
      locked_until = null
  where id = v_user_id;
  return true;
end;
$$;

create or replace function public.admin_logout(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from public.admin_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  return true;
end;
$$;

revoke execute on function public.admin_login(text, text) from public;
revoke execute on function public.admin_validate_session(text) from public;
revoke execute on function public.has_valid_admin_session() from public;
revoke execute on function public.admin_list_users(text) from public;
revoke execute on function public.admin_create_user(text, text, text) from public;
revoke execute on function public.admin_change_own_password(text, text) from public;
revoke execute on function public.admin_logout(text) from public;

grant execute on function public.admin_login(text, text) to anon, authenticated;
grant execute on function public.admin_validate_session(text) to anon, authenticated;
grant execute on function public.has_valid_admin_session() to anon, authenticated;
grant execute on function public.admin_list_users(text) to anon, authenticated;
grant execute on function public.admin_create_user(text, text, text) to anon, authenticated;
grant execute on function public.admin_change_own_password(text, text) to anon, authenticated;
grant execute on function public.admin_logout(text) to anon, authenticated;

insert into public.admin_users(username, password_hash, must_change_password)
values ('administrador', extensions.crypt('sde12345', extensions.gen_salt('bf', 12)), true)
on conflict (username) do nothing;

drop policy if exists "Public write media" on public.media;
drop policy if exists "Public write playlists" on public.playlists;
drop policy if exists "Public write playlist items" on public.playlist_items;
drop policy if exists "Public write tvs" on public.tvs;
drop policy if exists "Public write schedules" on public.schedules;

drop policy if exists "Admin write media" on public.media;
create policy "Admin write media" on public.media for all using (public.has_valid_admin_session()) with check (public.has_valid_admin_session());
drop policy if exists "Admin write playlists" on public.playlists;
create policy "Admin write playlists" on public.playlists for all using (public.has_valid_admin_session()) with check (public.has_valid_admin_session());
drop policy if exists "Admin write playlist items" on public.playlist_items;
create policy "Admin write playlist items" on public.playlist_items for all using (public.has_valid_admin_session()) with check (public.has_valid_admin_session());
drop policy if exists "Admin write tvs" on public.tvs;
create policy "Admin write tvs" on public.tvs for all using (public.has_valid_admin_session()) with check (public.has_valid_admin_session());
drop policy if exists "Admin write schedules" on public.schedules;
create policy "Admin write schedules" on public.schedules for all using (public.has_valid_admin_session()) with check (public.has_valid_admin_session());

drop policy if exists "Public upload TV media" on storage.objects;
drop policy if exists "Public delete TV media" on storage.objects;
drop policy if exists "Admin upload TV media" on storage.objects;
create policy "Admin upload TV media" on storage.objects for insert with check (bucket_id = 'tv-media' and public.has_valid_admin_session());
drop policy if exists "Admin delete TV media" on storage.objects;
create policy "Admin delete TV media" on storage.objects for delete using (bucket_id = 'tv-media' and public.has_valid_admin_session());
