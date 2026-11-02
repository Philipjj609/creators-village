-- F3 isolated candidate only. Existing WF2 rows, work and receipts are unchanged.
INSERT INTO wf2_rulesets VALUES('community-orbs-1',60,0,8,1,'wf2-workshop-1',encode(sha256(convert_to('community-orbs-1|60|0|8|1|wf2-workshop-1','UTF8')),'hex'),1);
CREATE TABLE f3_orb_wallets (
 community_id uuid NOT NULL,person_id uuid NOT NULL,balance integer NOT NULL CHECK(balance>=0),
 remainder_ms integer NOT NULL DEFAULT 0 CHECK(remainder_ms BETWEEN 0 AND 299999),last_seen timestamptz NOT NULL DEFAULT clock_timestamp(),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(community_id,person_id),FOREIGN KEY(community_id,person_id) REFERENCES wf2_memberships(community_id,person_id)
);
CREATE TABLE f3_orb_ledger (
 id uuid PRIMARY KEY,community_id uuid NOT NULL,person_id uuid NOT NULL,entry_key text NOT NULL,kind text NOT NULL CHECK(kind IN('start','earn','spend','refund')),
 amount integer NOT NULL CHECK(amount<>0),balance_after integer NOT NULL CHECK(balance_after>=0),project_id uuid REFERENCES wf2_projects(id),at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(community_id,person_id,entry_key),FOREIGN KEY(community_id,person_id) REFERENCES f3_orb_wallets(community_id,person_id)
);
CREATE TABLE f3_orb_participants (
 world_id uuid NOT NULL,project_id uuid NOT NULL,person_id uuid NOT NULL REFERENCES people(id),opted_in boolean NOT NULL DEFAULT false,revision bigint NOT NULL DEFAULT 1,changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,project_id,person_id),FOREIGN KEY(world_id,project_id) REFERENCES wf2_projects(world_id,id)
);
CREATE TABLE f3_orb_contributions (
 id uuid PRIMARY KEY,world_id uuid NOT NULL,project_id uuid NOT NULL,community_id uuid NOT NULL,person_id uuid NOT NULL,amount integer NOT NULL CHECK(amount BETWEEN 1 AND 60),command_id uuid NOT NULL,at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(person_id,command_id),FOREIGN KEY(world_id,project_id,community_id) REFERENCES wf2_projects(world_id,id,community_id),FOREIGN KEY(world_id,project_id,person_id) REFERENCES f3_orb_participants(world_id,project_id,person_id)
);
CREATE INDEX ON f3_orb_contributions(world_id,project_id,at,id);
CREATE TRIGGER f3_ledger_immutable BEFORE UPDATE OR DELETE ON f3_orb_ledger FOR EACH ROW EXECUTE FUNCTION wf2_immutable_row();
CREATE TRIGGER f3_contribution_immutable BEFORE UPDATE OR DELETE ON f3_orb_contributions FOR EACH ROW EXECUTE FUNCTION wf2_immutable_row();
REVOKE ALL ON f3_orb_wallets,f3_orb_ledger,f3_orb_participants,f3_orb_contributions FROM PUBLIC;
