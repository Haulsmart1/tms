-- ============================================================
-- QUOTATION ACCEPTANCE BUSINESS IDENTITY
--
-- Extends immutable quotation acceptance evidence with:
--   - Company Name
--   - Position
--
-- The existing accept_quotation_share_with_terms() remains
-- untouched for backwards compatibility.
-- ============================================================


alter table public.quotation_acceptances
    add column if not exists accepted_by_company_name text,
    add column if not exists accepted_by_position text;


create or replace function public.accept_quotation_share_with_business_identity(
    p_share_link_id uuid,
    p_name text,
    p_email text,
    p_company_name text,
    p_position text,
    p_clause_keys text[],
    p_adr_accepted boolean,
    p_ip_address inet default null,
    p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_share public.quotation_share_links%rowtype;
    v_terms public.quotation_terms_versions%rowtype;

    v_name text;
    v_email text;
    v_company_name text;
    v_position text;

    v_acceptance_id uuid;

    v_required_count integer;
    v_received_required_count integer;

    v_now timestamptz := now();
begin

    -- --------------------------------------------------------
    -- NORMALISE BUSINESS IDENTITY
    -- --------------------------------------------------------

    v_name :=
        nullif(
            trim(p_name),
            ''
        );

    v_email :=
        nullif(
            lower(
                trim(p_email)
            ),
            ''
        );

    v_company_name :=
        nullif(
            trim(p_company_name),
            ''
        );

    v_position :=
        nullif(
            trim(p_position),
            ''
        );


    if v_name is null then
        raise exception
            'Your name is required.';
    end if;

    if v_email is null then
        raise exception
            'Your email address is required.';
    end if;

    if v_company_name is null then
        raise exception
            'Company name is required.';
    end if;

    if v_position is null then
        raise exception
            'Position is required.';
    end if;


    -- --------------------------------------------------------
    -- LOCK SHARE LINK
    -- --------------------------------------------------------

    select *
    into v_share
    from public.quotation_share_links
    where id = p_share_link_id
    for update;


    if not found then
        raise exception
            'Quotation share link not found.';
    end if;

    if v_share.revoked_at is not null then
        raise exception
            'This quotation link has been revoked.';
    end if;

    if v_share.expires_at <= v_now then
        raise exception
            'This quotation link has expired.';
    end if;

    if v_share.accepted_at is not null then
        raise exception
            'This quotation has already been accepted.';
    end if;

    if v_share.declined_at is not null then
        raise exception
            'This quotation has already been declined.';
    end if;


    -- --------------------------------------------------------
    -- REQUIRE FROZEN TERMS SNAPSHOT
    -- --------------------------------------------------------

    if
        v_share.terms_version_id is null
        or v_share.terms_snapshot is null
        or v_share.terms_hash is null
    then
        raise exception
            'Terms snapshot is missing from this quotation. Generate a new share link.';
    end if;


    -- --------------------------------------------------------
    -- LOAD EXACT TERMS VERSION
    -- --------------------------------------------------------

    select *
    into v_terms
    from public.quotation_terms_versions
    where id = v_share.terms_version_id
      and tenant_id = v_share.tenant_id;


    if not found then
        raise exception
            'Terms & Conditions version not found.';
    end if;


    -- --------------------------------------------------------
    -- VERIFY FROZEN TERMS HASH
    -- --------------------------------------------------------

    if v_terms.content_hash <> v_share.terms_hash then
        raise exception
            'Terms integrity validation failed.';
    end if;


    -- --------------------------------------------------------
    -- VALIDATE EVERY REQUIRED CLAUSE
    -- --------------------------------------------------------

    select count(*)
    into v_required_count
    from jsonb_array_elements(
        v_terms.clauses
    ) clause
    where coalesce(
        (clause->>'required')::boolean,
        true
    );


    select count(
        distinct clause->>'key'
    )
    into v_received_required_count
    from jsonb_array_elements(
        v_terms.clauses
    ) clause
    where coalesce(
        (clause->>'required')::boolean,
        true
    )
      and (
          clause->>'key'
      ) = any(
          coalesce(
              p_clause_keys,
              array[]::text[]
          )
      );


    if
        v_received_required_count <>
        v_required_count
    then
        raise exception
            'Every required Terms & Conditions clause must be acknowledged.';
    end if;


    -- --------------------------------------------------------
    -- ADR ACCEPTANCE
    -- --------------------------------------------------------

    if
        v_share.adr_required
        and not coalesce(
            p_adr_accepted,
            false
        )
    then
        raise exception
            'ADR Dangerous Goods acceptance is required.';
    end if;


    -- --------------------------------------------------------
    -- SINGLE IMMUTABLE ACCEPTANCE HEADER
    -- --------------------------------------------------------

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
        adr_acceptance_text_snapshot
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
        nullif(
            trim(
                coalesce(
                    p_user_agent,
                    ''
                )
            ),
            ''
        ),
        v_share.adr_required,
        case
            when v_share.adr_required
                then coalesce(
                    p_adr_accepted,
                    false
                )
            else false
        end,
        case
            when v_share.adr_required
                then v_terms.adr_acceptance_text
            else null
        end
    )
    returning id
    into v_acceptance_id;


    -- --------------------------------------------------------
    -- CLAUSE-BY-CLAUSE IMMUTABLE EVIDENCE
    -- --------------------------------------------------------

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
        clause->>'key',
        clause->>'title',
        clause->>'text',
        true,
        v_now
    from jsonb_array_elements(
        v_terms.clauses
    ) clause
    where coalesce(
        (clause->>'required')::boolean,
        true
    )
      and (
          clause->>'key'
      ) = any(
          coalesce(
              p_clause_keys,
              array[]::text[]
          )
      );


    -- --------------------------------------------------------
    -- PRESERVE EXISTING ACCEPTANCE + AUTO-CONVERSION
    --
    -- This is exactly the same final workflow used by
    -- accept_quotation_share_with_terms().
    --
    -- If this legacy function fails, PostgreSQL rolls the
    -- complete transaction back, including evidence above.
    -- --------------------------------------------------------

    perform *
    from public.accept_quotation_share(
        p_share_link_id,
        v_name,
        v_email
    );


    return v_acceptance_id;
end;
$$;


-- ============================================================
-- PERMISSIONS
-- Match the public quotation acceptance model.
-- ============================================================

revoke all
on function public.accept_quotation_share_with_business_identity(
    uuid,
    text,
    text,
    text,
    text,
    text[],
    boolean,
    inet,
    text
)
from public;

grant execute
on function public.accept_quotation_share_with_business_identity(
    uuid,
    text,
    text,
    text,
    text,
    text[],
    boolean,
    inet,
    text
)
to service_role;


-- ============================================================
-- DOCUMENTATION
-- ============================================================

comment on column
public.quotation_acceptances.accepted_by_company_name
is
'Company represented by the person accepting the quotation.';


comment on column
public.quotation_acceptances.accepted_by_position
is
'Position/job title of the person accepting the quotation.';


comment on function
public.accept_quotation_share_with_business_identity(
    uuid,
    text,
    text,
    text,
    text,
    text[],
    boolean,
    inet,
    text
)
is
'Accepts a quotation with immutable Terms & Conditions evidence, ADR evidence, customer name, email, company name and position, then invokes the existing quotation acceptance/auto-conversion workflow.';