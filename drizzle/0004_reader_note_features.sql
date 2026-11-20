ALTER TABLE reader_feedback
ADD COLUMN feature_consent INTEGER NOT NULL DEFAULT 0 CHECK (feature_consent IN (0, 1));
--> statement-breakpoint
CREATE TABLE featured_reader_notes (
  month TEXT PRIMARY KEY NOT NULL CHECK (length(month) = 7),
  response_id INTEGER NOT NULL REFERENCES reader_feedback(id) ON DELETE CASCADE,
  excerpt TEXT NOT NULL CHECK (length(excerpt) BETWEEN 1 AND 240)
);
