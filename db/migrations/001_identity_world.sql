CREATE TABLE people (
  id uuid PRIMARY KEY,
  twitch_subject text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oauth_states (
  state_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE TABLE sessions (
  session_hash text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  encrypted_tokens text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  validated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE worlds (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL UNIQUE REFERENCES people(id),
  name text NOT NULL,
  seed text NOT NULL,
  generator_version text NOT NULL,
  asset_version text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE create_receipts (
  person_id uuid NOT NULL REFERENCES people(id),
  command_id uuid NOT NULL,
  request_hash text NOT NULL,
  world_id uuid NOT NULL REFERENCES worlds(id),
  PRIMARY KEY (person_id, command_id)
);
CREATE TABLE world_events (
  world_id uuid NOT NULL REFERENCES worlds(id),
  sequence bigint NOT NULL,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, sequence)
);
