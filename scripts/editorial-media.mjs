const mib = 1024 * 1024;
const signature = (bytes, offset, text) => [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
const types = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

export function mediaKey(value, kind) {
  if (typeof value !== 'string') return false;
  return (kind === 'audio' ? /^audio\/[a-f0-9]{64}\.(?:mp3|m4a|wav|ogg)$/
    : /^document\/[a-f0-9]{64}\.(?:docx|pdf)$/).test(value);
}

function audioExtension(bytes) {
  if (signature(bytes, 0, 'ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224)) return 'mp3';
  if (signature(bytes, 4, 'ftyp')) return 'm4a';
  if (signature(bytes, 0, 'RIFF') && signature(bytes, 8, 'WAVE')) return 'wav';
  if (signature(bytes, 0, 'OggS')) return 'ogg';
}

async function boundedBytes(request, max) {
  const reader = request.body?.getReader();
  if (!reader || Number(request.headers.get('Content-Length')) > max) {
    await reader?.cancel().catch(() => {});
    return null;
  }
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function uploadEditorialMedia(request, bucket, kind, filename) {
  const isAudio = kind === 'audio';
  const bytes = await boundedBytes(request, (isAudio ? 16 : 20) * mib);
  if (!bytes) return { error: isAudio ? 'Choose a recording up to 16 MiB.' : 'Choose a document up to 20 MiB.', status: 413 };
  let extension;
  if (isAudio) extension = audioExtension(bytes);
  else if (/\.docx$/i.test(filename) && signature(bytes, 0, 'PK\x03\x04')) extension = 'docx';
  else if (/\.pdf$/i.test(filename) && new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) extension = 'pdf';
  if (!extension) {
    return { error: isAudio ? 'Choose an MP3, M4A, WAV, or Ogg recording.' : 'Choose a readable Word (.docx) or PDF file.', status: 415 };
  }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    (value) => value.toString(16).padStart(2, '0')).join('');
  const key = `${kind}/${hash}.${extension}`;
  if (!await bucket.head(key)) await bucket.put(key, bytes, { httpMetadata: { contentType: types[extension] } });
  return { key };
}

export async function serveEditorialMedia(request, bucket, key, filename) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const object = await bucket?.head(key);
  if (!object) return new Response(null, { status: 404 });
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Type': types[key.split('.').at(-1)] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'X-Robots-Tag': 'noindex',
  });
  if (filename) {
    headers.set('Content-Disposition', `attachment; filename="${filename.replace(/[^a-z0-9._ -]/gi, '_')}"`);
  }
  const range = request.headers.get('Range');
  let length = object.size;
  let offset = 0;
  if (range) {
    const values = /^bytes=(\d*)-(\d*)$/i.exec(range);
    const start = values?.[1] ? Number(values[1]) : Math.max(0, length - Number(values?.[2]));
    const last = values?.[1] && values[2] ? Math.min(length - 1, Number(values[2])) : length - 1;
    if (!values || !Number.isSafeInteger(start) || !Number.isSafeInteger(last) || start < 0 || last >= length || last < start) {
      headers.set('Content-Range', `bytes */${length}`);
      return new Response(null, { status: 416, headers });
    }
    offset = start;
    length = last - start + 1;
    headers.set('Content-Range', `bytes ${start}-${last}/${object.size}`);
  }
  headers.set('Content-Length', String(length));
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const result = await bucket.get(key, range ? { range: { offset, length } } : undefined);
  return result ? new Response(result.body, { status, headers }) : new Response(null, { status: 404 });
}
