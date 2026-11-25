import { parseFragment, serialize } from 'parse5';
import { passageAnchor, passageTags } from '../src/lib/article-passages.ts';

/** @param {import('parse5').DefaultTreeAdapterTypes.ChildNode} node @returns {string} */
function passageText(node) {
  if ('value' in node) return node.value;
  if ('tagName' in node && (node.tagName === 'br' || node.tagName === 'hr')) return ' ';
  if (!('childNodes' in node)) return '';
  const separator = 'tagName' in node && ['ol', 'ul', 'li', 'table', 'tbody', 'thead', 'tfoot', 'tr'].includes(node.tagName) ? ' ' : '';
  return node.childNodes.map(passageText).join(separator);
}

/** @param {import('parse5').DefaultTreeAdapterTypes.DocumentFragment} fragment */
const passages = (fragment) => fragment.childNodes.filter(
  /** @returns {node is import('parse5').DefaultTreeAdapterTypes.Element} */
  (node) => 'tagName' in node && passageTags.includes(node.tagName),
);

/** @param {string} html */
export function renderedArchivePassages(html) {
  /** @type {string | undefined} */
  let heading;
  return passages(parseFragment(html)).flatMap((node, index) => {
    const text = passageText(node).replace(/\s+/g, ' ').trim();
    if (!text) return [];
    if (/^h[2-6]$/.test(node.tagName)) {
      heading = text;
      return [];
    }
    const anchor = node.attrs.find(({ name }) => name === 'id')?.value || passageAnchor(index);
    return [{ text, anchor, heading }];
  });
}

/** @param {string} html */
export function anchorArchivePassages(html) {
  const fragment = parseFragment(html);
  for (const [index, node] of passages(fragment).entries()) {
    const anchor = node.attrs.find(({ name }) => name === 'id');
    if (anchor) anchor.value ||= passageAnchor(index);
    else node.attrs.push({ name: 'id', value: passageAnchor(index) });
  }
  return serialize(fragment);
}
