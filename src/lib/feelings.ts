export const feelings = [
  { id: 'inspired', label: 'Inspired' },
  { id: 'thoughtful', label: 'Thoughtful' },
  { id: 'challenged', label: 'Challenged' },
  { id: 'comforted', label: 'Comforted' },
  { id: 'surprised', label: 'Surprised' },
  { id: 'not-convinced', label: 'Not convinced' },
] as const;

export type Feeling = typeof feelings[number]['id'];
export type FeelingCounts = Partial<Record<Feeling, number>>;

export function feelingLabel(id: string) {
  return feelings.find((feeling) => feeling.id === id)?.label ?? id;
}

export function feelingCount(counts: FeelingCounts, id: Feeling) {
  const value = counts[id];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
