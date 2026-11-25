# Publishing a note

## Publish from the browser

1. On the owner Site, open `/desk/publishing/` and use the same owner password as the response desk.
2. Start an essay, or choose **Import a Word document or PDF** to bring in its text. The draft editor accepts Markdown and keeps the original with each saved version. Use **Phone width** and **Review links** before saving. The desk flags missing Second Ink pages and lets you open external links for review.
3. Choose **Save draft**, then **Publish saved draft** when it’s ready. The live essay gets a permanent `/posts/` address and appears in Explore, RSS, and the sitemap. Under **Version history**, open **Restore this version** on an older draft to make it your latest draft. Publish it when you’re ready. The live copy stays in place during review.
4. Under **Voice notes**, pick any published essay, upload an MP3, M4A, WAV, or Ogg recording, and add its transcript. Saving adds a player and transcript to that essay. You can replace or remove the recording on the same screen.

The browser import supports Word and text-based PDFs up to 20 MiB. It brings in readable text and basic Word formatting. Use the repository workflow for complex Word or PDF layouts, existing repository essays, and full editorial metadata. Browser drafts and versions use the Sites D1 database and its private R2 bucket. To test locally, run `npm run build` followed by `npm run preview` with an owner password in `.env`.

## Publish through the repository

Netlify’s connected build publishes GitHub `main`. If you use Vercel, import `main` with the Astro preset and leave the repository’s `vercel.json` in place.

## How to publish a note

1. Open [the essay folder on GitHub](https://github.com/SaurabhDusane/blog-website/tree/main/posts/essays).
2. Select **Add file → Upload files** and drop in your `.docx` or text-based `.pdf`.
3. Choose **Commit directly to the `main` branch** and select **Commit changes**. The connected publishing workflow converts the essay and adds its topics and mood. Use `updates` for changes you want to review before merging to `main`.

Upload a replacement with the same filename to update a note. Delete the file to remove the note. A clearly identifiable rename keeps its existing URL. Use the **Actions** tab for build checks and your connected host’s deploy log for the publishing result.

For a short thought, upload to `posts/threads/`. You can also add optional connections, dated reflections, and labeled margins to an essay. [Editorial options](README.md#connections-revisions-and-loose-threads)

## What to do if a post doesn’t show up

The **Document conversion** summary in GitHub Actions shows the topics and mood applied to each published upload. It labels your supplied metadata and shows the confidence of automatic assignments. **Unassigned** means the sorter found too little evidence for a topic. The same report appears in the build log and at `.data/document-import-report.txt` when you build locally.

- Open **Actions → Publish Second Ink → latest run → Summary** and look for the filename. The report explains drafts, future publication dates, removals, and conversion problems. A failed replacement keeps the last successfully published version. The workflow also leaves a failure note on the commit when GitHub permits it.
- If it’s a scan, export a PDF with selectable text and upload it again. Image-only PDFs are skipped, and OCR is disabled. If a file is protected or damaged, export an unlocked copy.
- If GitHub rejects the upload, keep each file at or below **25 MiB** for browser uploads. The importer itself accepts up to **40 MiB**. [GitHub upload limits](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)

## Correct a topic or mood

For a draft created in the publishing desk, open **Topics and mood** and choose your labels. Saving creates a new revision. Your choices carry over when you edit or publish that draft. Return a field to automatic to let the sorter choose it again.

For a repository upload, open **Correct a label** in the Actions summary. Add or edit the named `.labels.yml` file beside the document. For example, add `my-essay.docx.labels.yml` alongside `my-essay.docx`. The same pattern works for PDFs. Include only the settings you want to correct.

```yaml
tags: [Politics & Civic Life, Tools & Technology]
mood: curious
```

To clear all tags, use `tags: []`. Deleting the correction file restores the upload’s usual tags and mood on the next build.

## Invite a reader to a saved draft

Save a draft in the owner’s desk. Open **Invite an early reader**, choose when the link should expire, and share the copied link yourself. The desk keeps replies under the version the reader received. Use **Close link** to end access early.

The owner’s Site requires sign-in. To offer links to guests, configure a review endpoint on the public reader host. On the public host, set `SECOND_INK_REVIEW_UPSTREAM` to the HTTPS origin of the owner’s Site, `SECOND_INK_REVIEW_UPSTREAM_TOKEN` to its server-to-server credential, and `SECOND_INK_REVIEW_BRIDGE_SECRET` to a random 32-byte hex secret. Store the token and bridge secret as server secrets. On the owner’s Site, set the same bridge secret and set `SECOND_INK_REVIEW_ORIGIN` to the HTTPS origin of the guest host. Deploy both hosts with those settings and test an invitation before sharing it.

## Review a public release

- In the document conversion report, check the selected title and its source. Put `title` in the matching `.labels.yml` correction file to change the headline and keep its existing URL.
- In the private publishing desk, **Find connections** suggests links backed by passages. Choose the connections you want and save the revision before publishing.
- To send a saved browser essay through the same public build as repository uploads, configure the GitHub App values in `.env.example` on the owner host. Grant the installation access only to the publishing repository and give it Contents write access. Store the private key as a Site secret. Then use **Send to GitHub**. The desk also offers a Markdown download for manual publication.
- For a scanned PDF, put the draft in `posts/drafts/` and set `ocr: review` in its YAML companion. Install Tesseract, set `SECOND_INK_ENABLE_OCR=1` and open a private document preview with `SECOND_INK_INCLUDE_DRAFTS=1`. Review the text against the scan before publishing a corrected text document.
- A Word metadata line or PDF companion entry can publish a short comparison. Use `Before-after: YYYY-MM-DD | Title | Earlier excerpt | Later excerpt | Optional note` and include only text you want readers to see. For Markdown use `beforeAfter` entries with `date`, `title`, `earlier`, `later`, and an optional `note`.

The live verification workflow checks the exact public deployment, archive search, and the reader response handshake. The response desk shows the latest successful check, a weekly aggregate readership summary, and a recovery bundle. Download the bundle there and run `node scripts/rehearse-recovery.mjs <bundle.ndjson>` to verify a restore in a new local directory.

## How the system works

A plain document is enough. The title comes from its heading, first line, or filename. The publication date comes from `YYYY-MM-DD_title.docx` or the equivalent PDF name, then a `date` field, then the first Git commit. Later edits show an update date and keep the original publication date.

If you want more control, put a header at the start of your Word document or upload one matching companion file beside the PDF, such as `my-note.pdf` and `my-note.yml` or `my-note.yaml`. Useful fields include `title`, `summary`, `tags`, `mood`, and `reading-paths`. Leave tags and mood blank for automatic sorting. Use a comma-separated list of existing reading-path IDs.

Put drafts in `posts/drafts/` or set `status: draft`. Set `publish-date` to a future date to hold a note until the next build after that time. Date-only schedules use Phoenix midnight. Drafts and scheduled notes can be read in private previews before publication. Every published PDF offers **Read the original PDF**. Notes with complex layouts also offer a page viewer.

The linked host converts the files and publishes the resulting essays. GitHub Actions runs the build checks on `main` and `updates`. The conversion report and the ledger of published URLs and last-good files are available to troubleshoot or extend the workflow. [Technical notes](README.md#document-publishing-internals)
