CREATE TABLE desk_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  document_key TEXT,
  filename TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX desk_revisions_slug ON desk_revisions(slug, id DESC);
--> statement-breakpoint
CREATE TABLE desk_publications (
  slug TEXT PRIMARY KEY,
  revision INTEGER NOT NULL REFERENCES desk_revisions(id),
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE essay_voice_notes (
  slug TEXT PRIMARY KEY,
  audio_key TEXT NOT NULL,
  transcript TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
