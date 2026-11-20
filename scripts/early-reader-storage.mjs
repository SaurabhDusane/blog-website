const fields = `id, label, created_at AS createdAt, expires_at AS expiresAt,
  revoked_at AS revokedAt, note, received_at AS receivedAt`;

export function createEarlyReaderStorage(all, run) {
  return {
    earlyInvites: (revisionId) => all(`SELECT ${fields} FROM early_reader_invites
      WHERE revision_id = ? ORDER BY id DESC LIMIT 60`, revisionId),
    async createEarlyInvite(revisionId, tokenHash, label, now, expiresAt) {
      const [row] = await all(`INSERT INTO early_reader_invites (revision_id, token_hash, label, created_at, expires_at)
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM desk_revisions WHERE id = ?)
        AND (SELECT count(*) FROM early_reader_invites WHERE revision_id = ? AND revoked_at IS NULL AND expires_at > ?) < 12
        RETURNING ${fields}`, revisionId, tokenHash, label, now, expiresAt, revisionId, revisionId, now);
      return row;
    },
    async revokeEarlyInvite(revisionId, id, now) {
      const result = await run(`UPDATE early_reader_invites SET revoked_at = COALESCE(revoked_at, ?)
        WHERE id = ? AND revision_id = ?`, now, id, revisionId);
      return Boolean(result.meta?.changes ?? result.changes);
    },
    async earlyDraft(tokenHash, now) {
      const [row] = await all(`SELECT r.title, r.description, r.body, i.expires_at AS expiresAt,
          i.received_at IS NOT NULL AS responded
        FROM early_reader_invites i JOIN desk_revisions r ON i.revision_id = r.id
        WHERE i.token_hash = ? AND i.revoked_at IS NULL AND i.expires_at > ?`, tokenHash, now);
      return row;
    },
    async leaveEarlyNote(tokenHash, note, now) {
      const result = await run(`UPDATE early_reader_invites SET note = ?, received_at = ?
        WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND received_at IS NULL`, note, now, tokenHash, now);
      return Boolean(result.meta?.changes ?? result.changes);
    },
  };
}
