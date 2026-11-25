CREATE TABLE reader_readership (
  post_slug TEXT NOT NULL,
  day TEXT NOT NULL CHECK (length(day) = 10),
  kind TEXT NOT NULL CHECK (kind IN ('finished', 'saved')),
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (post_slug, day, kind)
);
--> statement-breakpoint
CREATE INDEX reader_readership_day ON reader_readership (day);
