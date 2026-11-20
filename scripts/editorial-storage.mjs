import { sortEssay } from './essay-classifier.mjs';

const revisionFields = `id, slug, title, description, body, document_key AS documentKey,
  filename, created_at AS createdAt, topic_ids AS topicIds, mood, label_overrides AS labelOverrides`;
const publicationFields = `p.slug, p.revision, p.published_at AS publishedAt,
  p.updated_at AS updatedAt, r.title, r.description, r.topic_ids AS topicIds, r.mood`;

const changed = (result) => Boolean(result.meta?.changes ?? result.changes);

function classified(row) {
  if (!row) return row;
  const { topicIds, mood, labelOverrides, ...essay } = row;
  const overrides = labelOverrides ? JSON.parse(labelOverrides) : {};
  if (topicIds !== null && topicIds !== undefined) return { ...essay, topics: JSON.parse(topicIds), mood, overrides };
  const sorting = essay.body ? sortEssay(essay) : { topics: [], mood: 'reflective' };
  return { ...essay, topics: sorting.topics, mood: sorting.mood, overrides };
}

export function createEditorialStorage(all, run) {
  const one = async (...args) => (await all(...args))[0];
  return {
    deskEntries: () => all(`SELECT r.slug, r.id, r.title, r.created_at AS createdAt,
        p.revision AS liveRevision FROM desk_revisions r
      LEFT JOIN desk_publications p ON p.slug = r.slug
      WHERE r.id = (SELECT MAX(id) FROM desk_revisions WHERE slug = r.slug)
      ORDER BY r.id DESC`),
    deskHistory: (slug, before) => all(`SELECT id, title, created_at AS createdAt
      FROM desk_revisions WHERE slug = ? AND id < ? ORDER BY id DESC LIMIT 26`, slug, before),
    deskRevision: async (slug, id) => classified(await (id
      ? one(`SELECT ${revisionFields} FROM desk_revisions WHERE slug = ? AND id = ?`, slug, id)
      : one(`SELECT ${revisionFields} FROM desk_revisions WHERE slug = ? ORDER BY id DESC LIMIT 1`, slug))),
    async saveDeskRevision(slug, base, essay, now) {
      const { title, description, body, documentKey, filename } = essay;
      const sorting = Array.isArray(essay.topics) ? essay : sortEssay(essay);
      const overrides = essay.overrides ?? {};
      return classified(await one(`INSERT INTO desk_revisions (slug, title, description, body, document_key, filename, created_at, topic_ids, mood, label_overrides)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((SELECT MAX(id) FROM desk_revisions WHERE slug = ?), 0) = ?
        RETURNING ${revisionFields}`, slug, title, description, body, documentKey, filename, now,
      JSON.stringify(overrides.topics ?? sorting.topics), overrides.mood ?? sorting.mood, JSON.stringify(overrides), slug, base));
    },
    async publishDeskRevision(slug, id, now) {
      return changed(await run(`INSERT INTO desk_publications (slug, revision, published_at, updated_at)
        SELECT slug, id, ?, ? FROM desk_revisions
        WHERE slug = ? AND id = ? AND id = (SELECT MAX(id) FROM desk_revisions WHERE slug = ?)
        ON CONFLICT(slug) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at
        WHERE desk_publications.revision <> excluded.revision`, now, now, slug, id, slug));
    },
    async withdrawDeskPublication(slug, id) {
      return changed(await run('DELETE FROM desk_publications WHERE slug = ? AND revision = ?', slug, id));
    },
    deskPublication: async (slug) => classified(await one(`SELECT ${publicationFields}, r.body, r.document_key AS documentKey, r.filename
      FROM desk_publications p JOIN desk_revisions r ON p.revision = r.id WHERE p.slug = ?`, slug)),
    deskPublications: async ({ includeBody = false } = {}) => (await all(`SELECT ${publicationFields}${includeBody ? ', r.body' : ''} FROM desk_publications p
      JOIN desk_revisions r ON p.revision = r.id ORDER BY p.published_at DESC, p.slug`)).map(classified),
    voiceNote: (slug) => one(`SELECT audio_key AS audioKey, transcript, updated_at AS updatedAt
      FROM essay_voice_notes WHERE slug = ?`, slug),
    saveVoiceNote: (slug, key, transcript, now) => run(`INSERT INTO essay_voice_notes
      (slug, audio_key, transcript, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET audio_key = excluded.audio_key, transcript = excluded.transcript,
      updated_at = excluded.updated_at`, slug, key, transcript, now),
    removeVoiceNote: (slug) => run('DELETE FROM essay_voice_notes WHERE slug = ?', slug),
  };
}
