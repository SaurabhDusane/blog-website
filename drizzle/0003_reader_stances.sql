CREATE TABLE reader_stances (
  post_slug TEXT NOT NULL,
  reader_key TEXT NOT NULL,
  stance TEXT NOT NULL CHECK (stance IN ('agree', 'unsure', 'disagree')),
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (post_slug, reader_key)
);
--> statement-breakpoint
CREATE INDEX reader_stances_post_stance ON reader_stances(post_slug, stance);
