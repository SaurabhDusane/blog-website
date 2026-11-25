import { mediaKey } from './editorial-media.mjs';

export const recoveryFormat = 'second-ink-recovery-v1';
export const recoveryColumns = Object.fromEntries(Object.entries({
  newsletter_subscriptions: 'email subscribed_at',
  newsletter_contacts: 'email id created_at confirmed_at unsubscribed_at confirmation_hash confirmation_deadline last_attempt_at',
  newsletter_digests: 'id subject body approved_at',
  newsletter_deliveries: 'digest_id contact_id state first_attempt_at lease_until sent_at',
  author_replies: 'id post_slug message email received_at',
  reader_feedback: 'id post_slug reader_key feeling note answer submitted_at pinned feature_consent',
  reader_feedback_config: 'name value',
  featured_reader_notes: 'month response_id excerpt',
  reader_stances: 'post_slug reader_key stance submitted_at',
  reader_reconsiderations: 'post_slug reader_key stance submitted_at',
  reader_field_notes: 'id post_slug reader_key prompt note quote_consent status submitted_at',
  reader_readership: 'post_slug day kind count',
  desk_revisions: 'id slug title description body document_key filename created_at topic_ids mood label_overrides connections',
  desk_publications: 'slug revision published_at updated_at',
  essay_voice_notes: 'slug audio_key transcript updated_at',
  early_reader_invites: 'id revision_id token_hash label created_at expires_at revoked_at note received_at',
}).map(([table, columns]) => [table, columns.split(' ')]));

const encoder = new TextEncoder();
const maxRows = 20_000;
const maxDatabaseBytes = 24 * 1024 * 1024;
const mediaChunk = 24 * 1024;
const fullExportSql = Object.entries(recoveryColumns).map(([table, columns]) => {
  const values = columns.flatMap((column) => [`'${column}'`, `recovery_row."${column}"`]).join(', ');
  return `SELECT '${table}' AS tableName, json_object(${values}) AS record FROM (SELECT * FROM ${table} LIMIT ${maxRows + 1}) recovery_row`;
}).join(' UNION ALL ');

export async function snapshotRecoveryRows(all) {
  const rows = await all(fullExportSql);
  if (rows.length > maxRows) throw new Error('Recovery row limit reached');
  let bytes = 0;
  for (const row of rows) {
    bytes += encoder.encode(row.record).byteLength;
    if (bytes > maxDatabaseBytes) throw new Error('Recovery database size limit reached');
  }
  return rows;
}

export function referencedRecoveryMedia(table, row) {
  const kind = table === 'desk_revisions' ? 'document' : table === 'essay_voice_notes' ? 'audio' : undefined;
  if (!kind) return null;
  const key = row[`${kind}_key`];
  if (key === null && kind === 'document') return null;
  if (!mediaKey(key, kind)) throw new Error('Invalid attachment reference');
  return key;
}

function line(value) { return encoder.encode(JSON.stringify(value) + '\n'); }

async function* chunks(body) {
  if (body instanceof Uint8Array) {
    for (let index = 0; index < body.length; index += mediaChunk) yield body.subarray(index, index + mediaChunk);
    return;
  }
  if (!body?.getReader) throw new Error('Recovery media is unreadable');
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      for (let index = 0; index < value.length; index += mediaChunk) yield value.subarray(index, index + mediaChunk);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function recoveryArchive(rows, bucket, now) {
  const attachments = new Set();
  for (const { tableName, record } of rows) {
    if (tableName !== 'desk_revisions' && tableName !== 'essay_voice_notes') continue;
    const key = referencedRecoveryMedia(tableName, JSON.parse(record));
    if (key) attachments.add(key);
  }
  if (attachments.size && !bucket) throw new Error('Recovery media is unavailable');

  async function* archive() {
    yield line({ type: 'header', format: recoveryFormat, exportedAt: new Date(now).toISOString() });
    for (const { tableName, record } of rows) {
      yield encoder.encode(`{"type":"row","table":${JSON.stringify(tableName)},"data":${record}}\n`);
    }
    for (const key of attachments) {
      const head = await bucket.head(key);
      if (!head || !Number.isSafeInteger(head.size) || head.size < 1) throw new Error('A recovery attachment is missing');
      const object = await bucket.get(key);
      if (!object) throw new Error('A recovery attachment is missing');
      yield line({ type: 'media', key, size: head.size });
      let size = 0;
      for await (const bytes of chunks(object.body)) {
        size += bytes.length;
        if (size > head.size) throw new Error('An attachment changed during export');
        yield line({ type: 'chunk', bytes: btoa(String.fromCharCode(...bytes)) });
      }
      if (size !== head.size) throw new Error('The attachment export was incomplete');
      yield line({ type: 'end-media' });
    }
    yield line({ type: 'complete', rows: rows.length, attachments: attachments.size });
  }

  const iterator = archive();
  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) { controller.close(); return; }
      controller.enqueue(value);
    },
    cancel: () => iterator.return(),
  });
}
