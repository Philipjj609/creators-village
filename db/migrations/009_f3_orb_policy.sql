-- Persist the version boundary: a runtime toggle cannot turn an Orb community
-- back into a source of new free legacy projects or repeat its starting award.
CREATE TABLE f3_orb_communities (
 community_id uuid PRIMARY KEY REFERENCES wf2_communities(id),
 policy_version text NOT NULL CHECK(policy_version='community-orbs-1') REFERENCES wf2_rulesets(id),
 policy jsonb NOT NULL,activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER f3_policy_immutable BEFORE UPDATE OR DELETE ON f3_orb_communities FOR EACH ROW EXECUTE FUNCTION wf2_immutable_row();
REVOKE ALL ON f3_orb_communities FROM PUBLIC;
