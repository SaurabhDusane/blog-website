import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  normalizePublicLink, readSourceLinkSnapshot, sourceLinkInventoryPath, sourceLinkSnapshotPath, verifiedSnapshotLink,
} from './source-link-status.mjs';
import { requestPublic } from './source-link-network.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const reportPath = '.data/source-link-report.txt';

async function findArchive(source, request) {
  // URLs with a query may contain sharing tokens, so avoid sending them to the archive service.
  if (source.search) return { skipped: true };
  const service = new URL('https://archive.org/wayback/available');
  service.searchParams.set('url', source.href);
  try {
    const response = await request(service.href, { redirects: 0, bodyLimit: 16384 });
    if (response.status !== 200) return { failed: true };
    const { archived_snapshots: snapshots } = JSON.parse(response.body);
    if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) return { failed: true };
    const closest = snapshots.closest;
    if (!closest || closest.available !== true || Number(closest.status) !== 200) return {};
    return { url: verifiedSnapshotLink(closest.url, source) };
  } catch {
    return { failed: true };
  }
}

function resultLabel(ids, text) {
  return `${ids.join(', ')} · ${text}`;
}

async function checkSource({ url, ids, needsArchive }, previous, now, request) {
  let response;
  try {
    response = await request(url.href);
  } catch (error) {
    const reason = error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN'
      ? 'DNS did not confirm availability'
      : ['ABORT_ERR', 'ETIMEDOUT'].includes(error.code)
        ? 'Request took too long'
        : String(error.message).replace(/\s+/g, ' ').slice(0, 200);
    return { state: previous, text: resultLabel(ids, `Check inconclusive (${reason}). Prior result kept.`) };
  }

  const httpStatus = response.status;
  if (httpStatus >= 200 && httpStatus < 300) {
    return {
      state: { status: 'reachable', httpStatus, checkedAt: now },
      text: resultLabel(ids, `Reachable (HTTP ${httpStatus}).`),
    };
  }

  if (![404, 410].includes(httpStatus)) {
    return { state: previous, text: resultLabel(ids, `Check inconclusive (HTTP ${httpStatus}). Prior result kept.`) };
  }

  const priorArchive = needsArchive ? verifiedSnapshotLink(previous?.archiveUrl, url) : undefined;
  const archive = needsArchive && !priorArchive ? await findArchive(url, request) : {};
  const archivedUrl = priorArchive ?? archive.url;
  const archiveMessage = archivedUrl ? 'A saved copy is available.'
    : archive.failed ? 'The archive lookup was inconclusive.'
      : archive.skipped ? 'Archive lookup skipped for a URL with a query string.'
        : needsArchive ? 'No verified copy found.' : 'Uses the supplied archive link.';
  return {
    state: { status: 'unavailable', httpStatus, checkedAt: now, archiveUrl: archivedUrl },
    text: resultLabel(ids, `Unavailable (HTTP ${httpStatus}). ${archiveMessage}`),
  };
}

function visibleIssues(states) {
  return JSON.stringify(Object.entries(states)
    .filter(([, state]) => state?.status === 'unavailable' && [404, 410].includes(state.httpStatus))
    .map(([source, state]) => [source, state.archiveUrl ?? ''])
    .sort(([first], [second]) => first.localeCompare(second)));
}

export async function checkSourceLinks(inventory, previous, request = requestPublic) {
  const sources = new Map();
  const report = [];

  for (const { id, url: value, hasArchive } of inventory) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const label = id.replace(/\s+/g, ' ');
    const url = normalizePublicLink(value);
    if (!url) {
      report.push(resultLabel([label], 'Skipped an unsupported or non-public source URL.'));
      continue;
    }

    const entry = sources.get(url.href) ?? { url, ids: [], needsArchive: false };
    entry.ids.push(label);
    entry.needsArchive ||= !hasArchive;
    sources.set(url.href, entry);
  }

  const checkedAt = new Date().toISOString();
  const snapshots = [];
  const entries = [...sources.values()];
  for (let index = 0; index < entries.length; index += 4) {
    const results = await Promise.all(entries.slice(index, index + 4).map(async (source) => {
      const result = await checkSource(source, previous[source.url.href], checkedAt, request);
      return { ...result, href: source.url.href };
    }));
    for (const { state, text, href } of results) {
      if (state) snapshots.push([href, state]);
      report.push(text);
    }
  }

  const states = Object.fromEntries(snapshots);
  return {
    snapshot: { version: 1, checkedAt, sources: states },
    report: [`Source link check · ${checkedAt}`, `${entries.length} distinct source links`, '', ...report, ''].join('\n'),
    changed: visibleIssues(states) !== visibleIssues(previous),
  };
}

async function main() {
  let inventory;
  try {
    inventory = JSON.parse(await readFile(join(root, sourceLinkInventoryPath), 'utf8'));
  } catch {
    throw new Error('Build the site before checking source links. The published source list is missing or unreadable.');
  }
  if (!Array.isArray(inventory) || inventory.some((entry) => !entry || typeof entry !== 'object')) {
    throw new Error('The published source list is invalid. The prior snapshot is unchanged.');
  }

  const filename = join(root, sourceLinkSnapshotPath);
  const previous = readSourceLinkSnapshot(filename);
  const { snapshot, report, changed } = await checkSourceLinks(inventory, previous);
  await mkdir(join(root, '.data'), { recursive: true });
  const temp = `${filename}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  await rename(temp, filename);
  await writeFile(join(root, reportPath), report, 'utf8');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `source_links_changed=${changed}\n`);
  console.log(report);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
