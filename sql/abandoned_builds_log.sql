-- Abandoned build history. NOT RUN YET: Jerry runs this once in the Supabase SQL editor (or asks Backend 2 to run it) before the collector change is deployed.
-- Safe to run twice (IF NOT EXISTS / OR REPLACE). Nothing here deletes or changes any existing table.

create table if not exists public.abandoned_builds_log (
  id               bigserial primary key,
  build_id         text        not null,
  parts_fingerprint text       not null,           -- same parts in any order = same fingerprint
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  times_seen       integer     not null default 1, -- repeat leaves of the same build + parts
  source           text,
  build_type       text,                            -- Front / Rear / Wheel Set
  riding_style     text,
  curated          boolean     not null default false,
  quick_goal       text,
  quick_material   text,
  subtotal_cents   integer,                         -- latest subtotal seen
  visitor_kind     text,                            -- logged_in / anonymous / unknown
  visitor_key      text,                            -- one-way hash; NO email, name or customer id
  device           text,                            -- phone / tablet / desktop / unknown
  components       jsonb       not null default '{}'::jsonb,   -- { front: [{type,name}], rear: [...] }
  -- filled by later steps (builder change adds prices and lead time; order matching sets purchased_*)
  part_prices      jsonb,
  lead_time_label  text,
  purchased_order  text,
  purchased_at     timestamptz,
  unique (build_id, parts_fingerprint)
);

create index if not exists abandoned_builds_log_last_seen_idx on public.abandoned_builds_log (last_seen desc);
create index if not exists abandoned_builds_log_build_idx on public.abandoned_builds_log (build_id);

-- only the service role (server side) reads or writes it
alter table public.abandoned_builds_log enable row level security;

create or replace function public.log_abandoned_build(
  p_build_id text, p_parts_fingerprint text, p_captured_at timestamptz, p_source text, p_build_type text, p_riding_style text,
  p_curated boolean, p_quick_goal text, p_quick_material text, p_subtotal_cents integer, p_visitor_kind text, p_visitor_key text,
  p_device text, p_components jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.abandoned_builds_log
    (build_id, parts_fingerprint, first_seen, last_seen, source, build_type, riding_style, curated, quick_goal, quick_material,
     subtotal_cents, visitor_kind, visitor_key, device, components)
  values
    (p_build_id, p_parts_fingerprint, coalesce(p_captured_at, now()), coalesce(p_captured_at, now()), p_source, p_build_type, p_riding_style,
     coalesce(p_curated, false), p_quick_goal, p_quick_material, p_subtotal_cents, p_visitor_kind, p_visitor_key, p_device, coalesce(p_components, '{}'::jsonb))
  on conflict (build_id, parts_fingerprint) do update set
    last_seen      = greatest(public.abandoned_builds_log.last_seen, excluded.last_seen),
    times_seen     = public.abandoned_builds_log.times_seen + 1,
    subtotal_cents = coalesce(excluded.subtotal_cents, public.abandoned_builds_log.subtotal_cents),
    device         = coalesce(excluded.device, public.abandoned_builds_log.device);
$$;

revoke all on function public.log_abandoned_build(text, text, timestamptz, text, text, text, boolean, text, text, integer, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_abandoned_build(text, text, timestamptz, text, text, text, boolean, text, text, integer, text, text, text, jsonb) to service_role;
