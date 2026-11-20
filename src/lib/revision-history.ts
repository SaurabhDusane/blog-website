import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

export function wordRevisionDates(filename: string | undefined, publishedAt: Date): Date[] {
  if (!filename || basename(filename) !== filename || !filename.toLowerCase().endsWith('.docx')) {
    return [];
  }

  try {
    const log = execFileSync('git', [
      'log', '--follow', '--format=%as', '-n', '24', '--', `posts/${filename}`,
    ], { encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const firstDate = publishedAt.toISOString().slice(0, 10);
    return [...new Set(log.trim().split(/\r?\n/))]
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date > firstDate)
      .sort().reverse()
      .map((date) => new Date(date));
  } catch {
    return [];
  }
}
