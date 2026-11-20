CREATE TABLE IF NOT EXISTS author_replies (
  id INTEGER PRIMARY KEY,
  post_slug TEXT NOT NULL,
  message TEXT NOT NULL,
  email TEXT,
  received_at TEXT NOT NULL
);
