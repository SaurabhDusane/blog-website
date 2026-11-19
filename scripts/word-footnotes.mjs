import { parseFragment } from 'parse5';

const footnoteId = /^word-footnote-\d+$/;

function attribute(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value;
}

function setAttribute(node, name, value) {
  const current = node.attrs.find((item) => item.name === name);
  if (current) current.value = value;
  else node.attrs.push({ name, value });
}

function walk(node, callback) {
  callback(node);
  for (const child of node.childNodes ?? []) walk(child, callback);
}

function replaceChildren(node, children) {
  node.childNodes = children;
  for (const child of children) child.parentNode = node;
}

function removeMammothBacklink(node, referenceId) {
  if (!node.childNodes) return;
  const children = node.childNodes.filter((child) => (
    child.tagName !== 'a'
    || attribute(child, 'href') !== '#' + referenceId
    || child.childNodes.length !== 1
    || child.childNodes[0].value !== '↑'
  ));
  for (const child of children) removeMammothBacklink(child, referenceId);
  replaceChildren(node, children);
}

function makeAside(note, id, referenceId, number) {
  const [aside] = parseFragment(
    '<aside class="margin-note" data-margin-note data-word-footnote>' +
    '<p class="margin-note__kicker">In the margin</p>' +
    '<p class="margin-note__title">Footnote</p>' +
    '<div class="margin-note__body"></div>' +
    '<a class="margin-note__link">Back to the text</a></aside>',
  ).childNodes;
  const [, title, body, back] = aside.childNodes;
  const label = id + '-label';
  setAttribute(aside, 'id', id);
  setAttribute(aside, 'aria-labelledby', label);
  setAttribute(title, 'id', label);
  title.childNodes[0].value = 'Footnote ' + number;
  setAttribute(back, 'href', '#' + referenceId);
  removeMammothBacklink(note, referenceId);
  const contents = note.childNodes.filter((node) => (
    node.tagName !== 'p'
    || node.childNodes.some((child) => child.nodeName !== '#text' || child.value.trim())
  ));
  replaceChildren(body, contents);
  return aside;
}

export function placeFootnotes(fragment) {
  const candidates = new Map();
  for (const list of fragment.childNodes.filter(({ tagName }) => tagName === 'ol')) {
    for (const node of list.childNodes) {
      const id = attribute(node, 'id');
      if (node.tagName === 'li' && id && footnoteId.test(id)) candidates.set(id, node);
    }
  }
  if (!candidates.size) return 0;

  const placed = new Set();
  const insertAfter = new Map();
  const refCounts = new Map();
  for (const block of fragment.childNodes) {
    walk(block, (node) => {
      if (node.tagName !== 'a') return;
      const href = attribute(node, 'href');
      const id = href?.startsWith('#') ? href.slice(1) : undefined;
      const refId = attribute(node, 'id');
      if (!id || !refId || !candidates.has(id) || refId !== id.replace('-footnote-', '-footnote-ref-')) return;
      const number = node.childNodes[0]?.value?.match(/\d+/)?.[0] ?? id.split('-').at(-1);
      const referenceCount = (refCounts.get(refId) ?? 0) + 1;
      refCounts.set(refId, referenceCount);
      if (referenceCount > 1) setAttribute(node, 'id', refId + '-' + referenceCount);
      setAttribute(node, 'aria-label', 'Read footnote ' + number);
      setAttribute(node, 'data-margin-note-ref', '');
      if (placed.has(id)) return;
      placed.add(id);
      const notes = insertAfter.get(block) ?? [];
      notes.push(makeAside(candidates.get(id), id, refId, number));
      insertAfter.set(block, notes);
    });
  }
  if (!placed.size) return 0;

  const children = [];
  for (const block of fragment.childNodes) {
    if (block.tagName === 'ol') {
      const remaining = block.childNodes.filter((node) => !placed.has(attribute(node, 'id')));
      if (remaining.length !== block.childNodes.length) {
        if (!remaining.some((node) => node.tagName === 'li')) continue;
        replaceChildren(block, remaining);
      }
    }
    children.push(block, ...(insertAfter.get(block) ?? []));
  }
  replaceChildren(fragment, children);
  return placed.size;
}
