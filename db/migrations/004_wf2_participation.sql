-- WF2 additive private-playtest catalog. No binding, grant or geography mutation.
ALTER TABLE people ADD COLUMN twitch_login text;
ALTER TABLE founding_worlds ADD UNIQUE(id,creator_id);
CREATE TABLE wf2_rulesets (
 id text PRIMARY KEY, goal integer NOT NULL CHECK(goal BETWEEN 1 AND 100),
 minimum_non_creator integer NOT NULL CHECK(minimum_non_creator BETWEEN 0 AND goal),
 max_non_creator_members integer NOT NULL CHECK(max_non_creator_members BETWEEN 1 AND 1000),
 max_active_projects integer NOT NULL CHECK(max_active_projects BETWEEN 1 AND 100),
 template_id text NOT NULL, policy_hash text NOT NULL CHECK(policy_hash ~ '^[0-9a-f]{64}$'),
 schema_version integer NOT NULL CHECK(schema_version=1), UNIQUE(id,goal,minimum_non_creator)
);
INSERT INTO wf2_rulesets VALUES('cp1-wf2-test-1',2,1,8,1,'wf2-workshop-1',encode(sha256(convert_to('cp1-wf2-test-1|2|1|8|1|wf2-workshop-1','UTF8')),'hex'),1);
CREATE TABLE wf2_communities (
 id uuid PRIMARY KEY, creator_id uuid NOT NULL UNIQUE REFERENCES people(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,creator_id)
);
CREATE TABLE wf2_bindings (
 world_id uuid PRIMARY KEY, community_id uuid NOT NULL UNIQUE, creator_id uuid NOT NULL,
 ruleset_id text NOT NULL REFERENCES wf2_rulesets(id), state_schema text NOT NULL CHECK(state_schema='wf2-state-1'),
 enabled boolean NOT NULL, authority_epoch bigint NOT NULL DEFAULT 1 CHECK(authority_epoch>=1),
 credit_revision bigint NOT NULL DEFAULT 1 CHECK(credit_revision>=1), replay_floor bigint NOT NULL DEFAULT 1 CHECK(replay_floor>=0),
 activated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(world_id,community_id),
 FOREIGN KEY(world_id,creator_id) REFERENCES founding_worlds(id,creator_id),
 FOREIGN KEY(community_id,creator_id) REFERENCES wf2_communities(id,creator_id)
);
CREATE TABLE wf2_topology_guards (world_id uuid PRIMARY KEY REFERENCES wf2_bindings(world_id));
CREATE TABLE wf2_memberships (
 id uuid NOT NULL UNIQUE, community_id uuid NOT NULL REFERENCES wf2_communities(id), person_id uuid NOT NULL REFERENCES people(id),
 state text NOT NULL CHECK(state IN('pending','active','left','banned','rejected')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1), created_at timestamptz NOT NULL DEFAULT now(),changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(community_id,person_id)
);
CREATE TABLE wf2_world_grants (
 world_id uuid NOT NULL,community_id uuid NOT NULL,person_id uuid NOT NULL,
 can_view boolean NOT NULL,can_contribute boolean NOT NULL,revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1), revoked_at timestamptz,
 PRIMARY KEY(world_id,person_id),FOREIGN KEY(world_id,community_id) REFERENCES wf2_bindings(world_id,community_id),
 FOREIGN KEY(community_id,person_id) REFERENCES wf2_memberships(community_id,person_id),
 CHECK(NOT can_contribute OR can_view),CHECK(revoked_at IS NULL OR (NOT can_view AND NOT can_contribute))
);
CREATE TABLE wf2_invitations (
 id uuid PRIMARY KEY,world_id uuid NOT NULL REFERENCES wf2_bindings(world_id),issued_by uuid NOT NULL REFERENCES people(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),sealed_token bytea,
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,consumed_request_id uuid,revoked_at timestamptz,
 CHECK(expires_at=created_at+interval '24 hours'),CHECK(consumed_request_id IS NULL OR sealed_token IS NULL)
);
CREATE TABLE wf2_join_continuations (
 id uuid PRIMARY KEY,cookie_hash text NOT NULL UNIQUE CHECK(cookie_hash ~ '^[0-9a-f]{64}$'),invitation_id uuid NOT NULL REFERENCES wf2_invitations(id),
 expires_at timestamptz NOT NULL,completed_request_id uuid
);
ALTER TABLE oauth_states ADD COLUMN join_continuation_id uuid REFERENCES wf2_join_continuations(id);
CREATE TABLE wf2_join_requests (
 id uuid PRIMARY KEY,revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),world_id uuid NOT NULL,community_id uuid NOT NULL,person_id uuid NOT NULL,
 invitation_id uuid NOT NULL UNIQUE REFERENCES wf2_invitations(id),state text NOT NULL CHECK(state IN('pending','approved','rejected','withdrawn')),
 created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,
 FOREIGN KEY(world_id,community_id) REFERENCES wf2_bindings(world_id,community_id),
 FOREIGN KEY(community_id,person_id) REFERENCES wf2_memberships(community_id,person_id)
);
CREATE UNIQUE INDEX wf2_one_pending_request ON wf2_join_requests(world_id,person_id) WHERE state='pending';
ALTER TABLE wf2_invitations ADD FOREIGN KEY(consumed_request_id) REFERENCES wf2_join_requests(id);
ALTER TABLE wf2_join_continuations ADD FOREIGN KEY(completed_request_id) REFERENCES wf2_join_requests(id);
CREATE TABLE wf2_projects (
 id uuid PRIMARY KEY,world_id uuid NOT NULL,community_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES people(id),
 ruleset_id text NOT NULL,goal integer NOT NULL,minimum_non_creator integer NOT NULL,
 state text NOT NULL CHECK(state IN('draft','open','ready','blocked','completed','cancelled')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),plan_revision bigint NOT NULL DEFAULT 1 CHECK(plan_revision>=1),
 plan_hash text NOT NULL CHECK(plan_hash ~ '^[0-9a-f]{64}$'),template_id text NOT NULL CHECK(template_id='wf2-workshop-1'),
 orientation integer NOT NULL CHECK(orientation=0),qx integer NOT NULL,qy integer NOT NULL,base_height integer NOT NULL,
 width_q integer NOT NULL CHECK(width_q=1536),depth_q integer NOT NULL CHECK(depth_q=1536),entrance_qx integer NOT NULL,entrance_qy integer NOT NULL,
 path_points jsonb NOT NULL,path_width_q integer NOT NULL CHECK(path_width_q=384),geometry_schema text NOT NULL CHECK(geometry_schema='wf2-plan-1'),
 appearance text NOT NULL,asset_manifest_hash text NOT NULL CHECK(asset_manifest_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,completed_at timestamptz,cancelled_at timestamptz,
 accepted_count integer NOT NULL DEFAULT 0 CHECK(accepted_count BETWEEN 0 AND goal),
 non_creator_count integer NOT NULL DEFAULT 0 CHECK(non_creator_count BETWEEN 0 AND accepted_count),blocked_code text,
 UNIQUE(world_id,id),UNIQUE(world_id,id,community_id),
 FOREIGN KEY(world_id,community_id) REFERENCES wf2_bindings(world_id,community_id),
 FOREIGN KEY(ruleset_id,goal,minimum_non_creator) REFERENCES wf2_rulesets(id,goal,minimum_non_creator),
 CHECK(state NOT IN('open','ready','blocked','completed') OR published_at IS NOT NULL)
);
CREATE UNIQUE INDEX wf2_one_active_test_project ON wf2_projects(world_id) WHERE ruleset_id='cp1-wf2-test-1' AND state IN('open','ready','blocked');
CREATE INDEX ON wf2_projects(world_id,state,id);
CREATE TABLE wf2_contributions (
 id uuid PRIMARY KEY,world_id uuid NOT NULL,project_id uuid NOT NULL,community_id uuid NOT NULL,person_id uuid NOT NULL,
 amount integer NOT NULL CHECK(amount=1),command_id uuid NOT NULL,accepted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(world_id,project_id,person_id),UNIQUE(person_id,command_id),
 FOREIGN KEY(world_id,project_id,community_id) REFERENCES wf2_projects(world_id,id,community_id),
 FOREIGN KEY(community_id,person_id) REFERENCES wf2_memberships(community_id,person_id)
);
CREATE INDEX ON wf2_contributions(person_id,accepted_at,id);
CREATE TABLE wf2_claims (
 world_id uuid NOT NULL,surface text NOT NULL CHECK(surface='ground'),hx integer NOT NULL,hy integer NOT NULL,
 kind text NOT NULL CHECK(kind IN('reserved','solid')),project_id uuid,structure_id text,
 PRIMARY KEY(world_id,surface,hx,hy),
 CHECK((kind='reserved' AND project_id IS NOT NULL AND structure_id IS NULL) OR (kind='solid' AND structure_id IS NOT NULL AND project_id IS NULL)),
 FOREIGN KEY(world_id,project_id) REFERENCES wf2_projects(world_id,id),FOREIGN KEY(world_id,structure_id) REFERENCES founding_structures(world_id,id)
);
CREATE INDEX ON wf2_claims(world_id,project_id);
CREATE INDEX ON wf2_claims(world_id,structure_id);
CREATE TABLE wf2_completion_jobs (
 world_id uuid NOT NULL,project_id uuid NOT NULL,plan_hash text NOT NULL CHECK(plan_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('pending','leased','blocked','done','cancelled')),lease_token uuid,lease_until timestamptz,
 attempt integer NOT NULL CHECK(attempt>=0),next_attempt_at timestamptz NOT NULL,error_code text,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,project_id),FOREIGN KEY(world_id,project_id) REFERENCES wf2_projects(world_id,id)
);
CREATE INDEX ON wf2_completion_jobs(next_attempt_at) WHERE status IN('pending','leased');
CREATE TABLE wf2_completion_results (
 world_id uuid NOT NULL,project_id uuid NOT NULL,structure_id text NOT NULL,path_id text NOT NULL,committed_cursor bigint NOT NULL CHECK(committed_cursor>=1),completed_at timestamptz NOT NULL,
 PRIMARY KEY(world_id,project_id),UNIQUE(world_id,structure_id),UNIQUE(world_id,path_id),
 FOREIGN KEY(world_id,project_id) REFERENCES wf2_projects(world_id,id),FOREIGN KEY(world_id,structure_id) REFERENCES founding_structures(world_id,id),
 FOREIGN KEY(world_id,path_id) REFERENCES founding_paths(world_id,id)
);
CREATE TABLE wf2_command_receipts (
 person_id uuid NOT NULL REFERENCES people(id),command_id uuid NOT NULL,command_schema text NOT NULL,kind text NOT NULL,
 target_world_id uuid REFERENCES founding_worlds(id),request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(person_id,command_id)
);
CREATE TABLE wf2_credit_consents (
 world_id uuid NOT NULL,project_id uuid NOT NULL,person_id uuid NOT NULL,opted_in boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(world_id,project_id,person_id),FOREIGN KEY(world_id,project_id,person_id) REFERENCES wf2_contributions(world_id,project_id,person_id)
);
CREATE TABLE wf2_shared_batches (
 world_id uuid NOT NULL REFERENCES wf2_bindings(world_id),cursor bigint NOT NULL CHECK(cursor>=1),batch_id uuid NOT NULL UNIQUE,
 batch_schema text NOT NULL CHECK(batch_schema='wf2-batch-1'),payload jsonb NOT NULL,committed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(world_id,cursor)
);
CREATE INDEX ON wf2_shared_batches(world_id,committed_at,cursor);
CREATE TABLE wf2_outbox (
 world_id uuid NOT NULL,cursor bigint NOT NULL,state text NOT NULL CHECK(state IN('pending','leased','notified')),lease_token uuid,lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL,attempt integer NOT NULL CHECK(attempt>=0),PRIMARY KEY(world_id,cursor),
 FOREIGN KEY(world_id,cursor) REFERENCES wf2_shared_batches(world_id,cursor)
);
CREATE INDEX ON wf2_outbox(next_attempt_at) WHERE state IN('pending','leased');
CREATE TABLE wf2_operational_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,at timestamptz NOT NULL DEFAULT now(),code text NOT NULL,duration_ms integer,retry_count integer,world_id uuid
);
CREATE INDEX ON wf2_operational_logs(at);
-- Lookup/locking FK indexes for admission and privacy operations.
CREATE INDEX ON wf2_memberships(person_id);
CREATE INDEX ON wf2_join_requests(world_id,state,id);
CREATE INDEX ON wf2_invitations(world_id);
CREATE INDEX ON wf2_join_continuations(invitation_id);
CREATE FUNCTION wf2_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable WF2 history' USING ERRCODE='23514'; END $$;
CREATE TRIGGER wf2_rules_immutable BEFORE UPDATE OR DELETE ON wf2_rulesets FOR EACH ROW EXECUTE FUNCTION wf2_immutable_row();
CREATE TRIGGER wf2_work_immutable BEFORE UPDATE OR DELETE ON wf2_contributions FOR EACH ROW EXECUTE FUNCTION wf2_immutable_row();
CREATE TRIGGER wf2_receipt_immutable BEFORE UPDATE OR DELETE ON wf2_command_receipts FOR EACH ROW EXECUTE FUNCTION wf2_immutable_row();
CREATE FUNCTION wf2_guard_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'WF2 project history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF OLD.published_at IS NOT NULL AND (to_jsonb(NEW)-ARRAY['state','revision','accepted_count','non_creator_count','blocked_code','completed_at','cancelled_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['state','revision','accepted_count','non_creator_count','blocked_code','completed_at','cancelled_at']) THEN
 RAISE EXCEPTION 'Published plan is immutable' USING ERRCODE='23514'; END IF;
 IF OLD.state IN('completed','cancelled') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal project' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wf2_project_guard BEFORE UPDATE OR DELETE ON wf2_projects FOR EACH ROW EXECUTE FUNCTION wf2_guard_project();
