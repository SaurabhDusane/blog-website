const saveNote = `
  INSERT INTO reader_field_notes (post_slug, reader_key, prompt, note, quote_consent, submitted_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (post_slug, reader_key) DO NOTHING
  RETURNING id
`;
const ownNote = `SELECT 1 FROM reader_field_notes WHERE post_slug = ? AND reader_key = ?`;
const setStatus = `UPDATE reader_field_notes SET status = ? WHERE id = ? RETURNING id`;

export function createFieldNoteStorage(all) {
  return {
    async saveFieldNote(postId, readerKey, prompt, note, quoteConsent, submittedAt) {
      return (await all(saveNote, postId, readerKey, prompt, note, quoteConsent ? 1 : 0, submittedAt)).length > 0;
    },
    async ownFieldNote(postId, readerKey) {
      return (await all(ownNote, postId, readerKey)).length > 0;
    },
    async moderateFieldNote(id, status) {
      return (await all(setStatus, status, id)).length > 0;
    },
    fieldNotes({ postId, status, before }, limit) {
      const filters = [];
      const values = [];
      if (postId) {
        filters.push('post_slug = ?');
        values.push(postId);
      }
      if (status) {
        filters.push('status = ?');
        values.push(status);
      }
      if (before !== null) {
        filters.push('id < ?');
        values.push(before);
      }
      return all(`
        SELECT id, post_slug AS postId, prompt, note, quote_consent AS quoteConsent,
          status, submitted_at AS submittedAt
        FROM reader_field_notes ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY id DESC LIMIT ?
      `, ...values, limit);
    },
  };
}
