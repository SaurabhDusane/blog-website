# Publishing a note

## Publish from the browser

1. On a Sites deployment of Second Ink, open `/desk/publishing/` and use the same owner password as the response desk.
2. Start an essay, or choose **Import a Word document or PDF** to bring in its text. The draft editor accepts Markdown and keeps the original with each saved version. Use **Phone width** and **Review links** before saving. The desk flags missing Second Ink pages and lets you open external links for review.
3. Choose **Save draft**, then **Publish saved draft** when it’s ready. The live essay gets a permanent `/posts/` address and appears in Explore, RSS, and the sitemap. Under **Version history**, open **Restore this version** on an older draft to make it your latest draft. Publish it when you’re ready. The live copy stays in place during review.
4. Under **Voice notes**, pick any published essay, upload an MP3, M4A, WAV, or Ogg recording, and add its transcript. Saving adds a player and transcript to that essay. You can replace or remove the recording on the same screen.

The browser import supports Word and text-based PDFs up to 20 MiB. It brings in readable text and basic Word formatting. Use the repository workflow for complex Word or PDF layouts, existing repository essays, and full editorial metadata. Browser drafts and versions use the Sites D1 database and its private R2 bucket. To test locally, run `npm run build` followed by `npm run preview` with an owner password in `.env`.

## Publish through the repository

The linked Netlify project builds on changes to GitHub `main`.

To use Vercel, import `main`, choose Astro, and leave the root directory at `./`. The repository's `vercel.json` runs the same document-import build and serves the generated static files. Topic and mood sorting run during the build without an API key. The publishing desk and reader response API run on a Sites deployment with its storage bindings.

## How to publish a note

1. Open [the essay folder on GitHub](https://github.com/SaurabhDusane/blog-website/tree/main/posts/essays).
2. Select **Add file → Upload files** and drop in your `.docx` or text-based `.pdf`.
3. Choose **Commit directly to the `main` branch** and select **Commit changes**. The connected publishing workflow converts the essay and adds its topics and mood. Use `updates` for changes you want to review before merging to `main`.

Upload a replacement with the same filename to update a note. Delete the file to remove the note. A clearly identifiable rename keeps its existing URL. Use the **Actions** tab for build checks and Netlify’s **Deploys** tab for the publishing result.

For a short thought, upload to `posts/threads/`. You can also add optional connections, dated reflections, and labeled margins to an essay. [Editorial options](README.md#connections-revisions-and-loose-threads)

## What to do if a post doesn’t show up

The **Document conversion** summary in GitHub Actions shows the topics and mood applied to each published upload. It labels your supplied metadata and shows the confidence of automatic assignments. **Unassigned** means the sorter found too little evidence for a topic. The same report appears in the build log and at `.data/document-import-report.txt` when you build locally.

- Open the latest build in Netlify and look for the file in **Document conversion report**. The report explains drafts, future publication dates, removals, and conversion problems.
- If it’s a scan, export a PDF with selectable text and upload it again. Image-only PDFs are skipped, and OCR is disabled. If a file is protected or damaged, export an unlocked copy.
- If GitHub rejects the upload, keep each file at or below **25 MiB** for browser uploads. The importer itself accepts up to **40 MiB**. [GitHub upload limits](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)

## How the system works

A plain document is enough. The title comes from its heading, first line, or filename. The publication date comes from `YYYY-MM-DD_title.docx` or the equivalent PDF name, then a `date` field, then the first Git commit. Later edits show an update date and keep the original publication date.

If you want more control, put a header at the start of your Word document or upload one matching companion file beside the PDF, such as `my-note.pdf` and `my-note.yml` or `my-note.yaml`. Useful fields include `title`, `summary`, `tags`, `mood`, and `reading-paths`. Leave tags and mood blank for automatic sorting. Use a comma-separated list of existing reading-path IDs.

Put drafts in `posts/drafts/` or set `status: draft`. Set `publish-date` to a future date to hold a note until the next build after that time. Date-only schedules use Phoenix midnight. Drafts and scheduled notes can be read in private previews before publication. Every published PDF offers **Read the original PDF**. Notes with complex layouts also offer a page viewer.

Netlify converts the files and publishes the resulting essays. GitHub Actions runs the same checks on `main`, `updates`, and pull requests. [Technical notes](README.md#document-publishing-internals)
