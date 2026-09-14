-- ============================================================
-- prodfix_50: quotation share acceptance hardening
--
-- Findings:
--   SQL-6  The quotation acceptance SECURITY DEFINER functions were
--          executable by anon and authenticated directly. They take only a
--          share link id, so anyone who had seen a link (a forwarded email,
--          any tenant staff member) could accept on the customer's behalf
--          with a fabricated name, IP and user agent, skipping the token,
--          rate limit and origin checks in the Next route.
--   INV-6  A share link stayed acceptable after the operator cancelled,
--          declined or expired the quotation, or after valid_until passed.
--   INV-4  The immutable acceptance record did not capture the prices that
--          were accepted.
--
-- What this file does:
--   1. Adds price snapshot columns to quotation_acceptances.
--   2. Creates quotation_share_assert_open, accept_quotation_share_v2 and
--      decline_quotation_share_v2. The v2 functions require the share TOKEN
--      HASH as well as the link id, refuse unless the quotation is draft or
--      sent and not past valid_until (Europe/London day, as lib/time.ts), and
--      the accept function refuses unless the locked lines and totals still
--      equal the snapshot the customer was shown. It then stores that
--      snapshot on the acceptance row it inserts, and calls the existing
--      accept_quotation_share / decline_quotation_share so automatic job
--      conversion is unchanged.
--   3. Revokes EXECUTE on every overload of the quotation share functions
--      from PUBLIC, anon and authenticated, and grants it to service_role.
--      Revoking can only narrow access.
--
-- App dependency: every caller uses the service-role client
-- (app/api/public/quotation-share/[token]/route.ts and
-- lib/quotations/publicShare.ts, both via createAdminClient). A search of
-- app/ and lib/ found no browser or user-session caller, so step 3 breaks
-- nothing in the repo. The route calls the v2 functions and, only while
-- this file is unapplied, falls back to the legacy functions after its own
-- token, status and price checks. Either deploy order works.
--
-- Live-state dependencies (not in the repo; run
-- docs/sql/diag_2026_09_14_live_state.sql first):
--   - public.accept_quotation_share(uuid, text, text) and
--     public.decline_quotation_share(uuid, text, text) exist with these
--     signatures (the 2026-08-23 migrations call accept_quotation_share
--     this way). If not, the v2 functions raise at call time and, being one
--     transaction, write nothing.
--   - quotations.valid_until is a date and quotations has status,
--     accepted_at, declined_at, converted_job_id and currency_code;
--     quotation_lines has id, quotation_id, line_number, description,
--     quantity, unit_price, vat_rate and line_total (all read by
--     lib/quotations/publicShare.ts today).
--   - If a trigger makes quotation_acceptances immutable, that is fine: this
--     file only INSERTs acceptance rows, it never updates them.
--   - If anything outside the repo (a user-session client or a SECURITY
--     INVOKER function) calls these functions directly, it will now get
--     "permission denied". That is the intended effect.
--
-- Idempotent: add column if not exists, create or replace, and a revoke and
-- grant loop that is safe to repeat.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Snapshot columns
-- ------------------------------------------------------------

alter table public.quotation_acceptances
    add column if not exists accepted_currency_code text,
    add column if not exists accepted_subtotal numeric,
    add column if not exists accepted_vat_total numeric,
    add column if not exists accepted_total numeric,
    add column if not exists accepted_lines jsonb;

comment on column public.quotation_acceptances.accepted_lines is
    'Quotation lines (id, line_number, description, quantity, unit_price, vat_rate, line_total) exactly as accepted. Written once by accept_quotation_share_v2.';

-- ------------------------------------------------------------
-- 2a. Shared state check. Messages match lib/quotations/shareStatus.ts
--     SHARE_MESSAGES so the route can show them verbatim.
-- ------------------------------------------------------------

