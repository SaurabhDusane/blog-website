export const passageTags = ['p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'figure', 'pre', 'table'];

export function passageAnchor(index: number) {
  return 'passage-' + (index + 1);
}
