import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

export const questions = defineCollection({
  loader: glob({ base: './src/content/questions', pattern: '*.md' }),
  schema: z.object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(300),
    locale: z.string().default('en'),
    posts: z.array(z.object({
      post: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      addedAt: z.coerce.date(),
      note: z.string().trim().min(1).max(380).optional(),
    })).min(1),
  }),
});
