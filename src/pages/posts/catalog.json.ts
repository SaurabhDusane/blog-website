import type { APIRoute } from 'astro';
import { getPosts } from '../../lib/content';

export const GET: APIRoute = async () => Response.json(
  (await getPosts()).map(({ id, data: { title, fieldNotePrompt } }) => ({
    id,
    title,
    ...(fieldNotePrompt ? { fieldNotePrompt } : {}),
  })),
);