create or replace function public.quotation_share_assert_open(
    p_quotation public.quotations,
    p_today date
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
    v_status text := lower(coalesce(p_quotation.status, ''));
begin
    if p_quotation.accepted_at is not null or v_status = 'accepted' then
        raise exception 'This quotation has already been accepted.';
    end if;

    if p_quotation.declined_at is not null or v_status = 'declined' then
        raise exception 'This quotation has already been declined.';
    end if;

    if v_status = 'cancelled' then
        raise exception 'This quotation has been withdrawn. Please contact the sender for an updated quotation.';
    end if;

    if v_status = 'expired' then
        raise exception 'This quotation has passed its validity date. Please contact the sender for an updated quotation.';
    end if;

    if p_quotation.converted_job_id is not null or v_status not in ('draft', 'sent') then
        raise exception 'This quotation is no longer available. Please contact the sender.';
    end if;

    if p_quotation.valid_until is not null and p_quotation.valid_until < p_today then
        raise exception 'This quotation has passed its validity date. Please contact the sender for an updated quotation.';
    end if;
end;
$$;

-- ------------------------------------------------------------
-- 2b. Accept
-- ------------------------------------------------------------

create or replace function public.accept_quotation_share_v2(
    p_share_link_id uuid,
    p_token_hash text,
    p_name text,
    p_email text,
    p_company_name text,
    p_position text,
    p_clause_keys text[],
    p_adr_accepted boolean,
    p_ip_address inet,
    p_user_agent text,
    p_expected_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_share public.quotation_share_links%rowtype;
    v_quotation public.quotations%rowtype;
    v_terms public.quotation_terms_versions%rowtype;

    v_name text := nullif(trim(p_name), '');
    v_email text := nullif(lower(trim(p_email)), '');
    v_company_name text := nullif(trim(p_company_name), '');
    v_position text := nullif(trim(p_position), '');

    v_now timestamptz := now();
    v_today date := (now() at time zone 'Europe/London')::date;

    v_expected_lines jsonb;
    v_expected_count integer;
    v_current_count integer;
    v_mismatch integer;
    v_lines jsonb;

    v_required_count integer;
    v_received_required_count integer;
    v_acceptance_id uuid;
begin
    if v_name is null then
        raise exception 'Your name is required.';
    end if;

    if v_email is null then
        raise exception 'Your email address is required.';
    end if;

    if v_company_name is null then
        raise exception 'Company name is required.';
    end if;

    if v_position is null then
        raise exception 'Position is required.';
    end if;

    if p_token_hash is null
        or p_expected_snapshot is null
        or jsonb_typeof(p_expected_snapshot) <> 'object'
    then
        raise exception 'Invalid quotation acceptance request.';
    end if;

    -- Lock the link and prove the caller holds its token.
    select *
    into v_share
    from public.quotation_share_links
    where id = p_share_link_id
    for update;

    if not found or v_share.token_hash is distinct from p_token_hash then
        raise exception 'Quotation share link not found.';
    end if;

    if v_share.revoked_at is not null then
        raise exception 'This quotation link has been revoked.';
    end if;

    if v_share.expires_at <= v_now then
        raise exception 'This quotation link has expired.';
    end if;

    if v_share.accepted_at is not null then
        raise exception 'This quotation has already been accepted.';
    end if;

    if v_share.declined_at is not null then
        raise exception 'This quotation has already been declined.';
    end if;

    -- Lock the quotation and its lines so they cannot change underneath us.
    select *
    into v_quotation
    from public.quotations
    where id = v_share.quotation_id
      and tenant_id = v_share.tenant_id
    for update;

    if not found then
        raise exception 'Quotation share link not found.';
    end if;

    perform public.quotation_share_assert_open(v_quotation, v_today);

    perform 1
    from public.quotation_lines
    where quotation_id = v_quotation.id
    for update;

    -- The prices must be exactly what the customer was shown.
    v_expected_lines := coalesce(p_expected_snapshot -> 'lines', '[]'::jsonb);

    if jsonb_typeof(v_expected_lines) <> 'array' then
        raise exception 'Invalid quotation acceptance request.';
    end if;

    if upper(coalesce(nullif(v_quotation.currency_code, ''), 'GBP'))
            is distinct from upper(p_expected_snapshot ->> 'currency_code')
        or coalesce(v_quotation.subtotal, 0) is distinct from (p_expected_snapshot ->> 'subtotal')::numeric
        or coalesce(v_quotation.vat_total, 0) is distinct from (p_expected_snapshot ->> 'vat_total')::numeric
        or coalesce(v_quotation.total, 0) is distinct from (p_expected_snapshot ->> 'total')::numeric
    then
        raise exception 'This quotation has changed since you opened it. Please reload the page to review the latest version.';
    end if;

    select count(*) into v_expected_count from jsonb_array_elements(v_expected_lines);
    select count(*) into v_current_count from public.quotation_lines where quotation_id = v_quotation.id;

    with current_lines as (
        select
            l.id::text as id,
            coalesce(l.description, '') as description,
            coalesce(l.quantity, 0) as quantity,
            coalesce(l.unit_price, 0) as unit_price,
            coalesce(l.vat_rate, 0) as vat_rate,
            coalesce(l.line_total, 0) as line_total
        from public.quotation_lines l
        where l.quotation_id = v_quotation.id
    ),
    expected_lines as (
        select
            e ->> 'id' as id,
            coalesce(e ->> 'description', '') as description,
            (e ->> 'quantity')::numeric as quantity,
            (e ->> 'unit_price')::numeric as unit_price,
            (e ->> 'vat_rate')::numeric as vat_rate,
            (e ->> 'line_total')::numeric as line_total
        from jsonb_array_elements(v_expected_lines) e
    )
    select count(*)
    into v_mismatch
    from current_lines c
    full join expected_lines x on x.id = c.id
    where c.id is null
       or x.id is null
       or c.description is distinct from x.description
       or c.quantity is distinct from x.quantity
       or c.unit_price is distinct from x.unit_price
       or c.vat_rate is distinct from x.vat_rate
       or c.line_total is distinct from x.line_total;

    if v_mismatch > 0 or v_expected_count <> v_current_count then
        raise exception 'This quotation has changed since you opened it. Please reload the page to review the latest version.';
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'id', l.id,
                'line_number', l.line_number,
                'description', l.description,
                'quantity', l.quantity,
                'unit_price', l.unit_price,
                'vat_rate', l.vat_rate,
                'line_total', l.line_total
            )
            order by l.line_number, l.id
        ),
        '[]'::jsonb
    )
    into v_lines
    from public.quotation_lines l
    where l.quotation_id = v_quotation.id;

    -- Terms snapshot, exactly as accept_quotation_share_with_business_identity.
    if v_share.terms_version_id is null
        or v_share.terms_snapshot is null
        or v_share.terms_hash is null
    then
        raise exception 'Terms snapshot is missing from this quotation. Generate a new share link.';
    end if;

    select *
    into v_terms
    from public.quotation_terms_versions
    where id = v_share.terms_version_id
      and tenant_id = v_share.tenant_id;

    if not found then
        raise exception 'Terms & Conditions version not found.';
    end if;

    if v_terms.content_hash <> v_share.terms_hash then
        raise exception 'Terms integrity validation failed.';
    end if;

    select count(*)
    into v_required_count
    from jsonb_array_elements(v_terms.clauses) clause
    where coalesce((clause ->> 'required')::boolean, true);

    select count(distinct clause ->> 'key')
    into v_received_required_count
    from jsonb_array_elements(v_terms.clauses) clause
    where coalesce((clause ->> 'required')::boolean, true)
      and (clause ->> 'key') = any(coalesce(p_clause_keys, array[]::text[]));

    if v_received_required_count <> v_required_count then
        raise exception 'Every required Terms & Conditions clause must be acknowledged.';
    end if;

    if v_share.adr_required and not coalesce(p_adr_accepted, false) then
        raise exception 'ADR Dangerous Goods acceptance is required.';
    end if;

    insert into public.quotation_acceptances (
        tenant_id,
        quotation_id,
        share_link_id,
        terms_version_id,
        terms_snapshot,
        terms_hash,
        accepted_by_name,
        accepted_by_email,
        accepted_by_company_name,
        accepted_by_position,
        accepted_at,
        ip_address,
        user_agent,
        adr_required,
        adr_accepted,
        adr_acceptance_text_snapshot,
        accepted_currency_code,
        accepted_subtotal,
        accepted_vat_total,
        accepted_total,
        accepted_lines
    )
    values (
        v_share.tenant_id,
        v_share.quotation_id,
        v_share.id,
        v_terms.id,
        v_share.terms_snapshot,
        v_share.terms_hash,
        v_name,
        v_email,
        v_company_name,
        v_position,
        v_now,
        p_ip_address,
        left(nullif(trim(coalesce(p_user_agent, '')), ''), 512),
        v_share.adr_required,
        case when v_share.adr_required then coalesce(p_adr_accepted, false) else false end,
        case when v_share.adr_required then v_terms.adr_acceptance_text else null end,
        upper(coalesce(nullif(v_quotation.currency_code, ''), 'GBP')),
        coalesce(v_quotation.subtotal, 0),
        coalesce(v_quotation.vat_total, 0),
        coalesce(v_quotation.total, 0),
        v_lines
    )
    returning id
    into v_acceptance_id;

    insert into public.quotation_acceptance_clauses (
        tenant_id,
        acceptance_id,
        clause_key,
        clause_title,
        clause_text_snapshot,
        acknowledged,
        acknowledged_at
    )
    select
        v_share.tenant_id,
        v_acceptance_id,
        clause ->> 'key',
        clause ->> 'title',
        clause ->> 'text',
        true,
        v_now
    from jsonb_array_elements(v_terms.clauses) clause
    where coalesce((clause ->> 'required')::boolean, true)
      and (clause ->> 'key') = any(coalesce(p_clause_keys, array[]::text[]));

    -- Existing acceptance and auto-conversion. Any failure rolls back all
    -- of the evidence above.
    perform *
    from public.accept_quotation_share(
        p_share_link_id,
        v_name,
        v_email
    );

    return v_acceptance_id;
