import type { APIRoute } from 'astro';

const revision = [process.env.VERCEL_GIT_COMMIT_SHA, process.env.COMMIT_REF, process.env.GITHUB_SHA]
  .find((value) => value && /^[a-f0-9]{40}$/.test(value));

export const GET: APIRoute = () => Response.json({
  revision: revision ?? null,
  readerOrigin: import.meta.env.PUBLIC_READER_API_ORIGIN || null,
});
