const proseBlocks = new Set(['paragraph', 'heading', 'tableCell']);

function inlineText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'break') return ' ';
  return node.children?.map(inlineText).join('') ?? '';
}

function collectPassages(node, passages) {
  if (proseBlocks.has(node.type)) {
    const text = inlineText(node).replace(/\s+/g, ' ').trim();
    if (text) passages.push(text);
    return;
  }

  for (const child of node.children ?? []) collectPassages(child, passages);
}

export function remarkSearchPassages() {
  return (tree, file) => {
    const frontmatter = file.data.astro?.frontmatter;
    if (!frontmatter) return;
    const passages = [];
    collectPassages(tree, passages);
    frontmatter.searchPassages = passages;
  };
}
