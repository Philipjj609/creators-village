-- Authentication-only lease; no gameplay transaction/connection held during provider calls.
ALTER TABLE sessions ADD COLUMN validation_lease uuid;
ALTER TABLE sessions ADD COLUMN validation_lease_until timestamptz;
ALTER TABLE sessions ADD CHECK((validation_lease IS NULL)=(validation_lease_until IS NULL));
