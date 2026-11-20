# Second Ink

Second Ink is a personal reading desk for thoughts that follow you away from an article. Start with the source and a first impression. At the end, leave a feeling to see how it landed for other readers.

## Run the site

Use Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open the URL printed by Astro. In PowerShell, use `npm.cmd` if your execution policy blocks the npm PowerShell shim.

```sh
npm run check
npm run build
npm run preview
```

The production preview serves the built site and handles reader feelings, newsletter signups, and private replies. For settings, create `.env` from `.env.example` if it’s missing. Set `SITE_URL` to the address readers use. Set `PUBLIC_AUTHOR_EMAIL` or the corresponding author’s `email` field if you prefer to receive replies by email.

## Publish a document

Add Word and text-based PDF essays to `posts/essays/` on `main`. The [publishing guide](PUBLISHING.md) covers uploads, updates, and the conversion report. Use `updates` for changes you want to review before merging.

On the live Sites deployment, the [publishing desk](PUBLISHING.md#publish-from-the-browser) also accepts Word and text-based PDF uploads. The desk keeps working drafts and their originals in Sites storage. Use the repository workflow for existing repository essays, document layouts with complex formatting, and MDX features such as margins and inline citations.

```text
posts/
  essays/
    my-note.docx
    another-note.pdf
    another-note.yml
  drafts/
    another-note.docx
```

For optional metadata, put a block of ordinary `field: value` paragraphs at the top of a Word document. A styled Word title can sit above them. For a PDF, use a companion with the same filename stem and a `.yml` or `.yaml` extension. Use one companion per PDF. Fields are optional and extra fields are ignored.

```yaml
title: A little less hurry
date: 2026-11-18
tags: Attention, Creative Practice
summary: A note about leaving one small gap in the day.
status: published
publish-date: '2026-11-18T07:30:00-07:00'
reading-paths: start-here, rough-work
source-title: The article I’m responding to
source-author: The writer’s name
source-url: https://example.com/original-article
why-i-picked-this: I kept thinking about it on the walk home.
```

- The first Heading 1, first line, or cleaned filename supplies the title when you leave it out. The date uses a `YYYY-MM-DD_title` filename prefix, then the `date` field, then the file’s first Git commit. An uncommitted local file uses its modification date. The body supplies the excerpt and reading time. The first usable image becomes the cover, with a Second Ink design when you omit images. Leave tags and mood blank to have Second Ink assign them automatically. Your supplied tags and valid mood take precedence.
- The first publication fixes the URL and publication date. Later edits show an update date. Renames preserve the URL when Git or identical file content identifies the move. When titles produce the same URL, the importer adds a numeric suffix. For reading paths, use existing IDs from `src/content/series/`.
- Put a draft under `posts/drafts/` or use `status: draft`. `publish-date` sets the earliest eligible build time. Date-only schedules start at Phoenix midnight. An explicit offset sets a precise time, and the connected workflow checks hourly. The private review build includes drafts and scheduled notes.
- Word’s headings, lists, emphasis, tables, quotes, and footnotes carry through to the site. Add image descriptions and use Word’s **References → Insert Footnote** for a margin note. The importer sizes supported images to WebP and makes an outline when at least three headings remain in the body. For PDFs, every successful import links to the original file, and complex layouts get an expandable viewer. A textless scan is reported and skipped. OCR is disabled.
- Other Word fields include `archive-url` for a saved source copy, `claim` and `claim-question` for the poll, and `question` for the follow-up. `mood` accepts `reflective`, `practical`, or `curious`. `update` accepts `YYYY-MM-DD | your note`, and `author` selects an existing author ID.

### Connections, revisions, and Loose Threads

Drop a short Word document or PDF in `posts/threads/` to give it a place on **Loose Threads**. A document in `posts/` or `posts/drafts/` can also use `Kind: thread` in its optional metadata. Add `Follow-up` when a short thought grows into a full essay. Use the ending of the essay’s URL as its slug.

Word can use these lines in the optional header. Each connection or revision gets its own line.

```text
Kind: thread
Follow-up: keep-a-friction-log
Connection: who-decides-what-comes-next | Both essays ask how habits become defaults.
What I think now: 2026-11-19 | I’m more curious about who gets to change a default. | /posts/who-decides-what-comes-next/ | Read the follow-up
```

A PDF companion uses the same fields. List multiple connections and revisions as YAML arrays of strings.

```yaml
connection:
  - "keep-a-friction-log | I saw the same question in a daily routine."
what-i-think-now:
  - "2026-11-19 | Here’s the part I see differently now."
```

Start a Word footnote with `What I saw:`, `What I’m guessing:`, or `The strongest objection:` to give it a label. In MDX, set the `kind` on `MarginNote` to `observation`, `hunch`, or `objection`. The label opens the individual margin note.

## Document publishing internals

The built-in text classifier looks at the title, description, and essay text to assign up to two topics and a mood. It runs during Word and PDF imports and when a browser draft is saved. Essay text stays in the publishing environment. The model can leave a topic blank if the evidence is weak. The owner-only `POST /api/admin/publishing/sort/` endpoint accepts JSON with `title`, `description`, and `body` and returns the classification and confidence without publishing. Readers can filter using the saved labels in Explore.

Astro renders the notes into the existing article layout, homepage, Explore index, topic pages, reading paths, RSS, sitemap, and social cards. `npm run posts:import` refreshes the local report at `.data/document-import-report.txt` and its JSON version at `.data/document-import-report.json`. The production workflow adds the report to the run summary and attempts one failure comment per affected push.

`.data/word-import-cache/` stores reusable conversions of published documents. The publication ledger, `.data/document-state.json`, assigns permanent URLs and points to last-good document snapshots and assets. On Netlify, the active deployment identifies its immutable state in the site’s Blobs store. The workflow stages a new release and its assets before deploying, and the next build starts from the state of the version that went live. A corrupted replacement keeps the previous working post. Deleting a file or moving it to drafts removes its live page on the next successful deployment. Keep this state, the repository, and its Git history together when moving to another project.

The conversion cache keeps a status and no document content for unchanged draft, scheduled, and unreadable files. Use `npm run build:netlify` to build the Netlify package locally. It stages static assets and redirect rules in `.netlify-output/`. `npm run build` builds the separate Sites Worker release.

## Add an annotated MDX essay

1. Copy an essay in `src/content/posts/` to a new file named for its permanent slug. Use `.md` for an essay with prose and links or `.mdx` for an essay with annotated margins.
2. Fill in the title, one-line description, publication date, author ID, topic IDs, mood, and estimated reading time. The supported moods are `reflective`, `practical`, and `curious`. An author or topic ID is the filename from its collection without its extension.
3. Write the essay below the front matter. Set `featured: true` on the current lead essay. Mark older leads `featured: false`. You can add `related` with a list of essay slugs in preferred order. Shared topics supply further links. For an optional cover, copy an image to `src/assets/` and add `image: ../../assets/your-image.webp` and a descriptive `imageAlt`.
4. To put the essay on a reading path, add its slug to the ordered `posts` list in `src/content/series/`. Run `npm run check` and `npm run build` before publishing.

For an MDX margin note, import the component near the top of the file and put it on its own line after the relevant passage. Use a unique note ID within the article so readers can link to the note.

```mdx
import MarginNote from '../../components/MarginNote.astro';

An experiment belongs where you can repeat it.

<MarginNote id="notice-one-default" label="Try this" href="/posts/keep-a-friction-log/" linkLabel="Keep a friction log">
  Pick one tool you reach for every day. Write down the first choice it makes on your behalf.
</MarginNote>
```

MDX posts can use `reflectionQuestion` and `sourceUrl` in front matter. The three annotated sample essays are *The case for a rough draft*, *Keep a friction log*, and *Who decides what comes next?*.

### Reading editions, sources, and field notes

- Create an `.md` file in `src/content/editions/` with `title`, `description`, `publishedAt`, `author`, and an ordered `posts` list. Each entry takes `post` with an essay slug and an optional `note` explaining why you paired it with the others. Put your introduction in the Markdown body. **Download newsletter draft** exports the introduction, ordered notes, and canonical links as Markdown.
- Define a reusable source in `src/content/sources/short-id.md` with `title` and `url`. You can add `author`, `publication`, `year`, and `archiveUrl`. In essay front matter, add `sources: [{ source: short-id, role: supports, note: 'What I took from this.' }]`. The roles are `supports`, `complicates`, and `background`. In MDX, import `SourceCitation` from `../../components/SourceCitation.astro` and place `<SourceCitation source="short-id" label="Read the source note" />` by the passage. In Word, use a `Source note: short-id | supports | What I took from this.` line per source. In PDF YAML, list those strings under `source-note`. The existing link checker covers references in published essays.
- To ask for a private observation, set `fieldNotePrompt` in an essay’s front matter or `Field note prompt` in Word and PDF metadata. Readers can send one note per essay per browser and choose whether to permit an anonymous quote. Review it under **Reader responses → Reader field notes**. Review status and permission stay private. Notes are included in the private response export and backups.

## Feedback and private desk

When a post has a claim, readers can answer agree, unsure, or disagree and see the split before they read the author’s take. The reading link also works when a reader skips the vote. Feeling feedback opens after reaching the end and spending time with the visible essay. A note and the follow-up answer are optional. After submitting, readers see the six feeling totals for that essay. Private notes and answers are visible through the owner dashboard.

A browser flag and a uniqueness rule keep one vote and one feeling per browser per essay. A signed reading check, a hidden honeypot, and an hourly limit protect submissions. To enable Cloudflare Turnstile, create an **Invisible** widget for the live hostname and set `SECOND_INK_TURNSTILE_SITE_KEY` and `SECOND_INK_TURNSTILE_SECRET_KEY` together in the host’s runtime settings. Mark the secret key as a secret. Include the [Cloudflare Turnstile Privacy Addendum](https://www.cloudflare.com/cloudflare-turnstile-privacy-addendum/) in your site’s privacy notice when enabling the provider. [Turnstile widget modes](https://developers.cloudflare.com/turnstile/concepts/widget/)

Open `/desk/responses/` and enter `SECOND_INK_ADMIN_PASSWORD`. Use a password of at least 16 characters in your local `.env` and a runtime secret of the same name on your host. The desk shows feelings, first-impression votes, a 30-day view, and private notes and answers. Use **Keep quote** to make a response easier to find again. **Private replies** is the separate inbox for messages readers send through the site.

Readers can opt in to sharing an anonymous excerpt when they leave a new note. Choose an exact excerpt of an eligible note, check it for identifying details, and feature it on the homepage. The homepage shows one excerpt in the current UTC month. You can replace or retract it from the desk. Older notes and private replies remain in the private desk.

Use **Response backups** in the signed-in desk to download a current JSON export. It contains responses, aggregate first impressions, featured excerpts, and private replies with any email the reader supplied. Keep downloaded copies private. On Sites, the weekly writer stores one copy per Phoenix calendar week in the private R2 bucket. **Browse weekly copies** lists these files for the signed-in owner. The export rejects snapshots larger than 4 MiB or 2,000 rows per section so a partial copy can’t pass for a complete one. A full database restore is a separate D1 operation.

## Reader tools

- **Questions** brings together essays on an ongoing question. Follow on this device to see new entries or subscribe to that question’s RSS feed. Add or update the Markdown list in `src/content/questions/` to grow a question. Each `posts` entry includes `post`, `addedAt`, and an optional note.
- **Set aside with a note** saves an essay and a private reason on the current device. The note appears when you return to the essay or open Saved.

- **Ask the archive** uses the published essay index to answer a reader’s question with excerpts and direct links to passages.
- **Editions** puts essays from different subjects in a sequence around a question. Each edition has its own link and a downloadable newsletter draft.
- **Loose Threads** collects short notes and lets readers open one at random. A thread can link forward to its finished essay.
- **Where do you land now?** appears after an essay with a first-impression question. Readers compare their own answers after reading. The site shows shared movement once enough other readers have answered.
- **Connections** and **What I think now** display the author’s optional links and dated reflections.
- **Saved quote patterns** show three saved lines from different essays when the wording suggests a shared theme. This runs in the browser using the quotes already on that device.

- **Mood weather** reflects anonymous feeling counts from essays with at least three responses. Explore’s **Reader feeling** filter uses those same counts, alongside the existing topic, mood, reading time, and text filters.
- **Listen** reads the essay using the available voice on your device. Use the playback and speed controls on the essay.
- **A voice note from the author** opens a recording and transcript when one is attached. Add or update it under **Voice notes** in the publishing desk.
- **Quote image** turns a highlighted passage or a passage from the end-of-essay picker into a styled PNG. The image can be downloaded and, when your device supports sharing files, shared directly.
- **Link previews** use a 1200 × 630 share image with the essay title and editorial mood generated at build time. Open Graph and X metadata point to that image. External link unfurlers need access to the publication to retrieve it.
- **Offline** keeps a chosen essay and the assets needed to read it in the current browser. Select **Keep offline** on an essay, then open it from `/offline/`. Offline saves are separate from ordinary bookmarks. Reader submissions and the private desk use a network connection.
- **Paper theme** starts in warm beige. Choose **Auto** in reading settings to follow approximate sunrise and sunset for the desk’s Phoenix clock, which also updates the homepage greeting. The calculation uses no location permission. [NOAA solar equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF)

Astro renders essays to HTML. Explore uses a static index of published titles, metadata, and essay passages. Ordinary article links can prefetch after hover, keyboard focus, or approaching the viewport. The browser skips prefetch on slower connections or with Data Saver enabled. Thin server routes handle feedback and the dashboard. Sites stores feedback in D1 and local preview uses SQLite through Node.

## Connect GitHub to Netlify

The public GitHub repository publishes its `main` branch through Netlify’s connected build. The workflow below covers a separate private repository.

Netlify can deploy the existing Astro output and run the response desk API. The live Second Ink site is hosted on ChatGPT Sites with D1 and R2 bindings. The GitHub workflow can publish to a separate Netlify URL once that project is connected. Keep the current site available while verifying the staged site and arranging any reader-data or backup migration.

1. **Create the private GitHub repository.** In GitHub, choose **+ → New repository**, set visibility to **Private**, and select **Create repository**. Place the project files at the repository root on `main`, including `.github/workflows/publish.yml` and `posts/`. You can also use an existing private repository that already holds these files.
2. **Create a Netlify project for manual deploys.** In Netlify choose **Projects → Add new project → Deploy manually**. For the initial setup, use a harmless placeholder folder with an `index.html`. GitHub Actions manages later releases. [Netlify Drop setup](https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/)
3. **Protect the new project.** In Netlify, open **Project configuration → General → Visitor access → Project visibility**. Set both **Production deploys** and **Previews** to **Private** and save. Copy the HTTPS project URL. Under **Project configuration → General → Project information**, copy **Project ID**. Netlify handles preview sign-in with your account. [Netlify project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)
4. **Generate a Netlify token.** From your Netlify profile, open **User settings → Applications → Personal access tokens → New access token**. Enter a description and expiration date, then choose **Generate token** and copy it. Save the token directly into GitHub Actions secrets. [Netlify access tokens](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/#authentication)
5. **Add deployment secrets in GitHub.** Open the private repository’s **Settings → Secrets and variables → Actions → Secrets**. Click **New repository secret**, enter `NETLIFY_AUTH_TOKEN` and paste the token, then click **Add secret**. Repeat with `NETLIFY_SITE_ID` and the Netlify Project ID. [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets#creating-secrets-for-a-repository)
6. **Enable publishing.** In the same GitHub settings, open **Variables → New repository variable**. Add `SITE_URL` with your Netlify HTTPS origin. Add `NETLIFY_PRIVATE_PROJECT` with value `true` after confirming both privacy settings. Open **Actions → Publish Second Ink → Run workflow**, choose `main` and select **Run workflow**. Use the run summary to review the deployment and conversion results.

Pushes to `main` rebuild and publish. Pushes to other branches and pull requests within the same private repository get a preview link in the run summary. Fork pull requests run build checks without deployment credentials. Preview copies let you review drafts, article pages, and their assets. The response desk, submissions, and offline installation are production features. Preview downloads and pages require Netlify sign-in.

For reader submissions and the desk on Netlify, configure a D1 database and apply the numbered `drizzle/` migrations in the target database. In the Netlify project open **Project configuration → Environment variables → Add a variable → Add a single variable** for each key. Set the scope to **Functions** and give each value to the **Production** context. Use a Cloudflare API token authorized for the target D1 database, and use the intended reader database so its records persist across deploys.

| Variable | Value |
|---|---|
| `SECOND_INK_D1_ACCOUNT_ID` | The Cloudflare account ID |
| `SECOND_INK_D1_DATABASE_ID` | The D1 database ID |
| `SECOND_INK_D1_TOKEN` | Runtime Cloudflare API token, marked as secret |
| `SECOND_INK_ADMIN_PASSWORD` | Private desk password, marked as secret |

The current Sites deployment’s automated response backups use its R2 bucket. The Netlify Blobs store holds the document publication state. [Netlify Functions environment variables](https://docs.netlify.com/build/functions/environment-variables/) · [Cloudflare D1 API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)

## Maintenance and analytics

- **Source links.** Run `node scripts/check-source-links.mjs` after building to check links from published essays. The report is at `.data/source-link-report.txt`. A confirmed missing source can display a verified archive beside the original on the next build. An archive you specified in Word or MDX takes priority. The GitHub workflow checks links on Mondays at 08:43 UTC, keeps the report for 14 days, and rebuilds the source cards when the status changes.
- **Service health.** `GET /api/health/` verifies that the response database is reachable and returns a small status response. In the host’s function logs, filter by the JSON field `service: "second-ink"`. Entries identify the operation and outcome. Reader text, email, IP addresses, and storage error details are kept out of these application logs.
- **Plausible.** Create a Plausible site and set `PUBLIC_PLAUSIBLE_DOMAIN` to the hostname in `SITE_URL` before building. For GitHub Actions, use a repository variable of the same name. This opt-in integration counts visits on the canonical HTTPS origin and respects Global Privacy Control and Do Not Track. Its pageview payload contains the origin and path. The adapter sends no query strings, reader events, cookies, or private desk activity. [Plausible Events API](https://plausible.io/docs/events-api)

## Site map

| Route | Purpose |
|---|---|
| `/` | The reading desk, with a note for each mood |
| `/explore/`, `/topics/[slug]/` | Search and browse |
| `/loose-threads/` | Short thoughts and their follow-up essays |
| `/start/`, `/series/[slug]/` | Follow a reading path |
| `/posts/[slug]/`, `/authors/[slug]/` | Read an essay and find more from its author |
| `/saved/` | Bookmarks, reading history, and quotes on this device |
| `/offline/` | Essays kept for offline reading in this browser |
| `/about/`, `/newsletter/` | About the desk and the newsletter invitation |
| `/desk/responses/` | Private feedback dashboard, reply inbox, and backups |
| `/desk/publishing/` | Owner-only draft editor, previews, revision history, and voice notes on Sites |
| `/editions/`, `/editions/[slug]/` | Curated essay sequences and newsletter drafts |
| `/rss.xml`, `/sitemap-index.xml`, `/404.html` | Feed, search discovery, and missing page |

## Project structure

| Location | Responsibility |
|---|---|
| `posts/essays/` | Word and PDF originals, plus optional companion YAML files. Use `posts/drafts/` for drafts and `posts/threads/` for short notes. |
| `src/content/` and `src/content.config.ts` | Markdown and MDX records for posts, series, topics, authors, pages, editions, and reusable sources |
| `src/pages/` and `src/layouts/` | Site routes, the shared shell, and search metadata |
| `src/components/` | Essay rows, margin notes, collection pages, and newsletter invitations |
| `src/styles/` | Design tokens, article layout, and discovery styles |
| `src/lib/` and `src/scripts/` | Editorial queries, reader state, discovery, and analytics events |
| `scripts/` and `drizzle/` | Word and PDF conversion, publication state, site packaging, server routes, and database migrations |
| `.github/workflows/` and `netlify/` | Build-on-push workflow and Netlify serverless transport |
| `src/assets/` and `public/` | Responsive image sources, social preview, and favicon |

The article and archive pages are pre-rendered. Explore searches titles, descriptions, and the prose of published essays. Add a text query to see a matching passage, and combine it with topic, reading time, or mood filters. Search and filter state lives in the URL, so you can share the same results.

The browser stores theme, text size, bookmarks, reading history, and saved quotes on the current device. To keep a line, highlight it in an essay and choose **Save quote**, or use **Save or share a quote** at the end. Open **Saved** to copy quotes, revisit their passages, or remove them. **Start here** and each reading path show which essays you’ve finished and link to the next one.

Newsletter signup and private replies persist on the server. Locally, the database lives at `.data/second-ink.sqlite`. On Sites, the equivalent database is the production D1 binding `DB`. Read `newsletter_subscriptions` for opt-ins and `author_replies` for the private inbox. The site collects subscriptions and replies without sending email. To send a newsletter, connect an email provider or export the list into your mailing workflow.

### Extend the site

- **Content and CMS.** Keep stable IDs when adding authors, translations, or migrating to a headless CMS. Replace the collection loaders and map the CMS data into the same schemas. Keep essay and series lookups in `src/lib/content.ts`. Reserve `/posts/`, `/series/`, `/topics/`, and `/authors/` for their collections.
- **Audio and video.** Add optional typed media metadata with a transcript or captions. Render media from a reusable component in the article template so the paths, topic pages, and RSS feed continue to use the same post records.
- **Translations.** Add locale-aware routes and stable translation references, then generate alternate-language metadata and group related essays by locale. The seed publication uses English.
- **Memberships and shop.** Add authenticated server routes or link an external checkout when those features are ready. The editorial content and the anonymous local reader library can continue to work independently.
- **Analytics.** The local `second-ink:analytics` browser event is available for an opt-in provider adapter. Its payload contains an event name and a small data object. Keep private reader data out of any adapter.

## Next features ranked by impact

1. **Newsletter delivery and confirmations.** Connect an email provider and add welcome, confirmation, and unsubscribe flows.
2. **A reading shelf.** Gather the original articles with short notes about why you return to them.
3. **Richer PDF text.** Improve paragraph flow for scanned and complex documents with opt-in OCR and clearer reading order.
4. **Search by passage heading.** Let Explore link directly to a match inside the essay.
5. **Library export.** Let readers download saved quotes as Markdown.
6. **Audio editions.** Publish narrated essays and transcripts using the same editorial records.
7. **Editorial CMS workflow.** Give contributors a review process alongside the existing Word and Markdown workflow.
8. **Translations.** Launch a curated second-language collection with language-aware search and feeds.
