import { lstat, mkdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment, serialize } from 'parse5';
import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';
import { placeFootnotes } from './word-footnotes.mjs';
import { createWordImportCache } from './word-import-cache.mjs';
import { convertDocx } from './convert-docx.mjs';
import { convertPdf } from './import-pdf.mjs';
import { essayTopics, sortEssay } from './essay-classifier.mjs';
import {
  committedDate, documentSources, editDate, metadataField, metadataFields, readPdfMetadata, readSource,
  repeatedMetadataFields, validDate,
} from './document-input.mjs';
import { createSnapshotStore, digest, findRenames, git, list, pruneOutput, readPublicationState, syncOutput, writeIfChanged } from './document-state.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const posts = join(root, 'src/content/posts');
const topics = join(root, 'src/content/topics');
const stateDirectory = join(root, '.data');
const imagesDirectory = join(root, 'public/word-images');
const pdfDirectory = join(root, 'public/document-pdfs');
const generated = '_word';
const imageUrl = '/word-images/';
const pdfUrl = '/document-pdfs/';
const preview = process.env.SECOND_INK_INCLUDE_DRAFTS === '1';
const stateManaged = process.env.SECOND_INK_STATE_MANAGED === '1';
const moods = new Set(['reflective', 'practical', 'curious']);
const fieldLine = /^([a-z][a-z0-9 -]{0,40})\s*:\s*(.*)$/i;
const postId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const permanentFileProblem = /password-protected|damaged or is not a \.docx|does not contain a readable PDF|PDF has no readable text/i;
const buildTime = Date.now();
const heading = /^h[1-6]$/;
const proseTags = new Set(['p', 'li', 'td', 'th', 'blockquote']);
const blockTags = new Set([...proseTags, 'ol', 'ul', 'tr']);
const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });
const legacyPosts = new Map([
  ['posts/essays/2026-11-17_what-an-unfinished-page-gives-me.docx', {
    slug: 'what-an-unfinished-page-gives-me', publishedAt: '2026-11-17',
  }],
  ['posts/essays/2026-11-18_a-little-less-hurry.docx', {
    slug: 'a-little-less-hurry', publishedAt: '2026-11-18T07:00:00.000Z',
  }],
]);

