-- Synthetic local compatibility schema only; this is not Supabase provider proof.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create schema extensions;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key,name text not null,statements text[] not null);
create extension pgcrypto with schema extensions;
create table auth.users (
 id uuid primary key, instance_id uuid, aud text, role text, email text,
 encrypted_password text, email_confirmed_at timestamptz, is_anonymous boolean not null default false,
 raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz
);
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt()->>'sub')::uuid
$$;
create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt()->>'role',current_user::text)
$$;
create table storage.buckets (
 id text primary key, name text not null, public boolean not null default false,
 file_size_limit bigint, allowed_mime_types text[]
);
-- Finite Storage catalog compatibility for archive source-mutation fencing.
-- This does not emulate Storage HTTP authorization or object bytes.
create table storage.objects (
 id uuid primary key default extensions.gen_random_uuid(), bucket_id text not null references storage.buckets(id),
 name text not null, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
 metadata jsonb, unique(bucket_id,name)
);
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
-- Match Supabase's public-schema defaults so migrations must revoke broad rights.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
