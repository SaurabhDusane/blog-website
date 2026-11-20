import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

export const sourceLinkSnapshotPath = '.data/source-link-status.json';
export const sourceLinkInventoryPath = 'dist/posts/sources.json';

const privateHostname = /(?:^|\.)(?:localhost|local|localdomain|internal|lan|corp|home|test|invalid|example|onion|arpa)$/i;
const hostnamePattern = /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i;

export function normalizePublicLink(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password) return undefined;
    url.hostname = url.hostname.replace(/\.$/, '');
    if (isIP(url.hostname) || !hostnamePattern.test(url.hostname) || privateHostname.test(url.hostname)) return undefined;
    url.hash = '';
    return url;
  } catch {
    return undefined;
  }
}

export function verifiedSnapshotLink(value, source) {
  const archive = normalizePublicLink(value);
  if (!archive || archive.hostname !== 'web.archive.org' || archive.search) return undefined;

  const target = archive.pathname.match(/^\/web\/\d{14}\/(https?:\/\/.+)$/i)?.[1];
  const captured = normalizePublicLink(target);
  if (!captured || captured.host !== source.host || captured.pathname !== source.pathname || captured.search !== source.search) {
    return undefined;
  }

  archive.protocol = 'https:';
  return archive.href;
}

export function readSourceLinkSnapshot(filename = sourceLinkSnapshotPath) {
  try {
    const snapshot = JSON.parse(readFileSync(filename, 'utf8'));
    if (snapshot?.version === 1 && snapshot.sources && typeof snapshot.sources === 'object' && !Array.isArray(snapshot.sources)) {
      return snapshot.sources;
    }
  } catch {
    // The first build and builds without a restored snapshot show ordinary source links.
  }
  return {};
}

export function readSourceLinkStatus(value) {
  const source = normalizePublicLink(value);
  if (!source) return undefined;
  const state = readSourceLinkSnapshot()[source.href];
  if (state?.status !== 'unavailable' || ![404, 410].includes(state.httpStatus)) return undefined;
  return { archiveUrl: verifiedSnapshotLink(state.archiveUrl, source) };
}
