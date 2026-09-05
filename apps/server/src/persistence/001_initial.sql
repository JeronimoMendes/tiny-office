CREATE TABLE workspaces (
  id uuid PRIMARY KEY, name text NOT NULL, map_revision text
);
CREATE TABLE workspace_maps (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision text NOT NULL, definition jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, revision)
);
ALTER TABLE workspaces ADD FOREIGN KEY (id, map_revision) REFERENCES workspace_maps(workspace_id, revision);
CREATE TABLE users (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, display_name text NOT NULL,
  character integer NOT NULL DEFAULT 0 CHECK (character BETWEEN 0 AND 7)
);
CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  x double precision NOT NULL, y double precision NOT NULL,
  status text NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'focus', 'do-not-disturb')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE UNIQUE INDEX one_owner_per_workspace ON memberships(workspace_id) WHERE role = 'owner';
CREATE TABLE desk_assignments (
  workspace_id uuid NOT NULL, zone_id text NOT NULL, user_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, zone_id), UNIQUE (workspace_id, user_id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);
CREATE TABLE login_tokens (
  hash text PRIMARY KEY, workspace_id uuid NOT NULL, user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);
CREATE TABLE sessions (
  hash text PRIMARY KEY, workspace_id uuid NOT NULL, user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, user_id) REFERENCES memberships(workspace_id, user_id) ON DELETE CASCADE
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX login_tokens_member ON login_tokens(workspace_id, user_id);
