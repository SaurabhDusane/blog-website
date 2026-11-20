export const stances = [
  { id: 'agree', label: 'Agree' },
  { id: 'unsure', label: 'Not sure yet' },
  { id: 'disagree', label: 'Disagree' },
] as const;

export type Stance = typeof stances[number]['id'];
export type StanceCounts = Record<Stance, number>;
