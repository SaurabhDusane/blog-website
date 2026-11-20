CREATE TABLE reader_field_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_slug TEXT NOT NULL,
  reader_key TEXT NOT NULL,
  prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 240),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  quote_consent INTEGER NOT NULL DEFAULT 0 CHECK (quote_consent IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'archived')),
  submitted_at TEXT NOT NULL,
  UNIQUE (post_slug, reader_key)
);
--> statement-breakpoint
CREATE INDEX reader_field_notes_by_status ON reader_field_notes (status, id);
--> statement-breakpoint
CREATE INDEX reader_field_notes_by_post ON reader_field_notes (post_slug, id);
