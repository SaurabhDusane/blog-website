import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { sources, sourceAnnotations } from './lib/source-schema';
import { questions } from './lib/question-schema';
import { journalAuthorId, legacyAuthorId } from './lib/journal-author.mjs';

const locale = z.string().default('en');
const httpUrl = z.string().url().refine((url) => /^https?:\/\//i.test(url));
const readingLink = z.union([httpUrl, z.string().regex(/^\/(?!\/)[^\\\s]*$/)]);
const simpleId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const documentOutline = z.array(z.object({ depth: z.number().int().min(2).max(6), slug: simpleId, text: z.string() }));
const journalAuthor = z.enum([journalAuthorId, legacyAuthorId]).default(journalAuthorId)
  .transform(() => journalAuthorId).pipe(reference('authors'));

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    author: journalAuthor,
    topics: z.array(reference('topics')).default([]),
    readingPaths: z.array(simpleId).optional(),
    looseThread: z.boolean().optional(),
    threadFollowUp: simpleId.optional(),
    redirectFrom: z.array(simpleId).optional(),
    mood: z.enum(['reflective', 'practical', 'curious']),
    minutes: z.number().int().positive(),
    featured: z.boolean().default(false),
    image: image().optional(),
    imageAlt: z.string().trim().min(1).optional(),
    related: z.array(reference('posts')).optional(),
    connections: z.array(z.object({
      post: simpleId,
      reason: z.string().trim().min(1).max(600),
    })).optional(),
    thoughtsNow: z.array(z.object({
      date: z.coerce.date(),
      note: z.string().trim().min(1).max(600),
      href: readingLink.optional(),
      linkLabel: z.string().trim().min(1).max(180).optional(),
    })).optional(),
    sourceTitle: z.string().trim().min(1).max(180).optional(),
    sourceAuthor: z.string().trim().min(1).max(120).optional(),
    sourceUrl: httpUrl.optional(),
    whyIPickedThis: z.string().trim().min(1).max(300).optional(),
    archiveUrl: httpUrl.optional(),
    claim: z.string().trim().min(1).max(300).optional(),
    claimQuestion: z.string().trim().min(1).max(240).optional(),
    reflectionQuestion: z.string().trim().min(1).max(240).optional(),
    fieldNotePrompt: z.string().trim().min(1).max(240).optional(),
    sources: sourceAnnotations.optional(),
    updates: z.array(z.object({ date: z.coerce.date(), note: z.string().trim().min(1).max(600) })).default([]),
    documentSource: z.object({
      format: z.enum(['docx', 'pdf']),
      filename: z.string().min(1),
      headings: documentOutline,
      passages: z.array(z.string()),
      hasNotes: z.boolean().optional(),
      originalUrl: z.string().regex(/^\/document-pdfs\/[a-f0-9]{64}\.pdf$/).optional(),
      complex: z.boolean().optional(),
      cover: z.object({
        src: z.string().regex(/^\/word-images\/[a-f0-9]{24}\.webp$/),
        alt: z.string(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }).optional(),
      draft: z.boolean().optional(),
    }).optional(),
    wordSource: z.object({
      filename: z.string().regex(/^[^/\\]+\.docx$/i).optional(),
      hasNotes: z.boolean().optional(),
      headings: z.array(z.object({ depth: z.number().int().min(2).max(6), slug: z.string(), text: z.string() })),
      passages: z.array(z.string()),
    }).optional(),
    locale,
  }).refine((post) => !post.image || post.imageAlt, {
    message: 'Add imageAlt when you provide a cover image.',
    path: ['imageAlt'],
  }),
});

const topics = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/topics' }),
  schema: z.object({
    name: z.string(),
    description: z.string(),
  }),
});

const authors = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/authors' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    bio: z.string(),
    email: z.string().email().optional(),
    deskQuestions: z.array(z.object({
      post: simpleId,
      label: z.string().trim().min(1).max(55),
      question: z.string().trim().min(1).max(120),
    })).max(4).default([]),
  }),
});

const series = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/series' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    posts: z.array(reference('posts')).min(1),
    locale,
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    locale,
  }),
});

const editions = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/editions' }),
  schema: z.object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(450),
    publishedAt: z.coerce.date(),
    author: journalAuthor,
    posts: z.array(z.object({ post: simpleId, note: z.string().trim().min(1).max(600).optional() })).min(1),
    locale,
  }),
});

export const collections = { posts, topics, authors, series, pages, editions, sources, questions };
