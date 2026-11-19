import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
export const collections = { posts: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/posts' }), schema: z.object({ title: z.string(), description: z.string(), publishedAt: z.coerce.date(), updatedAt: z.coerce.date().optional(), minutes: z.number(), documentSource: z.object({ originalUrl: z.string().optional() }) }) }) };
