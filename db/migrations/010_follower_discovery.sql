-- Post-submission F4 (not part of release R1): optional follower discovery/joining and
-- membership permissions separated from membership itself. Additive only: no historical
-- row is rewritten, no existing check is relaxed, and every new permission defaults to false.
ALTER TABLE wf2_memberships
 ADD COLUMN join_source text NOT NULL DEFAULT 'invitation' CHECK(join_source IN('invitation','follower'));
-- Membership (state) and view access remain distinct from each permission below.
-- wf2_world_grants.can_contribute keeps its R1 meaning: contribute/fund Orbs.
ALTER TABLE wf2_world_grants
 ADD COLUMN can_create_projects boolean NOT NULL DEFAULT false,
 ADD COLUMN can_manage_construction boolean NOT NULL DEFAULT false,
 ADD COLUMN can_moderate boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT wf2_grant_permissions_need_view
  CHECK((NOT can_create_projects AND NOT can_manage_construction AND NOT can_moderate) OR can_view);
-- Per-community opt-in. No row means follower joining is off and the legacy ruleset cohort cap applies.
-- member_limit is a membership/accounting bound only; it is independent of simulated residents,
-- rendered characters and residential space.
CREATE TABLE wf2_community_settings (
 community_id uuid PRIMARY KEY REFERENCES wf2_communities(id),
 follower_join_enabled boolean NOT NULL DEFAULT false,
 follower_can_contribute boolean NOT NULL DEFAULT false,
 member_limit integer NOT NULL DEFAULT 500 CHECK(member_limit BETWEEN 1 AND 5000),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Discovery cache. It only ever holds matches against opted-in communities; the viewer's
-- complete followed-channel list is never stored. Unfollowing removes a row at the next refresh
-- and never touches wf2_memberships, grants, contributions or ledgers.
CREATE TABLE wf2_follow_sync (
 person_id uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
 next_allowed_at timestamptz NOT NULL,
 synced_at timestamptz
);
CREATE TABLE wf2_follow_matches (
 person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
 community_id uuid NOT NULL REFERENCES wf2_communities(id),
 verified_at timestamptz NOT NULL,
 PRIMARY KEY(person_id,community_id)
);
CREATE INDEX wf2_follow_matches_community ON wf2_follow_matches(community_id);
-- Scope-free login stays the default. The optional second authorization records what Twitch granted.
ALTER TABLE sessions ADD COLUMN granted_scopes text[] NOT NULL DEFAULT '{}';
ALTER TABLE oauth_states
 ADD COLUMN purpose text NOT NULL DEFAULT 'login' CHECK(purpose IN('login','follows')),
 ADD COLUMN session_hash text;
REVOKE ALL ON wf2_community_settings,wf2_follow_sync,wf2_follow_matches FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cv_runtime') THEN
    GRANT SELECT,INSERT,UPDATE ON wf2_community_settings,wf2_follow_sync TO cv_runtime;
    GRANT SELECT,INSERT,DELETE ON wf2_follow_matches TO cv_runtime;
    REVOKE DELETE,TRUNCATE ON wf2_community_settings,wf2_follow_sync FROM cv_runtime;
    REVOKE UPDATE,TRUNCATE ON wf2_follow_matches FROM cv_runtime;
  END IF;
END $$;
