-- Abandoned build ORIGIN columns. NOT RUN YET: Jerry runs this once in the Supabase SQL editor BEFORE merging / deploying the collector change.
-- Safe to run twice. Nothing is deleted; existing rows keep their data (new columns stay empty / default for them).
-- Order: 1) run this file  2) merge the pull request  3) redeploy. The new function still accepts the OLD collector's call (new parameters have defaults),
-- so nothing breaks between step 1 and step 2.
begin;

alter table public.abandoned_builds_log add column if not exists origin_kind    text    not null default 'unknown';  -- scratch / preset / precfg_link / curated / share / resume / saved / cart_edit / unknown (old theme)
alter table public.abandoned_builds_log add column if not exists origin_ref     text;                              -- preset family or preconfigured build title
alter table public.abandoned_builds_log add column if not exists origin_entry   text;                              -- step2 / step3 (where the landing put the visitor)
alter table public.abandoned_builds_log add column if not exists origin_changed boolean;                           -- parts changed since landing (null = unknown)
alter table public.abandoned_builds_log add column if not exists added_to_cart  boolean not null default false;    -- the build went into the cart (not an abandonment)
alter table public.abandoned_builds_log add column if not exists automation     boolean not null default false;    -- navigator.webdriver was true
alter table public.abandoned_builds_log add column if not exists test_reason    text;                              -- already there from the test filter; kept for safety

-- The old 16-parameter function is replaced (a second function with the same name would make PostgREST refuse the call as ambiguous).
drop function if exists public.log_abandoned_build(text, text, timestamptz, text, text, text, boolean, text, text, integer, text, text, text, jsonb, boolean, text);

create or replace function public.log_abandoned_build(
  p_build_id text, p_parts_fingerprint text, p_captured_at timestamptz, p_source text, p_build_type text, p_riding_style text,
  p_curated boolean, p_quick_goal text, p_quick_material text, p_subtotal_cents integer, p_visitor_kind text, p_visitor_key text,
  p_device text, p_components jsonb, p_is_test boolean default false, p_test_reason text default null,
  p_origin_kind text default 'unknown', p_origin_ref text default null, p_origin_entry text default null, p_origin_changed boolean default null,
  p_added_to_cart boolean default false, p_automation boolean default false
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.abandoned_builds_log
    (build_id, parts_fingerprint, first_seen, last_seen, source, build_type, riding_style, curated, quick_goal, quick_material,
     subtotal_cents, visitor_kind, visitor_key, device, components, is_test, test_reason,
     origin_kind, origin_ref, origin_entry, origin_changed, added_to_cart, automation)
  values
    (p_build_id, p_parts_fingerprint, coalesce(p_captured_at, now()), coalesce(p_captured_at, now()), p_source, p_build_type, p_riding_style,
     coalesce(p_curated, false), p_quick_goal, p_quick_material, p_subtotal_cents, p_visitor_kind, p_visitor_key, p_device, coalesce(p_components, '{}'::jsonb), coalesce(p_is_test, false), p_test_reason,
     coalesce(p_origin_kind, 'unknown'), p_origin_ref, p_origin_entry, p_origin_changed, coalesce(p_added_to_cart, false), coalesce(p_automation, false))
  on conflict (build_id, parts_fingerprint) do update set
    last_seen      = greatest(public.abandoned_builds_log.last_seen, excluded.last_seen),
    times_seen     = public.abandoned_builds_log.times_seen + 1,
    subtotal_cents = coalesce(excluded.subtotal_cents, public.abandoned_builds_log.subtotal_cents),
    device         = coalesce(excluded.device, public.abandoned_builds_log.device),
    is_test        = (public.abandoned_builds_log.is_test and excluded.is_test) or coalesce(public.abandoned_builds_log.test_reason like 'pattern:%', false),   -- once seen as a real visitor, it stays real; a flag from the daily pattern check stays
    origin_kind    = case when public.abandoned_builds_log.origin_kind = 'unknown' then excluded.origin_kind else public.abandoned_builds_log.origin_kind end,
    origin_ref     = coalesce(public.abandoned_builds_log.origin_ref, excluded.origin_ref),
    origin_entry   = coalesce(public.abandoned_builds_log.origin_entry, excluded.origin_entry),
    origin_changed = coalesce(excluded.origin_changed, public.abandoned_builds_log.origin_changed),
    added_to_cart  = public.abandoned_builds_log.added_to_cart or excluded.added_to_cart,   -- a later leave into the cart sticks
    automation     = public.abandoned_builds_log.automation or excluded.automation;
$$;

revoke all on function public.log_abandoned_build(text, text, timestamptz, text, text, text, boolean, text, text, integer, text, text, text, jsonb, boolean, text, text, text, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.log_abandoned_build(text, text, timestamptz, text, text, text, boolean, text, text, integer, text, text, text, jsonb, boolean, text, text, text, text, boolean, boolean, boolean) to service_role;

commit;
