import { exportReaderResponses, stanceMovement, stancePairs } from './response-backups.mjs';
import { createFieldNoteStorage } from './field-note-storage.mjs';

const feedbackSql = {
  save: `
    INSERT INTO reader_feedback (post_slug, reader_key, feeling, note, answer, submitted_at, feature_consent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_slug, reader_key) DO NOTHING
    RETURNING id
  `,
  mine: 'SELECT feeling FROM reader_feedback WHERE post_slug = ? AND reader_key = ?',
  counts: 'SELECT post_slug AS postId, feeling, count(*) AS count FROM reader_feedback GROUP BY post_slug, feeling',
  postCounts: 'SELECT feeling, count(*) AS count FROM reader_feedback WHERE post_slug = ? GROUP BY feeling',
  trends: `
    SELECT post_slug AS postId, substr(submitted_at, 1, 10) AS date, count(*) AS count
    FROM reader_feedback WHERE submitted_at >= ?
    GROUP BY post_slug, substr(submitted_at, 1, 10)
    ORDER BY date, postId
  `,
  recentNotes: `
    SELECT id, post_slug AS postId, feeling, note, answer, submitted_at AS submittedAt, pinned, feature_consent AS featureConsent
    FROM reader_feedback WHERE note IS NOT NULL OR answer IS NOT NULL
    ORDER BY pinned DESC, id DESC LIMIT 250
  `,
  pin: `
    UPDATE reader_feedback SET pinned = ? WHERE id = ? AND (note IS NOT NULL OR answer IS NOT NULL)
    RETURNING id
  `,
  saveStance: `
    INSERT INTO reader_stances (post_slug, reader_key, stance, submitted_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(post_slug, reader_key) DO NOTHING
    RETURNING stance
  `,
  ownStance: 'SELECT stance FROM reader_stances WHERE post_slug = ? AND reader_key = ?',
  stanceCounts: 'SELECT stance, count(*) AS count FROM reader_stances WHERE post_slug = ? GROUP BY stance',
  allStanceCounts: 'SELECT post_slug AS postId, stance, count(*) AS count FROM reader_stances GROUP BY post_slug, stance',
  saveReconsideration: `
    INSERT INTO reader_reconsiderations (post_slug, reader_key, stance, submitted_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (post_slug, reader_key) DO NOTHING
    RETURNING stance
  `,
  ownReconsideration: 'SELECT stance FROM reader_reconsiderations WHERE post_slug = ? AND reader_key = ?',
  reconsiderationCounts: `
    SELECT ${stanceMovement} AS movement, count(*) AS count
    ${stancePairs}
    WHERE reconsidered.post_slug = ? AND reconsidered.reader_key <> ?
    GROUP BY movement
  `,
  privateReplies: `
    SELECT id, post_slug AS postId, message, email, received_at AS receivedAt
    FROM author_replies ORDER BY id DESC LIMIT 100
  `,
  monthlyNote: `
    SELECT featured.month, featured.excerpt, response.post_slug AS postId
    FROM featured_reader_notes featured
    JOIN reader_feedback response ON response.id = featured.response_id
    WHERE featured.month = ? AND response.feature_consent = 1
  `,
  featureNote: `
    INSERT INTO featured_reader_notes (month, response_id, excerpt)
    SELECT ?, id, ? FROM reader_feedback
    WHERE id = ? AND post_slug = ? AND feature_consent = 1 AND instr(note, ?) > 0
    ON CONFLICT(month) DO UPDATE SET response_id = excluded.response_id, excerpt = excluded.excerpt
    RETURNING response_id
  `,
  removeFeature: 'DELETE FROM featured_reader_notes WHERE month = ?',
  createSalt: `INSERT INTO reader_feedback_config (name, value) VALUES ('rate-salt', ?) ON CONFLICT(name) DO NOTHING`,
  getSalt: `SELECT value FROM reader_feedback_config WHERE name = 'rate-salt'`,
  take: `
    INSERT INTO reader_rate_limits (scope, subject, window_start, attempts) VALUES (?, ?, ?, 1)
    ON CONFLICT(scope, subject, window_start) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ?
    RETURNING attempts
  `,
  pruneRateLimits: 'DELETE FROM reader_rate_limits WHERE window_start < ?',
  addSession: 'INSERT INTO author_sessions (token_key, expires_at) VALUES (?, ?)',
  session: 'SELECT 1 FROM author_sessions WHERE token_key = ? AND expires_at > ?',
  removeSession: 'DELETE FROM author_sessions WHERE token_key = ?',
  pruneSessions: 'DELETE FROM author_sessions WHERE expires_at <= ?',
};

export function createFeedbackStorage(all, run) {
  return {
    ...createFieldNoteStorage(all),
    exportReaderResponses: (now) => exportReaderResponses(all, now),
    checkResponseStorage: () => all('SELECT 1 FROM reader_feedback LIMIT 1'),
    async saveFeedback(postId, readerKey, feeling, note, answer, submittedAt, featureConsent = false) {
      return (await all(feedbackSql.save, postId, readerKey, feeling, note, answer, submittedAt, featureConsent ? 1 : 0)).length > 0;
    },
    async ownFeedback(...values) {
      return (await all(feedbackSql.mine, ...values))[0]?.feeling;
    },
    feelingCounts: (postId) => all(feedbackSql.postCounts, postId),
    allFeelingCounts: () => all(feedbackSql.counts),
    feedbackTrends: (since) => all(feedbackSql.trends, since),
    feedbackNotes: () => all(feedbackSql.recentNotes),
    async pinFeedback(id, pinned) {
      return (await all(feedbackSql.pin, pinned ? 1 : 0, id)).length > 0;
    },
    async saveStance(...values) {
      return (await all(feedbackSql.saveStance, ...values)).length > 0;
    },
    async ownStance(...values) {
      return (await all(feedbackSql.ownStance, ...values))[0]?.stance;
    },
    stanceCounts: (postId) => all(feedbackSql.stanceCounts, postId),
    allStanceCounts: () => all(feedbackSql.allStanceCounts),
    async saveReconsideration(...values) {
      return (await all(feedbackSql.saveReconsideration, ...values)).length > 0;
    },
    async ownReconsideration(...values) {
      return (await all(feedbackSql.ownReconsideration, ...values))[0]?.stance;
    },
    reconsiderationCounts: (postId, readerKey) => all(feedbackSql.reconsiderationCounts, postId, readerKey),
    privateReplies: () => all(feedbackSql.privateReplies),
    async monthlyNote(month) {
      return (await all(feedbackSql.monthlyNote, month))[0];
    },
    async featureMonthlyNote(month, id, postId, excerpt) {
      return (await all(feedbackSql.featureNote, month, excerpt, id, postId, excerpt)).length > 0;
    },
    removeMonthlyNote: (month) => run(feedbackSql.removeFeature, month),
    async rateSalt(create) {
      const old = (await all(feedbackSql.getSalt))[0];
      if (old) return old.value;
      await run(feedbackSql.createSalt, create());
      return (await all(feedbackSql.getSalt))[0]?.value;
    },
    async takeRateSlot(...values) {
      return (await all(feedbackSql.take, ...values)).length > 0;
    },
    pruneRateLimits: (oldest) => run(feedbackSql.pruneRateLimits, oldest),
    addAuthorSession: (key, expires) => run(feedbackSql.addSession, key, expires),
    async hasAuthorSession(key, now) {
      return (await all(feedbackSql.session, key, now)).length > 0;
    },
    deleteAuthorSession: (key) => run(feedbackSql.removeSession, key),
    pruneAuthorSessions: (now) => run(feedbackSql.pruneSessions, now),
  };
}
