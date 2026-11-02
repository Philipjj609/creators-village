-- Optional frontage belongs only to new F3 plans. Existing saved roads remain untouched.
ALTER TABLE wf2_projects ADD COLUMN path_extension jsonb;
ALTER TABLE wf2_projects ADD CONSTRAINT f3_frontage_version CHECK(path_extension IS NULL OR ruleset_id='community-orbs-1');
