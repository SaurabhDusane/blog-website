# Second Ink design system

Second Ink borrows the structure of a personal reading desk. The homepage lets readers turn between notes by mood. An essay can be read in one quiet column or with the author’s marginal notes open. The last page is a moment to respond.

## Palette

| Role | Light | Dark | Sepia |
|---|---|---|---|
| Paper | `#F6F0E4` | `#181C27` | `#EADBC0` |
| Ink | `#1D2433` | `#F4ECDB` | `#372A21` |
| Secondary text | `#565969` | `#B7BBC9` | `#605044` |
| Cobalt links and notes | `#2345A2` | `#A8BFFF` | `#294A86` |
| Vermilion marks and errors | `#B83A26` | `#FFA48E` | `#903723` |
| Tinted surface | `#E5E8F3` | `#272F45` | `#E1CFB1` |

Use the shared `--paper`, `--ink`, `--muted`, `--blue`, `--red`, `--wash`, and `--line` tokens. Text links have an underline or an explicit control shape. Use color and a clear label together for state and status.

## Type and space

- **Instrument Serif** for the wordmark and headings. Headlines scale with the viewport and wrap at display-friendly widths.
- **Source Serif 4** for the reading column. The default article measure is approximately 65 characters and the reader can change the type size.
- **IBM Plex Sans** for controls, labels, and metadata. The fonts ship as locally hosted WOFF2.
- Use 4 px as the base spacing step with wider editorial gaps at 24, 32, 48, and 64 px. Page gutters and lead essay spacing grow fluidly. Keep reading columns narrower than indexes.

## Components and motion

| Component | Rule |
|---|---|
| Reading desk | Keep one note in view at a time. Mood tabs switch the note with one tap or the arrow keys. |
| Essay row | Keep the title as the primary link and align the reading estimate on a common edge. Stack metadata where width is limited. |
| Search excerpt | Put the matched passage below its essay and mark the matching words. Keep browse mode compact. |
| Archive question | Return short excerpts in the author's words. Give each one a direct link to its place in the essay. |
| Source card | Give the original article, its byline, and the author’s reason for picking it a quiet place above the take. |
| First impression | Offer three choices and a plain reading link. Keep the answer split beside the question. |
| Reconsideration | Show the reader’s own answers together. Keep group movement hidden until enough readers have responded. |
| Margin note | Put it beside the passage on wide screens and inline below it on small screens. Keep the label and link meaningful when read aloud. |
| Essay connection and revision | Keep an author’s reason next to the linked essay. Date later reflections and place them below the original text. |
| Loose Threads | Give each short note room to stand alone. Show a direct link when it becomes a longer essay. |
| Reader controls | Keep the toolbar compact, provide named controls for themes and size, and retain an exit from focus mode. |
| Saved quote | Set the passage in the reading typeface and put the source and actions beneath it. |
| Saved quote pattern | Keep the pattern collapsed until opened. Show one linkable quote from each of three essays. |
| Reading path | Pair the progress rule with a count and a direct link to the next essay. |
| Feeling map | Keep the labels and counts visible next to their bars so the display reads without color. |
| Private desk | Keep filtering, feeling counts, and notes on the same page. Pair the trend chart with daily counts. |
| Mood weather | Use a short set of cobalt rules beside the feeling names and counts. Put an approved monthly excerpt alongside the weather. |
| Short reads | Keep a small index by the desk. Show the time alongside each title. |
| Listening and offline tools | Put reader-initiated controls with compact status close to the essay. Keep the prose and reading preferences in view. |
| Quote image | Use paper, ink, and cobalt. Include the essay title with the passage and give readers a download button. |
| Social preview | Give the essay title and editorial mood room on a 1200 × 630 card. Include the title and mood in metadata for readers who cannot see the image. |
| Newsletter invitation | Place it inline after editorial content or on its own page. Keep the email label and feedback visible. |
| Progress rule | Track the article body. The rule can be read through a named progress control. |

Use short transitions around 160 ms for small state changes and page fades. Respect the operating system’s reduced-motion setting. Keep keyboard focus visible and test layouts with zoom, narrow screens, and all three themes.
