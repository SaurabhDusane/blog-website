import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

const sourceUrl = z.string().url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, 'Use an HTTP or HTTPS link without credentials.');

export const sources = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/sources' }),
  schema: z.object({
    title: z.string().trim().min(1).max(180),
    author: z.string().trim().min(1).max(160).optional(),
    publication: z.string().trim().min(1).max(120).optional(),
    year: z.number().int().optional(),
    url: sourceUrl,
    archiveUrl: sourceUrl.optional(),
  }),
});

export const sourceAnnotations = z.array(z.object({
  source: reference('sources'),
  role: z.enum(['supports', 'complicates', 'background']),
  note: z.string().trim().min(1).max(600),
}));
