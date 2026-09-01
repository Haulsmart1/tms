alter table public.vehicles
    add column if not exists mam_kg integer,
    add column if not exists trailer_mam_kg integer,
    add column if not exists tachograph_fitted boolean,
    add column if not exists tachograph_type text,
    add column if not exists home_country_code text;

alter table public.jobs
    add column if not exists journey_scope text,
    add column if not exists origin_country_code text,
    add column if not exists destination_country_code text,
    add column if not exists compliance_regime_override text,
    add column if not exists compliance_override_reason text;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.vehicles'::regclass
          and conname = 'vehicles_mam_kg_positive'
    ) then
        alter table public.vehicles
            add constraint vehicles_mam_kg_positive
            check (mam_kg is null or mam_kg > 0);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.vehicles'::regclass
          and conname = 'vehicles_trailer_mam_kg_nonnegative'
    ) then
        alter table public.vehicles
            add constraint vehicles_trailer_mam_kg_nonnegative
            check (trailer_mam_kg is null or trailer_mam_kg >= 0);
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.vehicles'::regclass
          and conname = 'vehicles_tachograph_type_valid'
    ) then
        alter table public.vehicles
            add constraint vehicles_tachograph_type_valid
            check (
                tachograph_type is null
                or tachograph_type in (
                    'analogue',
                    'digital',
                    'smart_1',
                    'smart_2',
                    'other'
                )
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.vehicles'::regclass
          and conname = 'vehicles_home_country_code_valid'
    ) then
        alter table public.vehicles
            add constraint vehicles_home_country_code_valid
            check (
                home_country_code is null
                or home_country_code ~ '^[A-Z]{2}$'
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.jobs'::regclass
          and conname = 'jobs_journey_scope_valid'
    ) then
        alter table public.jobs
            add constraint jobs_journey_scope_valid
            check (
                journey_scope is null
                or journey_scope in (
                    'gb_domestic',
                    'uk_eu',
                    'aetr',
                    'international_other'
                )
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.jobs'::regclass
          and conname = 'jobs_origin_country_code_valid'
    ) then
        alter table public.jobs
            add constraint jobs_origin_country_code_valid
            check (
                origin_country_code is null
                or origin_country_code ~ '^[A-Z]{2}$'
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.jobs'::regclass
          and conname = 'jobs_destination_country_code_valid'
    ) then
        alter table public.jobs
            add constraint jobs_destination_country_code_valid
            check (
                destination_country_code is null
                or destination_country_code ~ '^[A-Z]{2}$'
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.jobs'::regclass
          and conname = 'jobs_compliance_regime_override_valid'
    ) then
        alter table public.jobs
            add constraint jobs_compliance_regime_override_valid
            check (
                compliance_regime_override is null
                or compliance_regime_override in (
                    'gb_domestic',
                    'assimilated',
                    'aetr',
                    'international_light_goods',
                    'exempt',
                    'unknown'
                )
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.jobs'::regclass
          and conname = 'jobs_compliance_override_reason_required'
    ) then
        alter table public.jobs
            add constraint jobs_compliance_override_reason_required
            check (
                compliance_regime_override is null
                or (
                    compliance_override_reason is not null
                    and length(trim(compliance_override_reason)) > 0
                )
            );
    end if;
end
$$;

comment on column public.vehicles.mam_kg is
    'Vehicle maximum authorised mass in kilograms.';

comment on column public.vehicles.trailer_mam_kg is
    'Trailer maximum authorised mass in kilograms when relevant to planning.';

comment on column public.vehicles.tachograph_fitted is
    'Whether the vehicle is recorded as having a tachograph fitted.';

comment on column public.vehicles.tachograph_type is
    'Recorded tachograph type; does not by itself determine the statutory regime.';

comment on column public.vehicles.home_country_code is
    'ISO 3166-1 alpha-2 home country code used as a planning fact.';

comment on column public.jobs.journey_scope is
    'Operator-supplied journey classification hint for compliance planning.';

comment on column public.jobs.origin_country_code is
    'ISO 3166-1 alpha-2 origin country code used for compliance planning.';

comment on column public.jobs.destination_country_code is
    'ISO 3166-1 alpha-2 destination country code used for compliance planning.';

comment on column public.jobs.compliance_regime_override is
    'Explicit operator override of the planning compliance regime.';

comment on column public.jobs.compliance_override_reason is
    'Required audit reason when a planning compliance regime override is used.';
