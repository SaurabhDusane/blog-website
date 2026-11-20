CREATE TABLE reader_feedback (
  id INTEGER PRIMARY KEY,
  post_slug TEXT NOT NULL,
  reader_key TEXT NOT NULL,
  feeling TEXT NOT NULL CHECK (feeling IN ('inspired', 'thoughtful', 'challenged', 'comforted', 'surprised', 'not-convinced')),
  note TEXT,
  answer TEXT,
  submitted_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  UNIQUE (post_slug, reader_key)
);
--> statement-breakpoint
CREATE INDEX reader_feedback_post_feeling ON reader_feedback(post_slug, feeling);
--> statement-breakpoint
CREATE INDEX reader_feedback_timestamp ON reader_feedback(submitted_at, post_slug);
--> statement-breakpoint
CREATE TABLE reader_feedback_config (
  name TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE reader_rate_limits (
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (scope, subject, window_start)
);
--> statement-breakpoint
CREATE INDEX reader_rate_limits_window ON reader_rate_limits(window_start);
--> statement-breakpoint
CREATE TABLE author_sessions (
  token_key TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX author_sessions_expiry ON author_sessions(expires_at);
