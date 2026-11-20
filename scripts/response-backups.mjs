const prefix = 'reader-responses/';
const dateFormat = /^\d{4}-\d{2}-\d{2}$/;
const day = 24 * 60 * 60 * 1000;
const sectionLimit = 2000;

export const stanceMovement = `CASE
  WHEN reconsidered.stance = 'still-thinking' THEN 'thinking'
  WHEN reconsidered.stance = initial.stance THEN 'kept'
  ELSE 'changed'
END`;
export const stancePairs = `FROM reader_reconsiderations reconsidered
  JOIN reader_stances initial USING (post_slug, reader_key)`;

// A single SQLite statement gives all sections the same point-in-time view.
const exportSql = `
  SELECT 'responses' AS section, json_object(
    'id', id, 'postId', post_slug, 'feeling', feeling, 'note', note, 'answer', answer,
    'submittedAt', submitted_at, 'pinned', pinned, 'featureConsent', feature_consent
  ) AS record FROM (SELECT * FROM reader_feedback ORDER BY id LIMIT ${sectionLimit + 1})
  UNION ALL
  SELECT 'stances', json_object('postId', post_slug, 'stance', stance, 'count', total)
  FROM (
    SELECT post_slug, stance, count(*) AS total FROM reader_stances
    GROUP BY post_slug, stance ORDER BY post_slug, stance LIMIT ${sectionLimit + 1}
  )
  UNION ALL
  SELECT 'reconsiderations', json_object('postId', post_slug, 'movement', movement, 'count', total)
  FROM (
    SELECT reconsidered.post_slug, ${stanceMovement} AS movement, count(*) AS total
    ${stancePairs}
    GROUP BY reconsidered.post_slug, movement
    ORDER BY reconsidered.post_slug, movement LIMIT ${sectionLimit + 1}
  )
  UNION ALL
  SELECT 'privateReplies', json_object(
    'id', id, 'postId', post_slug, 'message', message, 'email', email, 'receivedAt', received_at
  ) FROM (SELECT * FROM author_replies ORDER BY id LIMIT ${sectionLimit + 1})
  UNION ALL
  SELECT 'featuredNotes', json_object('month', month, 'responseId', response_id, 'excerpt', excerpt)
  FROM (SELECT * FROM featured_reader_notes ORDER BY month LIMIT ${sectionLimit + 1})
  UNION ALL
  SELECT 'fieldNotes', json_object(
    'id', id, 'postId', post_slug, 'prompt', prompt, 'note', note,
    'quoteConsent', json(CASE quote_consent WHEN 1 THEN 'true' ELSE 'false' END),
    'status', status, 'submittedAt', submitted_at
  ) FROM (SELECT * FROM reader_field_notes ORDER BY id LIMIT ${sectionLimit + 1})
`;

export async function exportReaderResponses(all, now) {
  const sections = { responses: [], stances: [], reconsiderations: [], privateReplies: [], featuredNotes: [], fieldNotes: [] };
  for (const { section, record } of await all(exportSql)) {
    if (sections[section].length >= sectionLimit) throw new Error('Response export row limit reached');
    sections[section].push(JSON.parse(record));
  }
  const { reconsiderations, fieldNotes, ...existingSections } = sections;
  const body = JSON.stringify({
    format: 'second-ink-reader-responses-v1',
    exportedAt: new Date(now).toISOString(),
    ...existingSections,
    ...(reconsiderations.length ? { reconsiderations } : {}),
    ...(fieldNotes.length ? { fieldNotes } : {}),
  }, null, 2) + '\n';
  if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024) throw new Error('Response export size limit reached');
  return body;
}

export function backupWeek(now) {
  // Phoenix observes UTC-7 year round. Week keys are Sunday dates in Arizona.
  const local = new Date(now - 7 * 60 * 60 * 1000);
  return new Date(local.getTime() - local.getUTCDay() * day).toISOString().slice(0, 10);
}

function backupKey(week) {
  return `${prefix}${week}.json`;
}

export function getWeeklyBackup(bucket, week) {
  return dateFormat.test(week) ? bucket.get(backupKey(week)) : null;
}

export async function listWeeklyBackups(bucket, after) {
  const options = { prefix, limit: 100 };
  if (after) options.startAfter = backupKey(after);
  const page = await bucket.list(options);
  const weeks = page.objects
    .map(({ key }) => key.slice(prefix.length, -5))
    .filter((week) => dateFormat.test(week));
  return { weeks, nextAfter: page.truncated ? weeks.at(-1) ?? null : null };
}

export async function weeklyBackupStatus(bucket, week) {
  return Boolean(await bucket.head(backupKey(week)));
}

export async function saveWeeklyBackup(bucket, storage, now, week) {
  if (await weeklyBackupStatus(bucket, week)) return 'already-saved';
  const body = await storage.exportReaderResponses(now);
  const object = await bucket.put(backupKey(week), body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    onlyIf: new Headers({ 'If-None-Match': '*' }),
  });
  return object ? 'saved' : 'already-saved';
}
