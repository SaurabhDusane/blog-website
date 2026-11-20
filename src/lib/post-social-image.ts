import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { CollectionEntry } from 'astro:content';

type Mood = CollectionEntry<'posts'>['data']['mood'];

const width = 1200;
const height = 630;
const ink = '#1e2a3e';
const cobalt = '#254b9e';
const paper = '#f6f0e4';
const margin = 82;
const moods: Record<Mood, string> = {
  reflective: 'Reflective',
  practical: 'Practical',
  curious: 'Curious',
};

export function postSocialImageKey(slug: string, title: string, mood: Mood) {
  const revision = createHash('sha256').update(JSON.stringify([1, title, mood])).digest('hex').slice(0, 10);
  return `${slug}-${revision}`;
}

export function postSocialImageAlt(title: string, mood: Mood) {
  return `${title} · Second Ink · ${moods[mood]} essay`;
}

function renderText(value: string, font: string, color: string, maxWidth: number, maxHeight?: number) {
  const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return sharp({ text: {
    text: `<span foreground="${color}">${escaped}</span>`,
    font,
    width: maxWidth,
    height: maxHeight,
    wrap: 'word-char',
    rgba: true,
  }}).png().toBuffer({ resolveWithObject: true });
}

function strip(left: number, top: number, width: number, height: number, background: string): sharp.OverlayOptions {
  return { input: { create: { width, height, channels: 3, background } }, left, top };
}

export async function renderPostSocialImage(title: string, mood: Mood) {
  // Sharp's system serif fallback keeps text readable on build hosts without Georgia.
  const displayFont = 'Georgia, DejaVu Serif, serif 82';
  const cleanedTitle = title.replace(/[\p{Cc}\p{Cs}\s]+/gu, ' ').trim() || 'An essay from Second Ink';
  const characters = Array.from(cleanedTitle);
  const displayTitle = characters.length > 180 ? characters.slice(0, 179).join('').trimEnd() + '…' : cleanedTitle;
  const availableWidth = width - 2 * margin;
  const titleHeight = 292;
  const [fullHeadline, brand, tag] = await Promise.all([
    renderText(displayTitle, displayFont, ink, availableWidth),
    renderText('Second Ink', 'Georgia, DejaVu Serif, serif 38', ink, 480),
    renderText(moods[mood], 'sans-serif 26', cobalt, 460),
  ]);
  const headline = fullHeadline.info.height > titleHeight
    ? await renderText(displayTitle, displayFont, ink, availableWidth, titleHeight)
    : fullHeadline;
  const headlineTop = 167 + Math.floor((titleHeight - headline.info.height) / 2);

  return sharp({ create: { width, height, channels: 3, background: paper } })
    .composite([
      strip(0, 0, 13, height, cobalt),
      strip(margin, 121, availableWidth, 2, cobalt),
      strip(margin, 494, availableWidth, 1, '#b8b1a5'),
      strip(width - margin - 40, 61, 40, 3, cobalt),
      strip(width - margin - 28, 75, 28, 3, cobalt),
      { input: brand.data, left: margin, top: 58 },
      { input: headline.data, left: margin, top: headlineTop },
      { input: tag.data, left: margin, top: 531 },
    ])
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
}
