CREATE TABLE newsletter_contacts (
  email TEXT PRIMARY KEY NOT NULL,
  id TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  unsubscribed_at INTEGER,
  confirmation_hash TEXT UNIQUE,
  confirmation_deadline INTEGER,
  last_attempt_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE newsletter_digests (
  id TEXT PRIMARY KEY NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  approved_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE newsletter_deliveries (
  digest_id TEXT NOT NULL REFERENCES newsletter_digests (id),
  contact_id TEXT NOT NULL REFERENCES newsletter_contacts (id),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sent', 'skipped', 'review')),
  first_attempt_at INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER,
  PRIMARY KEY (digest_id, contact_id)
);
--> statement-breakpoint
CREATE INDEX newsletter_delivery_queue ON newsletter_deliveries (digest_id, state, lease_until);