const allowedHtml = {
  allowedTags: [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'strong', 'em', 'b', 'i', 's', 'u',
    'sub', 'sup', 'br', 'hr', 'ol', 'ul', 'li', 'blockquote', 'pre', 'code', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['id', 'href'],
    li: ['id'],
    ol: ['start'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedClasses: { h1: ['word-title'], p: ['word-caption'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
};

function slugify(text) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function publicationTime(value) {
  if (!value) return undefined;
  if (validDate(value)) return new Date(value + 'T00:00:00-07:00');
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !validDate(value.slice(0, 10))) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function shorten(text, limit) {
  if (text.length <= limit) return text;
  const trimmed = text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '');
  return (trimmed.replace(/\s+\S*$/, '').trimEnd() || trimmed) + '…';
}

function excerpt(text) {
  if (text.length <= 240) return text;
  let result = '';
  for (const { segment } of sentences.segment(text)) {
    if (result.length + segment.trimEnd().length > 240) break;
    result += segment;
  }
  return result.trim() || shorten(text, 240);
}

function textOf(node) {
  if (node.nodeName === '#text') return node.value;
  if (node.tagName === 'br') return ' ';
  const text = (node.childNodes ?? []).map(textOf).join('');
  return blockTags.has(node.tagName) ? ' ' + text + ' ' : text;
}

function cleanText(node) {
  return textOf(node).replace(/\s+/gu, ' ').trim();
}

function includesImage(node) {
  return node.tagName === 'img' || (node.childNodes ?? []).some(includesImage);
}

function wordHeader(fragment) {
  const metadata = {};
  const nodes = fragment.childNodes;
  let styledTitle;
  let end = 0;
  const headers = [];
  let headerFields = 0;
  while (nodes.length > 0) {
    const node = nodes[0];
    const text = cleanText(node);
    const titleNode = node.tagName === 'h1' && node.attrs.some(({ name, value }) => (
      name === 'class' && value === 'word-title'
    ));
    if (titleNode) {
      styledTitle ??= text;
      nodes.shift();
      continue;
    }
    if ((node.nodeName === '#text' || node.tagName === 'p') && !text && !includesImage(node)) {
      nodes.shift();
      continue;
    }
    break;
  }
  const leadingHeading = nodes[0]?.tagName === 'h1' ? nodes[0] : undefined;
  if (leadingHeading) end += 1;
  for (const node of nodes.slice(end)) {
    const text = cleanText(node);
    if ((node.nodeName === '#text' || node.tagName === 'p') && !text && !includesImage(node)) {
      end += 1;
      continue;
    }
    const match = node.tagName === 'p' ? text.match(fieldLine) : null;
    if (!match) break;
    end += 1;
    const [, key, value] = match;
    const field = metadataField(key);
    if (!metadataFields.has(field)) continue;
    headerFields += 1;
    headers.push([field, value]);
  }
  if (headerFields) {
    nodes.splice(0, end);
    if (leadingHeading) styledTitle ??= cleanText(leadingHeading);
    for (const [field, value] of headers) {
      if (value && (field === 'status' || field === 'publish-date') && metadata[field]) {
        throw new Error('Use only one ' + field + ' header.');
      }
      if (value && repeatedMetadataFields.has(field)) (metadata[field] ??= []).push(value);
      else if (value) metadata[field] = value;
    }
  }
  return { metadata, styledTitle };
}

function outlineBody(fragment) {
  const headings = [];
  const passages = [];
  const headingIds = new Set();

  function collect(node, insidePassage = false) {
    const tag = node.tagName;
    if (tag === 'aside' && node.attrs.some(({ name }) => name === 'data-word-footnote')) {
      const body = node.childNodes.find((child) => child.tagName === 'div');
      const text = body && cleanText(body);
      if (text) passages.push(text);
      return;
    }
    const includeText = !insidePassage && (heading.test(tag ?? '') || proseTags.has(tag));
    const text = includeText ? cleanText(node) : '';
    if (text) passages.push(text);
    if (heading.test(tag ?? '')) {
      const depth = Math.min(6, Number(tag.slice(1)) + 1);
      const headingText = cleanText(node);
      const base = 'section-' + (slugify(headingText) || 'untitled');
      let slug = base;
      for (let suffix = 2; headingIds.has(slug); suffix += 1) slug = base + '-' + suffix;
      headingIds.add(slug);
      node.tagName = node.nodeName = 'h' + depth;
      node.attrs = [{ name: 'id', value: slug }];
      if (headingText) headings.push({ depth, slug, text: headingText });
    }
    for (const child of node.childNodes ?? []) collect(child, insidePassage || includeText);
  }

  collect(fragment);
  return { headings, passages };
}

async function authoredIds(directory, base = directory) {
  const entries = new Set();
  for (const item of await list(directory)) {
    if (item.name === generated) continue;
    const path = join(directory, item.name);
    if (item.isDirectory()) {
      for (const slug of await authoredIds(path, base)) entries.add(slug);
    } else if (item.isFile() && /\.mdx?$/i.test(item.name)) {
      const source = await readFile(path, 'utf8');
      const frontmatter = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      const declared = frontmatter?.match(/^slug:\s*["']?([a-z0-9][a-z0-9/-]*)["']?\s*$/mi)?.[1];
      const pathSlug = relative(base, path).replace(/\.mdx?$/i, '').split(sep).map(slugify).join('/');
      entries.add(declared ?? pathSlug);
    }
  }
  return entries;
}

function sourceUrl(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function markdown(data, html = '') {
  const lines = Object.entries(data).filter(([, value]) => value !== undefined)
    .map(([property, value]) => property + ': ' + JSON.stringify(value));
  return ['---', ...lines, '---', '', html, ''].join('\n');
}

function descendants(rootNode, tag) {
  const matches = [];
  for (const child of rootNode.childNodes ?? []) {
    if (child.tagName === tag) matches.push(child);
    matches.push(...descendants(child, tag));
  }
  return matches;
}

function textFirstLine(node) {
  if (node.nodeName === '#text') return node.value.replace(/\r?\n/g, '\n');
  if (node.tagName === 'br') return '\n';
  return (node.childNodes ?? []).map(textFirstLine).join('');
}

function takeCover(fragment, files) {
  let cover;
  for (const image of descendants(fragment, 'img')) {
    const values = Object.fromEntries(image.attrs.map(({ name, value }) => [name, value]));
    if (!values.src?.startsWith(imageUrl) || !files.has(values.src.slice(imageUrl.length))) {
      image.parentNode.childNodes.splice(image.parentNode.childNodes.indexOf(image), 1);
      continue;
    }
    const enclosing = image.parentNode;
    const siblings = enclosing.parentNode?.childNodes ?? [];
    const caption = siblings[siblings.indexOf(enclosing) + 1];
    const captionText = caption?.attrs?.some(({ name, value }) => name === 'class' && value === 'word-caption')
      ? cleanText(caption) : '';
    const alt = values.alt?.trim() || captionText;
    const altAttribute = image.attrs.find(({ name }) => name === 'alt');
    if (altAttribute) altAttribute.value = alt;
    if (!cover) {
      cover = { src: values.src, alt, width: Number(values.width), height: Number(values.height) };
      enclosing.childNodes.splice(enclosing.childNodes.indexOf(image), 1);
    }
  }
  fragment.childNodes = fragment.childNodes.filter((node) => node.tagName !== 'p' || cleanText(node) || includesImage(node));
  return cover;
}

function visibilityOf(source, metadata) {
  if (source.draft || metadata.status?.toLowerCase() === 'draft') return 'draft';
  const status = metadata.status?.toLowerCase() ?? 'published';
  if (status !== 'published') throw new Error('Status must be draft or published.');
  const when = publicationTime(metadata['publish-date']);
  if (metadata['publish-date'] && !when) throw new Error('Publish-date needs YYYY-MM-DD or an ISO time with an offset.');
  return when && when.getTime() > buildTime ? 'scheduled' : 'published';
}

function prepareDocument(source, converted, sidecar) {
  const datedName = source.stem.match(/^(\d{4}-\d{2}-\d{2})[_ -](.+)$/);
  const filenameTitle = datedName?.[2] ?? source.stem;
  const filenameWords = filenameTitle.replace(/[_-]+/g, ' ').trim();
  const fallbackTitle = filenameWords.replace(/^\p{L}/u, (character) => character.toLocaleUpperCase('en'));
  const fragment = parseFragment(sanitizeHtml(converted.html, allowedHtml));
  const { metadata, styledTitle } = source.format === 'docx'
    ? wordHeader(fragment) : { metadata: sidecar };
  const firstHeading = descendants(fragment, 'h1').find((node) => cleanText(node));
  const firstParagraph = fragment.childNodes.find((node) => node.tagName === 'p' && cleanText(node));
  const firstLine = converted.firstLine || (firstParagraph && textFirstLine(firstParagraph).split('\n').find((line) => line.trim())?.trim());
  const rawTitle = metadata.title || styledTitle || (firstHeading && cleanText(firstHeading)) || firstLine || fallbackTitle || 'Untitled reflection';
  if (firstHeading && cleanText(firstHeading).localeCompare(rawTitle, 'en', { sensitivity: 'base' }) === 0) {
    const siblings = firstHeading.parentNode.childNodes;
    siblings.splice(siblings.indexOf(firstHeading), 1);
  } else if (!metadata.title && !styledTitle && !firstHeading && firstParagraph && cleanText(firstParagraph) === rawTitle
    && rawTitle.length < 140 && !includesImage(firstParagraph)
    && !/[.!?…。！？]$/u.test(rawTitle)
    && fragment.childNodes.some((node) => node !== firstParagraph && cleanText(node))) {
    fragment.childNodes.splice(fragment.childNodes.indexOf(firstParagraph), 1);
  }
  return { fragment, metadata, rawTitle, filenameDate: validDate(datedName?.[1]) };
}

function editorialEntries(metadata, warnings, sourceIds) {
  const connections = (metadata.connection ?? []).slice(0, 8).flatMap((value) => {
    const match = value.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\s*\|\s*(\S.*)$/);
    if (match) return [{ post: match[1], reason: shorten(match[2], 600) }];
    warnings.push('Connection needs a post slug, a pipe, and a reason. This connection was skipped.');
    return [];
  });
  const thoughtsNow = (metadata['what-i-think-now'] ?? []).slice(0, 12).flatMap((value) => {
    const [date, note, link, label] = value.split('|').map((part) => part.trim());
    if (!validDate(date) || !note) {
      warnings.push('What I think now needs a date, a pipe, and a note. This entry was skipped.');
      return [];
    }
    const href = link && (/^\/(?!\/)[^\s\\]*$/.test(link) ? link : sourceUrl(link));
    if (link && !href) warnings.push('A What I think now link was skipped because its address was invalid.');
    return [{ date, note: shorten(note, 600), href: href || undefined, linkLabel: href && label ? shorten(label, 180) : undefined }];
  });
  const citedIds = new Set();
  const sources = (metadata['source-note'] ?? []).flatMap((value) => {
    const match = value.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\s*\|\s*(supports|complicates|background)\s*\|\s*(\S.*)$/i);
    if (!match) {
      warnings.push('Source note needs a source ID, a role (supports, complicates, or background), and a note, separated by pipes. This source note was skipped.');
      return [];
    }
    const [, sourceId, role, note] = match;
    const source = sourceId.toLowerCase();
    if (!sourceIds.has(source)) {
      warnings.push(`Source note refers to ${source}, which is missing from src/content/sources/. This source note was skipped.`);
      return [];
    }
    if (citedIds.has(source)) {
      warnings.push(`Add one source note for ${source} per essay. This duplicate was skipped.`);
      return [];
    }
    citedIds.add(source);
    return [{ source, role: role.toLowerCase(), note: shorten(note, 600) }];
  });
  return {
    connections: connections.length ? connections : undefined,
    thoughtsNow: thoughtsNow.length ? thoughtsNow : undefined,
    sources: sources.length ? sources : undefined,
  };
}

function renderDocument(source, prepared, converted, authorIds, paths, sourceIds) {
  const { fragment, metadata, rawTitle } = prepared;
  const files = new Map(converted.images);
  const cover = takeCover(fragment, files) ?? converted.cover;
  const footnoteCount = source.format === 'docx' ? placeFootnotes(fragment) : 0;
  const { headings, passages } = outlineBody(fragment);
  const html = serialize(fragment);
  if (!passages.length && !cover && !html.includes('<img ')) throw new Error('The document has no readable content.');
  const tags = new Map();
  for (const name of (metadata.tags ?? '').split(',').map((value) => value.trim()).filter(Boolean)) {
    tags.set(slugify(name).slice(0, 80).replace(/-$/, '') || 'tag-' + digest(name).slice(0, 10), shorten(name, 64));
  }
  const title = shorten(rawTitle, 180);
  const originalSource = sourceUrl(metadata['source-url'] ?? metadata.source);
  const archive = sourceUrl(metadata['archive-url']);
  const mood = metadata.mood?.toLowerCase();
  const selectedAuthor = slugify(metadata.author ?? '');
  const author = authorIds.has(selectedAuthor) ? selectedAuthor : [...authorIds].sort()[0];
  const count = passages.reduce((total, text) => (
    total + [...segmenter.segment(text)].filter(({ isWordLike }) => isWordLike).length
  ), 0);
  const firstParagraph = fragment.childNodes.find((node) => node.tagName === 'p' && cleanText(node));
  const description = excerpt(metadata.summary || (firstParagraph && cleanText(firstParagraph)) || passages[0] || title);
  const sorting = !tags.size || !moods.has(mood) ? sortEssay({ title, description, body: passages.join('\n') }) : undefined;
  if (!tags.size) {
    for (const id of sorting?.topics ?? []) tags.set(id, essayTopics[id]);
  }
  const warnings = [...converted.warnings];
  if (rawTitle.length > 180) warnings.push('The title was shortened to fit the reading desk.');
  if (!slugify(title)) warnings.push('The title uses characters that need a short generated URL.');
  if (metadata.date && !validDate(metadata.date)) warnings.push('The date header was invalid.');
  if ((metadata['source-url'] || metadata.source) && !originalSource) warnings.push('Source-url must be an absolute HTTP(S) URL.');
  if (metadata['archive-url'] && !archive) warnings.push('Archive-url must be an absolute HTTP(S) URL.');
  if (metadata.author && !authorIds.has(selectedAuthor)) warnings.push('The author did not match a profile, so the default author was used.');
  if (mood && !moods.has(mood)) warnings.push('Mood must be reflective, practical, or curious.');
  const readingPaths = [...new Set((metadata['reading-paths'] ?? metadata.series ?? '').split(',').map((value) => slugify(value)).filter(Boolean))]
    .filter((id) => {
      if (paths.has(id)) return true;
      warnings.push('A reading path was skipped because its ID did not match a path.');
      return false;
    });
  const updates = [metadata.update ?? []].flat().flatMap((value) => {
    const update = value.match(/^(\d{4}-\d{2}-\d{2})\s*\|\s*(\S.*)$/);
    if (!update || !validDate(update[1])) {
      warnings.push('Update needs YYYY-MM-DD | your note. This update was skipped.');
      return [];
    }
    return [{ date: update[1], note: shorten(update[2], 600) }];
  }).sort((first, second) => second.date.localeCompare(first.date));
  const looseThread = source.looseThread || metadata.kind?.toLowerCase() === 'thread';
  const followUp = metadata['follow-up'];
  if (looseThread && followUp && !postId.test(followUp)) warnings.push('Follow-up needs the slug of a published essay.');

  return {
    files, tags: [...tags], warnings, html,
    data: {
      title,
      description,
      author,
      topics: [...tags.keys()],
      readingPaths,
      mood: moods.has(mood) ? mood : sorting?.mood ?? 'reflective',
      minutes: Math.max(1, Math.ceil(count / 220)),
      sourceTitle: metadata['source-title'] ? shorten(metadata['source-title'], 180) : undefined,
      sourceAuthor: metadata['source-author'] ? shorten(metadata['source-author'], 120) : undefined,
      sourceUrl: originalSource,
      whyIPickedThis: metadata['why-i-picked-this'] ? shorten(metadata['why-i-picked-this'], 300) : undefined,
      archiveUrl: archive,
      claim: metadata.claim ? shorten(metadata.claim, 300) : undefined,
      claimQuestion: metadata['claim-question'] ? shorten(metadata['claim-question'], 240) : undefined,
      reflectionQuestion: metadata.question ? shorten(metadata.question, 240) : undefined,
      fieldNotePrompt: metadata['field-note-prompt'] ? shorten(metadata['field-note-prompt'], 240) : undefined,
      updates,
      looseThread: looseThread || undefined,
      threadFollowUp: looseThread && followUp && postId.test(followUp) ? followUp : undefined,
      ...editorialEntries(metadata, warnings, sourceIds),
      documentSource: { filename: source.filename, format: source.format, headings, passages, hasNotes: footnoteCount > 0, cover },
    },
  };
}

const [sources, reservedPosts, reservedTopics, authors, paths, sourceIds, state, store, cache] = await Promise.all([
  documentSources(root), authoredIds(posts), authoredIds(topics), authoredIds(join(root, 'src/content/authors')),
  authoredIds(join(root, 'src/content/series')), authoredIds(join(root, 'src/content/sources')),
  readPublicationState(stateDirectory), createSnapshotStore(stateDirectory),
  createWordImportCache(join(root, '.data', 'word-import-cache'), {
    node: process.versions.node,
    icu: process.versions.icu,
    platform: process.platform,
    arch: process.arch,
    sharp: sharp.versions,
  }, ['./import-word.mjs', './essay-classifier.mjs', './essay-classifier-training.mjs', './convert-docx.mjs', './import-pdf.mjs', './pdf-worker.mjs', './document-input.mjs', './word-footnotes.mjs', './word-import-cache.mjs', '../package-lock.json']
    .map((file) => new URL(file, import.meta.url))),
]);
if (!authors.size) throw new Error('Add an author profile before importing documents.');

const revision = git(root, ['rev-parse', 'HEAD']).trim() || null;
const renamed = findRenames(root, state.revision, revision);
const currentPaths = new Set(sources.map(({ path }) => path));
const renamedFrom = new Set([...renamed].filter(([path]) => currentPaths.has(path)).map(([, oldPath]) => oldPath));
const previous = new Map(state.posts.map((post) => [post.path, post]));
const active = new Set();
const next = new Map();
const generatedPosts = new Map();
const generatedTopics = new Map();
const generatedImages = new Set();
const generatedPdfs = new Set();
const reserved = new Set([
  ...reservedPosts,
  ...state.posts.flatMap(({ slug, aliases }) => [slug, ...aliases]),
  ...[...legacyPosts.values()].map(({ slug }) => slug),
]);
const conversions = { reused: 0, converted: 0 };
const records = [];

for (const directory of [imagesDirectory, pdfDirectory]) {
  await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory()) throw new Error('Expected a regular generated media directory.');
}

function note(source, status, reason, details = {}) {
  const clean = (value) => String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500);
  records.push({
    path: clean(source.path), status, reason: clean(reason), ...details,
    warnings: (details.warnings ?? []).map(clean).filter(Boolean).slice(0, 12),
  });
}

function identify(source, hash) {
  const direct = previous.get(source.path);
  const oldPath = renamed.get(source.path);
  const moved = oldPath && !currentPaths.has(oldPath) && previous.get(oldPath);
  if (direct || (moved && !active.has(moved.slug))) return direct || moved;
  if (!hash) return undefined;
  // A committed move takes priority over a separate upload with matching bytes.
  const exact = state.posts.filter(({ path, slug, sourceHash }) => (
    !currentPaths.has(path) && !renamedFrom.has(path) && !active.has(slug) && sourceHash === hash
  ));
  return exact.length === 1 ? exact[0] : undefined;
}

function postSlug(title, hash) {
  const base = slugify(title).slice(0, 92).replace(/-+$/, '') || 'note-' + hash.slice(0, 10);
  let slug = base;
  for (let index = 2; reserved.has(slug); index += 1) slug = base + '-' + index;
  reserved.add(slug);
  return { slug, duplicate: base !== slug };
}

async function addPost(post) {
  const { data, tags, html, files } = post;
  if (reservedPosts.has(data.slug) || generatedPosts.has(data.slug + '.md')) throw new Error('This URL is already used by another post.');
  for (const [name, bytes] of files) {
    if (/^[a-f0-9]{64}\.pdf$/.test(name)) {
      await writeIfChanged(join(pdfDirectory, name), bytes);
      generatedPdfs.add(name);
    } else if (/^[a-f0-9]{24}\.webp$/.test(name)) {
      await writeIfChanged(join(imagesDirectory, name), bytes);
      generatedImages.add(name);
    }
  }
  generatedPosts.set(data.slug + '.md', markdown(data, html));
  for (const [slug, tag] of tags) {
    const name = slug + '.md';
    if (!reservedTopics.has(slug) && !generatedTopics.has(name)) {
      generatedTopics.set(name, markdown({ slug, name: tag, description: 'Reflections tagged ' + tag + '.' }));
    }
  }
}

function remember(path, existing, patch = {}) {
  if (!existing) return;
  active.add(existing.slug);
  next.set(existing.slug, { ...existing, path, ...patch });
}

for (const source of sources) {
  let existing = identify(source);
  let visibility = source.draft ? 'draft' : 'published';
  try {
    const sidecar = source.format === 'pdf' ? await readPdfMetadata(root, source.sidecars) : {};
    visibility = visibilityOf(source, sidecar);
    if (visibility !== 'published' && !preview) {
      const { sourceHash } = await readSource(root, source);
      existing ??= identify(source, sourceHash);
      remember(source.path, existing, { sourceHash, snapshot: undefined });
      note(source, visibility, visibility === 'draft' ? 'Reserved for private previews.' : 'Waiting for its scheduled publication.');
      continue;
    }
    const { bytes, sourceHash, info } = await readSource(root, source);
    existing ??= identify(source, sourceHash);
    const key = cache.keyFor(Buffer.from(source.format + ':' + sourceHash));
    let cached = await cache.read(key);
    if (cached?.problem) {
      if (!preview) await cache.keep(key);
      throw new Error(cached.problem);
    }
    if (cached?.withholding) {
      const { status, until } = cached.withholding;
      if (!preview && (status === 'draft' || publicationTime(until)?.getTime() > buildTime)) {
        visibility = status;
        remember(source.path, existing, { sourceHash, snapshot: undefined });
        await cache.keep(key);
        note(source, status, status === 'draft' ? 'Reserved for private previews.' : 'Waiting for its scheduled publication.');
        continue;
      }
      cached = undefined;
    }
    let converted = cached;
    if (!converted) {
      try {
        converted = await (source.format === 'pdf' ? convertPdf(bytes) : convertDocx(bytes));
      } catch (error) {
        if (!preview && permanentFileProblem.test(error.message)) await cache.keep(key, { problem: error.message });
        throw error;
      }
    }
    conversions[cached ? 'reused' : 'converted'] += 1;
    const prepared = prepareDocument(source, converted, sidecar);
    visibility = visibilityOf(source, prepared.metadata);
    if (visibility !== 'published' && !preview) {
      remember(source.path, existing, { sourceHash, snapshot: undefined });
      // Retain the classification only. Draft text, original files and images stay out of this cache.
      await cache.keep(key, { withholding: { status: visibility, until: prepared.metadata['publish-date'] } });
      note(source, visibility, visibility === 'draft' ? 'Reserved for private previews.' : 'Waiting for its scheduled publication.');
      continue;
    }
    const post = renderDocument(source, prepared, converted, authors, paths, sourceIds);
    const legacy = legacyPosts.get(source.path);
    const hidden = visibility !== 'published';
    const allocation = existing || legacy || postSlug((hidden ? 'Draft ' : '') + post.data.title, sourceHash);
    const slug = allocation.slug;
    if (allocation.duplicate) post.warnings.push('This title shares a URL name with another post, so a suffix was added.');
    const fingerprint = digest(sourceHash + '\n' + JSON.stringify(sidecar));
    const publishedAt = existing?.publishedAt ?? legacy?.publishedAt ?? prepared.filenameDate
      ?? validDate(prepared.metadata.date) ?? committedDate(root, source.path) ?? info.mtime.toISOString().slice(0, 10);
    const updated = Boolean(existing && existing.fingerprint !== fingerprint);
    const updatedAt = updated ? (editDate(root, source) ?? info.mtime.toISOString().slice(0, 10)) : existing?.updatedAt;
    const aliases = existing?.aliases ?? [];
    const documentSource = post.data.documentSource;
    documentSource.draft = hidden || undefined;
    if (source.format === 'pdf') {
      const name = sourceHash + '.pdf';
      post.files.set(name, bytes);
      documentSource.originalUrl = pdfUrl + name;
      documentSource.complex = converted.complex || undefined;
    }
    Object.assign(post.data, { slug, publishedAt, updatedAt, redirectFrom: aliases.length ? aliases : undefined });
    if (reservedPosts.has(slug) || generatedPosts.has(slug + '.md')) throw new Error('This URL is already used by another post.');
    const snapshot = !hidden && !preview ? await store.stage(post) : undefined;
    await addPost(post);
    if (snapshot) {
      remember(source.path, { slug, aliases, publishedAt, updatedAt, sourceHash, fingerprint, snapshot });
      await cache.keep(key, cached ? undefined : converted);
    }
    if (existing) active.add(existing.slug);
    const status = hidden ? visibility : updated ? 'updated' : 'published';
    const reason = hidden ? 'Available for private review.' : updated ? 'The new version kept its original URL.'
      : existing && existing.path !== source.path ? 'The renamed file kept its original URL.'
        : existing ? 'The published version is current.' : 'Ready at /posts/' + slug + '/.';
    note(source, status, reason, { slug, conversion: cached ? 'cached' : 'converted', warnings: post.warnings });
  } catch (error) {
    let preserved = false;
    if (existing?.snapshot && visibility === 'published' && !reservedPosts.has(existing.slug)) {
      const original = await store.read(existing.snapshot);
      await addPost(original);
      remember(source.path, existing);
      preserved = true;
    } else {
      remember(source.path, existing, { snapshot: undefined });
    }
    const message = error.message || 'The file could not be converted.';
    note(source, 'problem', message + (preserved ? ' The last good version was kept.' : ' The file was skipped.'),
      { slug: existing?.slug, preserved });
  }
}

for (const post of state.posts) {
  if (active.has(post.slug) || next.has(post.slug)) continue;
  if (post.snapshot) note(post, 'removed', 'The source file was deleted.');
  next.set(post.slug, { ...post, snapshot: undefined });
}
await pruneOutput(imagesDirectory, generatedImages, /^[a-f0-9]{24}\.webp$/);
await pruneOutput(pdfDirectory, generatedPdfs, /^[a-f0-9]{64}\.pdf$/);
await syncOutput(join(topics, generated), generatedTopics, /^[a-z0-9-]+\.md$/);
await syncOutput(join(posts, generated), generatedPosts, /^[a-z0-9-]+\.md$/);

if (!preview) {
  await cache.prune();
  const release = { version: 1, revision, posts: [...next.values()].sort((a, b) => a.slug.localeCompare(b.slug)) };
  const serialized = JSON.stringify(release, null, 2) + '\n';
  await writeIfChanged(join(stateDirectory, 'document-release.json'), serialized);
  if (!stateManaged) await writeIfChanged(join(stateDirectory, 'document-state.json'), serialized);
}
const reportText = [
  'Document conversion report',
  ...records.flatMap(({ path, status, reason, warnings }) => [
    status.charAt(0).toUpperCase() + status.slice(1) + ' — ' + path + ' · ' + reason,
    ...warnings.map((warning) => '  Check: ' + warning),
  ]),
  '',
  'Conversions: ' + conversions.reused + ' reused, ' + conversions.converted + ' converted.',
  '',
].join('\n');
await writeIfChanged(join(stateDirectory, 'document-import-report.txt'), reportText);
await writeIfChanged(join(stateDirectory, 'document-import-report.json'), JSON.stringify({ records, conversions }, null, 2) + '\n');
console.log(reportText.trimEnd());
