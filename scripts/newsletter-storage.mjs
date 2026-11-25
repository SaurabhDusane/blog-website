export function createNewsletterStorage(all, run) {
  return {
    async requestNewsletterConfirmation({ email, id, now, hash, deadline, retryAfter }) {
      const [entry] = await all(`INSERT INTO newsletter_contacts
        (email, id, created_at, confirmation_hash, confirmation_deadline, last_attempt_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET confirmation_hash = excluded.confirmation_hash,
          confirmation_deadline = excluded.confirmation_deadline, last_attempt_at = excluded.last_attempt_at
        WHERE (newsletter_contacts.confirmed_at IS NULL OR newsletter_contacts.unsubscribed_at IS NOT NULL)
          AND (newsletter_contacts.last_attempt_at <= ? OR (newsletter_contacts.confirmation_hash IS NULL
            AND excluded.confirmation_hash IS NOT NULL))
        RETURNING id`, email, id, now, hash, deadline, now, retryAfter);
      return entry;
    },
    async confirmNewsletter(hash, now) {
      const [entry] = await all(`UPDATE newsletter_contacts SET confirmed_at = ?, unsubscribed_at = NULL,
          confirmation_hash = NULL, confirmation_deadline = NULL
        WHERE confirmation_hash = ? AND confirmation_deadline > ? RETURNING id`, now, hash, now);
      return Boolean(entry);
    },
    unsubscribeNewsletter: (id, now) => run(`UPDATE newsletter_contacts SET unsubscribed_at = COALESCE(unsubscribed_at, ?),
      confirmation_hash = NULL, confirmation_deadline = NULL WHERE id = ?`, now, id),
    async newsletterCounts() {
      const [counts] = await all(`SELECT
        (SELECT COUNT(*) FROM newsletter_contacts WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL) AS confirmed,
        (SELECT COUNT(*) FROM newsletter_contacts WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL) AS pending,
        (SELECT COUNT(*) FROM newsletter_subscriptions l WHERE NOT EXISTS
          (SELECT 1 FROM newsletter_contacts c WHERE c.email = l.email)) AS legacy`);
      return counts;
    },
    async newsletterDigest(id) {
      const [entry] = await all('SELECT id, subject, body, approved_at AS approvedAt FROM newsletter_digests WHERE id = ?', id);
      return entry;
    },
    newsletterRecentDigests: () => all('SELECT id, subject, approved_at AS approvedAt FROM newsletter_digests ORDER BY approved_at DESC LIMIT 5'),
    async approveNewsletterDigest(id, subject, body, now) {
      await run('INSERT OR IGNORE INTO newsletter_digests (id, subject, body, approved_at) VALUES (?, ?, ?, ?)', id, subject, body, now);
      await run(`INSERT OR IGNORE INTO newsletter_deliveries (digest_id, contact_id)
        SELECT d.id, c.id FROM newsletter_contacts c JOIN newsletter_digests d ON d.id = ?
        WHERE c.unsubscribed_at IS NULL AND c.confirmed_at <= d.approved_at`, id);
    },
    async claimNewsletterDeliveries(id, { now, lease, retryCutoff, limit }) {
      await run(`UPDATE newsletter_deliveries SET state = 'skipped' WHERE digest_id = ? AND state = 'queued'
        AND lease_until <= ? AND NOT EXISTS (SELECT 1 FROM newsletter_contacts c JOIN newsletter_digests d ON d.id = ?
          WHERE c.id = newsletter_deliveries.contact_id AND c.unsubscribed_at IS NULL AND c.confirmed_at <= d.approved_at)`, id, now, id);
      await run(`UPDATE newsletter_deliveries SET state = 'review' WHERE digest_id = ? AND state = 'queued'
        AND lease_until <= ? AND first_attempt_at < ?`, id, now, retryCutoff);
      return all(`UPDATE newsletter_deliveries SET lease_until = ?, first_attempt_at = COALESCE(first_attempt_at, ?)
        WHERE digest_id = ? AND state = 'queued' AND lease_until <= ? AND contact_id IN (
          SELECT contact_id FROM newsletter_deliveries WHERE digest_id = ? AND state = 'queued' AND lease_until <= ?
          ORDER BY contact_id LIMIT ?)
        RETURNING contact_id AS contactId`, lease, now, id, now, id, now, limit);
    },
    async newsletterDeliveryContact(digestId, contactId) {
      const [entry] = await all(`SELECT c.email FROM newsletter_contacts c JOIN newsletter_digests d ON d.id = ?
        WHERE c.id = ? AND c.unsubscribed_at IS NULL AND c.confirmed_at <= d.approved_at`, digestId, contactId);
      return entry;
    },
    finishNewsletterDelivery: (digestId, contactId, lease, state, now) => run(`UPDATE newsletter_deliveries
      SET state = ?, sent_at = ? WHERE digest_id = ? AND contact_id = ? AND lease_until = ? AND state = 'queued'`,
    state, state === 'sent' ? now : null, digestId, contactId, lease),
    async newsletterDigestSummary(id) {
      const rows = await all('SELECT state, COUNT(*) AS total FROM newsletter_deliveries WHERE digest_id = ? GROUP BY state', id);
      return { queued: 0, sent: 0, skipped: 0, review: 0, ...Object.fromEntries(rows.map(({ state, total }) => [state, total])) };
    },
  };
}
