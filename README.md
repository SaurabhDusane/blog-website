# Second Ink publishing test

This public sandbox exercises Second Ink’s Word and PDF importer using sample documents. Upload only files that are safe to share publicly.

1. On GitHub, open posts/ and select **Add file → Upload files**.
2. Drop in a sample .docx or text PDF and commit it to main.
3. Open **Actions → Public document smoke test** for the conversion report.

The first deploy includes a Word article and PDF article. The synthetic file in posts/drafts/ is excluded from the built site. A PDF can use an optional matching .yml file.

Netlify can build this repository with Node 22 and npm run build, using dist as the publish folder. Connecting this repository in Netlify enables deployment on future commits.
