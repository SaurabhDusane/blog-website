import type { APIRoute, GetStaticPaths } from 'astro';
import { getPosts } from '../../../lib/content';
import { postSocialImageKey, renderPostSocialImage } from '../../../lib/post-social-image';

export const getStaticPaths = (async () => {
  const posts = await getPosts();
  return posts.map(({ id, data: { title, mood } }) => ({
    params: { card: postSocialImageKey(id, title, mood) },
    props: { title, mood },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props: { title, mood } }) => {
  const image = await renderPostSocialImage(title, mood);
  return new Response(new Uint8Array(image), { headers: { 'Content-Type': 'image/jpeg' } });
};
