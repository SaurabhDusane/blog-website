import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const { records } = JSON.parse(readFileSync('.data/document-import-report.json', 'utf8'));
const report = readFileSync('.data/document-import-report.txt', 'utf8');
const visible = records.filter((entry) => entry.preserved || ['published', 'updated'].includes(entry.status));
const pages = (existsSync('dist/posts') ? readdirSync('dist/posts', { withFileTypes: true }) : []).filter((file) => file.isDirectory()).map((file) => file.name);
assert.deepEqual(pages.sort(), visible.map(({ slug }) => slug).sort());
for (const { slug } of visible) {
  const html = readFileSync(join('dist/posts', slug, 'index.html'), 'utf8');
  const pdf = html.match(/href=\x22(\/document-pdfs\/[a-f0-9]{64}\.pdf)\x22/);
  if (pdf) assert.equal(readFileSync('dist' + pdf[1]).subarray(0, 5).toString(), '%PDF-');
}
console.log(report);
console.log('Verified ' + pages.length + ' rendered articles and their PDF originals.');
