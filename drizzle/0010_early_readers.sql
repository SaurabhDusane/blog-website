CREATE TABLE early_reader_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES desk_revisions(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  note TEXT,
  received_at INTEGER
);
--> statement-breakpoint
CREATE INDEX early_reader_revision ON early_reader_invites(revision_id, id DESC);