end;
$$;

-- ------------------------------------------------------------
-- 2c. Decline
-- ------------------------------------------------------------

create or replace function public.decline_quotation_share_v2(
    p_share_link_id uuid,
    p_token_hash text,
    p_name text,
    p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_share public.quotation_share_links%rowtype;
    v_quotation public.quotations%rowtype;
    v_name text := nullif(trim(p_name), '');
    v_email text := nullif(lower(trim(p_email)), '');
    v_today date := (now() at time zone 'Europe/London')::date;
begin
    if v_name is null then
        raise exception 'Your name is required.';
    end if;

    if v_email is null then
        raise exception 'Your email address is required.';
    end if;

    if p_token_hash is null then
        raise exception 'Quotation share link not found.';
    end if;

    select *
    into v_share
    from public.quotation_share_links
    where id = p_share_link_id
    for update;

    if not found or v_share.token_hash is distinct from p_token_hash then
        raise exception 'Quotation share link not found.';
    end if;

    if v_share.revoked_at is not null then
        raise exception 'This quotation link has been revoked.';
    end if;

    if v_share.expires_at <= now() then
        raise exception 'This quotation link has expired.';
    end if;

    if v_share.accepted_at is not null then
        raise exception 'This quotation has already been accepted.';
    end if;

    if v_share.declined_at is not null then
        raise exception 'This quotation has already been declined.';
    end if;

    select *
    into v_quotation
    from public.quotations
    where id = v_share.quotation_id
      and tenant_id = v_share.tenant_id
    for update;

    if not found then
        raise exception 'Quotation share link not found.';
    end if;

    perform public.quotation_share_assert_open(v_quotation, v_today);

    perform public.decline_quotation_share(
        p_share_link_id,
        v_name,
        v_email
    );
end;
$$;

-- ------------------------------------------------------------
-- 3. Execute only through the service role (SQL-6)
--
-- Found by name so every live overload is covered, including the legacy
-- functions whose signatures are not in the repo. Supabase's default
-- privileges grant EXECUTE on new functions to anon and authenticated
-- directly, which "revoke ... from public" alone does not remove.
-- ------------------------------------------------------------

do $$
declare
    v_function regprocedure;
begin
    for v_function in
        select p.oid::regprocedure
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
              'accept_quotation_share',
              'decline_quotation_share',
              'mark_quotation_share_viewed',
              'accept_quotation_share_with_terms',
              'accept_quotation_share_with_business_identity',
              'accept_quotation_share_v2',
              'decline_quotation_share_v2',
              'quotation_share_assert_open'
          )
    loop
        execute format('revoke all on function %s from public, anon, authenticated', v_function);
        execute format('grant execute on function %s to service_role', v_function);
    end loop;
end;
$$;

commit;

-- ============================================================
-- Verify (read only)
--
-- Every row: anon_can_execute = false, authenticated_can_execute = false,
-- service_role_can_execute = true.
-- ============================================================

select
    p.oid::regprocedure as function_signature,
    has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
    has_function_privilege('service_role', p.oid, 'execute') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
      'accept_quotation_share',
      'decline_quotation_share',
      'mark_quotation_share_viewed',
      'accept_quotation_share_with_terms',
      'accept_quotation_share_with_business_identity',
      'accept_quotation_share_v2',
      'decline_quotation_share_v2',
      'quotation_share_assert_open'
  )
order by 1;

-- Expect five rows: accepted_currency_code, accepted_lines,
-- accepted_subtotal, accepted_total, accepted_vat_total.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'quotation_acceptances'
  and column_name in (
      'accepted_currency_code',
      'accepted_subtotal',
      'accepted_vat_total',
      'accepted_total',
      'accepted_lines'
  )
order by column_name;
