import { stances } from './stances';

export const reconsiderationChoices = [...stances, { id: 'still-thinking', label: 'Still thinking' }] as const;
export const reconsiderationMovements = [
  { id: 'kept', label: 'Kept their view' },
  { id: 'changed', label: 'Changed their answer' },
  { id: 'thinking', label: 'Still thinking' },
] as const;
