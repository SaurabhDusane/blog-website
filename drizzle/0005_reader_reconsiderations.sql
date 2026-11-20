CREATE TABLE reader_reconsiderations (
  post_slug TEXT NOT NULL,
  reader_key TEXT NOT NULL,
  stance TEXT NOT NULL CHECK (stance IN ('agree', 'unsure', 'disagree', 'still-thinking')),
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (post_slug, reader_key),
  FOREIGN KEY (post_slug, reader_key) REFERENCES reader_stances(post_slug, reader_key) ON DELETE CASCADE
);
