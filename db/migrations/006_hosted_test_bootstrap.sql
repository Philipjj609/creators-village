-- One bounded operator permit, never a public creation flag. Existing rows keep creator origin.
ALTER TABLE founding_jobs ADD COLUMN origin text NOT NULL DEFAULT 'creator'
  CHECK(origin IN ('creator','hosted-bootstrap'));
CREATE TABLE hosted_test_bootstrap (
  slot smallint PRIMARY KEY CHECK(slot=1),
  policy text NOT NULL CHECK(policy='hosted-test-bootstrap-1'),
  purpose text NOT NULL CHECK(purpose='hosted-integration-test'),
  plan_hash text NOT NULL,
  operator_role name NOT NULL,
  creator_id uuid NOT NULL REFERENCES people(id),
  world_id uuid NOT NULL UNIQUE,
  job_id uuid NOT NULL UNIQUE REFERENCES founding_jobs(id) DEFERRABLE INITIALLY DEFERRED,
  command_id uuid NOT NULL,
  request_hash text NOT NULL,
  world_name text NOT NULL,
  seed text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON hosted_test_bootstrap FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cv_runtime') THEN
    REVOKE ALL ON hosted_test_bootstrap FROM cv_runtime;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION enforce_founding_slot() RETURNS trigger LANGUAGE plpgsql
  SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permit public.hosted_test_bootstrap%ROWTYPE;
BEGIN
  PERFORM id FROM public.people WHERE id=NEW.creator_id FOR UPDATE;
  IF TG_TABLE_NAME='worlds' THEN
    IF EXISTS(SELECT 1 FROM public.founding_jobs WHERE creator_id=NEW.creator_id AND purpose='active') THEN
      RAISE EXCEPTION 'Active world slot occupied' USING ERRCODE='23505';
    END IF;
  ELSE
    IF NEW.origin='hosted-bootstrap' THEN
      SELECT * INTO permit FROM public.hosted_test_bootstrap WHERE slot=1 FOR UPDATE;
      IF NOT FOUND OR permit.operator_role<>session_user OR permit.consumed_at IS NOT NULL
        OR permit.expires_at<=clock_timestamp() OR NEW.purpose<>'development'
        OR (NEW.id,NEW.world_id,NEW.creator_id,NEW.command_id,NEW.request_hash,NEW.name,NEW.seed)
          IS DISTINCT FROM (permit.job_id,permit.world_id,permit.creator_id,permit.command_id,permit.request_hash,permit.world_name,permit.seed) THEN
        RAISE EXCEPTION 'Invalid hosted bootstrap permit' USING ERRCODE='42501';
      END IF;
      UPDATE public.hosted_test_bootstrap SET consumed_at=clock_timestamp() WHERE slot=1;
    ELSIF (NEW.purpose='active' AND EXISTS(SELECT 1 FROM public.worlds WHERE creator_id=NEW.creator_id))
      OR (NEW.purpose='development' AND NOT EXISTS(SELECT 1 FROM public.worlds WHERE creator_id=NEW.creator_id)) THEN
      RAISE EXCEPTION 'Invalid founding world slot' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION retain_founding_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.origin IS DISTINCT FROM NEW.origin THEN RAISE EXCEPTION 'Immutable founding origin' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER founding_origin_immutable BEFORE UPDATE OF origin ON founding_jobs
  FOR EACH ROW EXECUTE FUNCTION retain_founding_origin();
