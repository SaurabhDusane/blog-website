import {
  libraryChangeEvent,
  libraryKey,
  readLibrary,
  readSavedQuotes,
  removeQuote,
  savedQuotesChangeEvent,
  savedQuotesKey,
  savePost,
  type SavedQuote,
} from '../lib/reader-state';
import { copyText } from '../lib/clipboard';
import { createQuoteImageDialog } from '../lib/quote-image';
import { findQuotePattern } from '../lib/quote-patterns';

function initSaved() {
  const page = document.querySelector<HTMLElement>('[data-library]');
  const shelves = page?.querySelector<HTMLElement>('[data-library-shelves]');
  const bookmarks = shelves?.querySelector<HTMLUListElement>('[data-bookmarks]');
  const recent = shelves?.querySelector<HTMLUListElement>('[data-recent]');
  const quotes = shelves?.querySelector<HTMLUListElement>('[data-saved-quotes]');
  const bookmarkHeading = shelves?.querySelector<HTMLHeadingElement>('[data-bookmark-heading]');
  const quoteHeading = shelves?.querySelector<HTMLHeadingElement>('[data-quote-heading]');
  const quoteTemplate = page?.querySelector<HTMLTemplateElement>('[data-quote-template]');
  const pattern = page?.querySelector<HTMLDetailsElement>('[data-quote-pattern]');
  const patternTitle = pattern?.querySelector<HTMLElement>('[data-pattern-title]');
  const patternQuotes = pattern?.querySelector<HTMLUListElement>('[data-pattern-quotes]');
  const copyDialog = page?.querySelector<HTMLDialogElement>('[data-copy-dialog]') ?? null;
  const status = shelves?.querySelector<HTMLElement>('[data-library-status]');
  if (!page || !shelves || !bookmarks || !recent || !quotes || !bookmarkHeading || !quoteHeading || !quoteTemplate || !status) return;
  const makeQuoteImage = createQuoteImageDialog(page.querySelector<HTMLDialogElement>('[data-quote-image-dialog]'));

  const bookmarkRows = new Map([...page.querySelectorAll<HTMLTemplateElement>('[data-bookmark-row]')]
    .map((row) => [row.dataset.bookmarkRow, row]));
  const recentRows = new Map([...page.querySelectorAll<HTMLTemplateElement>('[data-recent-row]')]
    .map((row) => [row.dataset.recentRow, row]));

  const displayedQuotes = new WeakMap<HTMLLIElement, SavedQuote>();

  const quoteSource = (quote: SavedQuote) => {
    const template = bookmarkRows.get(quote.postId);
    const anchor = template?.content.querySelector('a');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    const url = new URL(href, document.baseURI);
    if (quote.anchor) url.hash = quote.anchor;
    return { href: url.href, title: anchor?.textContent?.trim() || quote.title, topics: template?.dataset.postTopics ?? '' };
  };

  const renderPattern = (saved: SavedQuote[]) => {
    if (!pattern || !patternTitle || !patternQuotes) return;
    const connection = findQuotePattern(saved.flatMap((quote) => {
      const source = quoteSource(quote);
      return source ? [{ quote, topics: source.topics }] : [];
    }));
    pattern.hidden = !connection;
    if (!connection) {
      pattern.open = false;
      patternQuotes.replaceChildren();
      return;
    }
    const title = 'Three saved lines about ' + connection.theme;
    if (patternTitle.textContent !== title) pattern.open = false;
    patternTitle.textContent = title;
    patternQuotes.replaceChildren(...connection.quotes.map((quote) => {
      const source = quoteSource(quote)!;
      const item = document.createElement('li');
      const passage = document.createElement('blockquote');
      const link = document.createElement('a');
      passage.textContent = quote.text;
      link.href = source.href;
      link.textContent = source.title;
      item.append(passage, link);
      return item;
    }));
  };

  const updateCount = (name: string, count: number, noun = 'essay') => {
    const countLabel = shelves.querySelector<HTMLElement>(`[data-${name}-count]`);
    const empty = shelves.querySelector<HTMLElement>(`[data-${name}-empty]`);
    if (countLabel) countLabel.textContent = `${count} ${noun}${count === 1 ? '' : 's'}`;
    if (empty) empty.hidden = count > 0;
  };

  const render = () => {
    const library = readLibrary();
    const bookmarkItems = library.saved.flatMap((id) => {
      const template = bookmarkRows.get(id);
      const note = Object.hasOwn(library.revisits, id) ? library.revisits[id] : undefined;
      if (!template && !note) return [];
      const row = template ? template.content.cloneNode(true) as DocumentFragment : document.createElement('li');
      let body = row.querySelector<HTMLElement>('.essay-row__body');
      if (!template && note && row instanceof HTMLElement) {
        row.className = 'saved-page__dynamic';
        body = document.createElement('div');
        const link = document.createElement('a');
        link.className = 'text-link';
        link.textContent = note.title;
        link.href = `/posts/${encodeURIComponent(id)}/`;
        body.append(link);
        const button = document.createElement('button');
        button.className = 'text-link saved-page__dynamic-remove';
        button.type = 'button';
        button.textContent = 'Remove';
        button.dataset.removeBookmark = id;
        button.dataset.postTitle = note.title;
        button.setAttribute('aria-label', `Remove ${note.title} from Saved`);
        row.append(body, button);
      }
      if (body && note) {
        const past = document.createElement('p');
        past.className = 'saved-page__revisit';
        const label = document.createElement('strong');
        label.textContent = 'Your note';
        const reason = document.createElement('span');
        reason.textContent = note.text;
        past.append(label, reason);
        body.append(past);
      }
      return [row];
    });
    bookmarks.replaceChildren(...bookmarkItems);
    updateCount('bookmark', bookmarkItems.length);

    const recentItems = Object.values(library.history)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .flatMap(({ postId, progress }) => {
        const template = recentRows.get(postId);
        if (!template) return [];
        const row = template.content.cloneNode(true) as DocumentFragment;
        const link = row.querySelector<HTMLAnchorElement>('a');
        const completion = row.querySelector<HTMLElement>('[data-completion]');
        if (link && progress > 0 && progress < 100) {
          const destination = new URL(link.getAttribute('href') ?? '', document.baseURI);
          destination.searchParams.set('resume', '1');
          link.href = destination.href;
        }
        if (completion) completion.textContent = progress === 100 ? 'Finished' : progress > 0 ? `${progress}% read` : 'Opened';
        return [row];
      });

    recent.replaceChildren(...recentItems);
    updateCount('recent', recentItems.length);
    shelves.hidden = false;
  };

  const renderQuotes = () => {
    const saved = readSavedQuotes();
    const items = saved.flatMap((quote) => {
      const row = quoteTemplate.content.firstElementChild?.cloneNode(true) as HTMLLIElement | undefined;
      const text = row?.querySelector('[data-quote-text]');
      const source = row?.querySelector<HTMLAnchorElement>('[data-quote-source]');
      const unavailable = row?.querySelector<HTMLElement>('[data-quote-source-unavailable]');
      if (!row || !text || !source || !unavailable) return [];

      const destination = quoteSource(quote);
      text.textContent = quote.text;
      if (destination) {
        source.href = destination.href;
        source.textContent = destination.title;
      } else {
        source.hidden = true;
        unavailable.hidden = false;
        unavailable.textContent = `${quote.title} · Essay unavailable`;
      }
      const imageButton = row.querySelector<HTMLButtonElement>('[data-quote-action="image"]');
      if (imageButton && makeQuoteImage) imageButton.hidden = false;
      displayedQuotes.set(row, quote);
      return [row];
    });
    quotes.replaceChildren(...items);
    updateCount('quote', items.length, 'quote');
    renderPattern(saved);
  };

  bookmarks.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-remove-bookmark]')
      : null;
    const postId = button?.dataset.removeBookmark;
    if (!button || !postId) return;

    const index = [...bookmarks.querySelectorAll('[data-remove-bookmark]')].indexOf(button);
    savePost(postId, false);
    const remaining = bookmarks.querySelectorAll<HTMLButtonElement>('[data-remove-bookmark]');
    const focusTarget = remaining[Math.min(index, remaining.length - 1)] ?? bookmarkHeading;
    focusTarget.focus();
    status.textContent = `Removed ${button.dataset.postTitle ?? 'the essay'} from Saved.`;
  });

  quotes.addEventListener('click', async (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-quote-action]')
      : null;
    const row = button?.closest<HTMLLIElement>('[data-quote-row]');
    const quote = row && displayedQuotes.get(row);
    if (!button || !row || !quote) return;

    const action = button.dataset.quoteAction;
    if (action === 'copy' || action === 'image') {
      const source = row.querySelector<HTMLAnchorElement>('[data-quote-source]');
      const title = source?.textContent || quote.title;
      const url = source?.getAttribute('href') || undefined;
      if (action === 'image') {
        await makeQuoteImage?.({ text: quote.text, title, url }, button);
      } else {
        const value = [`“${quote.text}”`, `— ${title}`, url].filter(Boolean).join('\n');
        if (await copyText(value, copyDialog)) status.textContent = 'Quote copied.';
      }
      return;
    }
    if (action !== 'remove') return;

    const buttons = '[data-quote-action="remove"]';
    const index = [...quotes.querySelectorAll(buttons)].indexOf(button);
    if (!removeQuote(quote)) {
      status.textContent = 'This browser couldn’t remove the quote. Try again.';
      return;
    }
    const remaining = quotes.querySelectorAll<HTMLButtonElement>(buttons);
    const next = remaining[Math.min(index, remaining.length - 1)] ?? quoteHeading;
    next.focus();
    status.textContent = 'Quote removed from Saved.';
  });

  window.addEventListener(libraryChangeEvent, render);
  window.addEventListener(savedQuotesChangeEvent, renderQuotes);
  window.addEventListener('storage', (event) => {
    if (event.key === libraryKey || event.key === null) render();
    if (event.key === savedQuotesKey || event.key === null) renderQuotes();
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    render();
    renderQuotes();
  });
  render();
  renderQuotes();
}

initSaved();
