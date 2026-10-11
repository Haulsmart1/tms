-- PROPOSED LOCAL REVIEW CONTRACT. NOT APPLIED. No startup migration runner.
-- Obtain schema approval and test on an isolated database before activation.
BEGIN;
CREATE SCHEMA tms_integrations;
REVOKE ALL ON SCHEMA tms_integrations FROM PUBLIC,anon,authenticated;
CREATE TABLE tms_integrations.outbox (
 id text NOT NULL, tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 idempotency_key text NOT NULL, proposal_hash text NOT NULL, proposal jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','completed','failed')),
 generation bigint NOT NULL DEFAULT 0, lease_token text, lease_expires timestamptz,
 result jsonb, PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,idempotency_key),
 CHECK(proposal->>'tenantId'=tenant_id::text),
 CHECK(proposal->>'schema'='tms.debbie.invoice-proposal.v1')
);
ALTER TABLE tms_integrations.outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tms_integrations.outbox FROM PUBLIC,anon,authenticated;
CREATE TABLE tms_integrations.events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL,
 outbox_id text NOT NULL, action text NOT NULL, approved_by text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE tms_integrations.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tms_integrations.events FROM PUBLIC,anon,authenticated;
CREATE FUNCTION tms_integrations.immutable_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Integration evidence is append only'; END $$;
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE OR TRUNCATE ON tms_integrations.events
FOR EACH STATEMENT EXECUTE FUNCTION tms_integrations.immutable_events();

CREATE FUNCTION public.integration_enqueue_v1(p_tenant uuid,p_id text,p_key text,p_hash text,p_proposal jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tms_integrations AS $$
DECLARE old tms_integrations.outbox; BEGIN
 INSERT INTO tms_integrations.outbox(id,tenant_id,idempotency_key,proposal_hash,proposal)
 VALUES(p_id,p_tenant,p_key,p_hash,p_proposal) ON CONFLICT DO NOTHING;
 IF FOUND THEN
  INSERT INTO tms_integrations.events(tenant_id,outbox_id,action,approved_by) VALUES(p_tenant,p_id,'queued',p_proposal->>'approvedBy');
  RETURN 'created';
 END IF;
 SELECT * INTO old FROM tms_integrations.outbox WHERE tenant_id=p_tenant AND idempotency_key=p_key;
 IF old.proposal_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Idempotency conflict'; END IF;
 RETURN 'replay'; END $$;

CREATE FUNCTION public.integration_claim_v1(p_tenant uuid,p_id text,p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tms_integrations AS $$
DECLARE job tms_integrations.outbox; BEGIN
 UPDATE tms_integrations.outbox SET state='sending',generation=generation+1,
 lease_token=p_token,lease_expires=clock_timestamp()+interval '120 seconds'
 WHERE tenant_id=p_tenant AND id=p_id AND
 (state IN ('queued','failed') OR state='sending' AND lease_expires<=clock_timestamp())
 RETURNING * INTO job;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO tms_integrations.events(tenant_id,outbox_id,action,approved_by) VALUES(p_tenant,p_id,'claimed',job.proposal->>'approvedBy');
 RETURN jsonb_build_object('id',job.id,'tenantId',job.tenant_id,'proposal',job.proposal,
 'hash',job.proposal_hash,'state',job.state,'generation',job.generation,'leaseToken',job.lease_token);
 END $$;

CREATE FUNCTION public.integration_finish_v1(p_tenant uuid,p_id text,p_token text,p_generation bigint,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,tms_integrations AS $$
BEGIN
 UPDATE tms_integrations.outbox SET state=CASE WHEN p_result ? 'receipt' THEN 'completed' ELSE 'failed' END,
 result=p_result,lease_token=NULL,lease_expires=NULL
 WHERE tenant_id=p_tenant AND id=p_id AND state='sending' AND lease_token=p_token
 AND generation=p_generation AND lease_expires>clock_timestamp();
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO tms_integrations.events(tenant_id,outbox_id,action,approved_by)
 SELECT p_tenant,p_id,CASE WHEN p_result ? 'receipt' THEN 'result' ELSE 'failed' END,proposal->>'approvedBy'
 FROM tms_integrations.outbox WHERE tenant_id=p_tenant AND id=p_id;
 RETURN true; END $$;
REVOKE ALL ON FUNCTION public.integration_enqueue_v1(uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.integration_claim_v1(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.integration_finish_v1(uuid,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.integration_enqueue_v1(uuid,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_claim_v1(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.integration_finish_v1(uuid,text,text,bigint,jsonb) TO service_role;
COMMIT;
