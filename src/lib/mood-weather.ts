import type { FeelingCounts } from './feelings';
import { readerApi } from './reader-api';

export interface MoodWeather {
  totals: FeelingCounts;
  byPost: Record<string, FeelingCounts>;
  featuredNote: null | { month: string; postId: string; excerpt: string; attribution: 'Anonymous reader' };
}

export async function readMoodWeather(): Promise<MoodWeather> {
  const response = await fetch(readerApi('moods'), { cache: 'no-store' });
  if (!response.ok) throw new Error('Reader feelings are unavailable.');
  const data = await response.json();
  if (data?.ok !== true || !data.totals || !data.byPost) throw new Error('Reader feelings are unavailable.');
  return data;
}
