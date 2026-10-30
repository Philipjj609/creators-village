-- Enforce cross-format policy even against an older v1 writer after rollback.
CREATE FUNCTION enforce_founding_slot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM people WHERE id=NEW.creator_id FOR UPDATE;
  IF TG_TABLE_NAME='worlds' THEN
    IF EXISTS(SELECT 1 FROM founding_jobs WHERE creator_id=NEW.creator_id AND purpose='active') THEN
      RAISE EXCEPTION 'Active world slot occupied' USING ERRCODE='23505';
    END IF;
  ELSE
    IF (NEW.purpose='active' AND EXISTS(SELECT 1 FROM worlds WHERE creator_id=NEW.creator_id))
      OR (NEW.purpose='development' AND NOT EXISTS(SELECT 1 FROM worlds WHERE creator_id=NEW.creator_id)) THEN
      RAISE EXCEPTION 'Invalid founding world slot' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER legacy_active_slot BEFORE INSERT ON worlds FOR EACH ROW EXECUTE FUNCTION enforce_founding_slot();
CREATE TRIGGER founding_active_slot BEFORE INSERT ON founding_jobs FOR EACH ROW EXECUTE FUNCTION enforce_founding_slot();

ALTER TABLE founding_structures ADD CHECK(width>0), ADD CHECK(depth>0);
