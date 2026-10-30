-- Additive WF1 catalog. Legacy worlds/readers/checks remain unchanged.
CREATE TABLE founding_jobs (
  id uuid PRIMARY KEY, creator_id uuid NOT NULL UNIQUE REFERENCES people(id),
  command_id uuid NOT NULL, request_hash text NOT NULL,
  world_id uuid NOT NULL UNIQUE, name text NOT NULL, seed text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('active','development')),
  status text NOT NULL CHECK(status IN ('pending','working','ready','failed')),
  lease_until timestamptz, error text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(creator_id,command_id)
);
CREATE TABLE founding_worlds (
  id uuid PRIMARY KEY, creator_id uuid NOT NULL UNIQUE REFERENCES people(id),
  job_id uuid NOT NULL UNIQUE REFERENCES founding_jobs(id),
  format integer NOT NULL CHECK(format=2), purpose text NOT NULL CHECK(purpose IN ('active','development')),
  header jsonb NOT NULL, baseline_hash text NOT NULL,
  topology_epoch bigint NOT NULL DEFAULT 1, public_cursor bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE founding_chunks (
  world_id uuid NOT NULL REFERENCES founding_worlds(id) ON DELETE CASCADE,
  x integer NOT NULL, y integer NOT NULL, hash text NOT NULL, encoding text NOT NULL CHECK(encoding='i16le-u8-32-v1'),
  bytes bytea NOT NULL CHECK(octet_length(bytes)=3202), revision bigint NOT NULL DEFAULT 1,
  PRIMARY KEY(world_id,x,y)
);
CREATE TABLE founding_structures (
  world_id uuid NOT NULL REFERENCES founding_worlds(id) ON DELETE CASCADE,
  id text NOT NULL, template text NOT NULL, qx integer NOT NULL,qy integer NOT NULL,
  width integer NOT NULL, depth integer NOT NULL, height integer NOT NULL,
  entrance_qx integer NOT NULL,entrance_qy integer NOT NULL, appearance text NOT NULL,
  revision bigint NOT NULL DEFAULT 1, PRIMARY KEY(world_id,id)
);
CREATE TABLE founding_occupancy (
  world_id uuid NOT NULL, surface text NOT NULL CHECK(surface='ground'), hx integer NOT NULL, hy integer NOT NULL,
  structure_id text NOT NULL,
  PRIMARY KEY(world_id,surface,hx,hy),
  FOREIGN KEY(world_id,structure_id) REFERENCES founding_structures(world_id,id) ON DELETE CASCADE
);
CREATE TABLE founding_paths (
  world_id uuid NOT NULL REFERENCES founding_worlds(id) ON DELETE CASCADE,
  id text NOT NULL,width integer NOT NULL, geometry jsonb NOT NULL,PRIMARY KEY(world_id,id)
);
CREATE TABLE founding_public_events (
  world_id uuid NOT NULL REFERENCES founding_worlds(id) ON DELETE CASCADE,
  cursor bigint NOT NULL, kind text NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(world_id,cursor)
);
-- No private identity/grant audit counters exposed as public stream gaps.
-- No mutable gameplay endpoint or grant/economy/territory-unlock policy added.
