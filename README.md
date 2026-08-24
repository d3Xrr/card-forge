# TTRPG Card Forge

TTRPG Card Forge is a desktop Obsidian plugin for turning structured item notes already stored in a user's vault into printable TTRPG cards. It indexes TTRPG CLI/5etools-style item Markdown, renders deterministic physical cards, and exports print-ready A4 PDF sheets without uploading vault content.

Phase 4D connects non-destructive live editing, batch queue building, reusable Saved Print Sets, and a lightweight Export Gallery around the deterministic physical planner and local PDF export. Spells, feats, monsters, and other card types are not implemented yet.

## Current features

- Indexes item Markdown only inside a configurable vault-relative folder.
- Reads source metadata and Markdown through Obsidian's `Vault` and `MetadataCache` APIs without modifying source notes or artwork.
- Normalizes item identity, rules prose, structured weapon statistics, tables, source details, and local artwork.
- Plans semantic primary, continuation, and Crafting cards without clipping content.
- Uses one canonical physical profile for planning and export: 63.5 × 88.9 mm (2.5 × 3.5 inches), 750 × 1050 px at 300 DPI.
- Scales the already-planned physical card for the visible preview, so pane width no longer determines its page count.
- Provides a searchable, filterable, multi-select item browser, read-only Source Note mode, page navigation, and fit diagnostics.
- Provides responsive **Preview** and **Edit** modes with debounced canonical replanning while the last completed preview stays visible.
- Supports print-only overrides for title, type, rarity, attunement, rules Markdown, structured statistics, artwork, source text, and same-note variants.
- Recognizes `///CARD BREAK///` on its own line as an explicit new physical-card boundary; the delimiter is never rendered.
- Uses local files or explicitly requested HTTPS artwork as session-only ObjectURLs by default, while also supporting source art, no art, and existing vault-relative art. **Save to vault** opts into a collision-safe file under `Card Forge Assets`.
- Adds selected items to a persistent print queue only when the user requests it.
- Persists each queue entry's overrides and exposes them again through its **Edit** action after reload.
- Supports quantity changes, removal, clearing, accessible move-up/move-down ordering, and independent queue-entry duplication through compact icon actions.
- Saves named queue snapshots as persistent Saved Print Sets that can later replace the active queue with fresh live entry IDs. A loaded set becomes the session-local active set, with **Save**, **Save as…**, and automatic **Modified** status based on canonical queue content rather than live IDs.
- Persists available temporary artwork into the configured Card Forge Assets folder when a Saved Print Set is explicitly saved; missing temporary artwork blocks the save instead of creating an incomplete template.
- Adds command-palette actions to preview or queue the currently active indexed item note.
- Keeps continuation pages together in copy order. A two-card item at quantity three becomes `1,2,1,2,1,2`.
- Shows unique item types, total copies, physical cards, and required A4 pages.
- Shows a simple fixed-slot A4 sheet preview with page navigation.
- Exports eight exact-size cards per A4 landscape page in a four-column by two-row grid.
- Draws optional thin crop marks outside card content; crop marks are enabled by default and no bleed is added.
- Saves PDFs to the vault-relative `Card Forge Exports` folder by default and creates collision-safe filenames such as `card-forge-2026-08-13-1305-2.pdf`.
- Can open the last generated PDF in Obsidian, with optional automatic opening after export.
- Lists recognized Card Forge PDFs from the configured export folder in an Export Gallery with Obsidian-native Open and recoverable Delete actions.

## Print workflow

1. Open **TTRPG Card Forge** from the ribbon or command palette.
2. Select an item and inspect its canonical physical-card pages.
3. Optionally switch to **Edit** and make a live print draft. Use **Reset edits** or **Add to print queue**; there is no separate Apply step for a new draft.
4. Adding the same source with equivalent overrides increments its quantity; a different override state creates a distinct entry.
5. Use **Edit**, **Duplicate**, `+`, `−`, move-up, move-down, and remove controls to prepare the queue. Existing queue edits use **Save changes**, **Discard changes**, and **Reset to source**; reset remains a working draft until saved.
6. Optionally choose **Save as…** to create a reusable queue template. After loading or saving one, use **Save** to update that active set without another name prompt.
7. Inspect the physical-card count and A4 sheet preview, then choose **Export PDF**.
8. Open the generated PDF with **Open last PDF**, or use **Exports** to find earlier Card Forge PDFs in the configured folder.

A queue entry represents copies of an item, not a single rendered page. Every copy is fully emitted before the next copy begins, so continuation and Crafting cards remain adjacent to their primary card.

## Physical PDF layout

Each PDF page is exact A4 landscape (297 × 210 mm). Cards are placed row-major in fixed positions:

```text
1  2  3  4
5  6  7  8
```

Each card is drawn at exactly 63.5 × 88.9 mm. The grid uses 3 mm gaps, 17 mm left/right margins, and 14.6 mm top/bottom margins. A partial final sheet uses the same positions instead of being recentered.

Card DOM is rasterized locally to a lossless 750 × 1050 PNG, then embedded with `pdf-lib`. Canonically equivalent physical pages reuse the same in-memory raster during one export; distinct queue-entry content and artwork retain separate raster identity. No raster cache is persisted between Obsidian sessions.

## Settings

- **Item folder** — vault-relative source folder; default `2. Mechanics/items`.
- **PDF export folder** — vault-relative output folder; default `Card Forge Exports`.
- **Show crop marks** — enabled by default.
- **Open PDF after export** — disabled by default.

## Backlog

Deferred, non-release-blocking ideas are documented in [BACKLOG.md](BACKLOG.md). They are planning notes only and are not part of Phase 4D / 0.6.0.

## Development

Requirements:

- Node.js 18.18 or newer
- npm
- Obsidian desktop with a development vault containing the user's own structured item notes

```sh
npm install
npm run dev
```

Quality checks:

```sh
npm test
npm run lint
npm run build
```

The PDF pipeline uses the browser-compatible `html-to-image` and `pdf-lib` packages bundled into `main.js`. It does not use a CDN, remote service, system print dialog, private Electron API, or network request at export time. An HTTPS request occurs only when the user explicitly chooses **Temporary HTTPS URL** and activates **Use image**; the image is downloaded once into a runtime ObjectURL before rendering. It is written to the vault only when **Save to vault** is checked.

## Local development deploy

Keep the source repository outside the vault. Copy `dev.config.example.json` to the ignored `dev.config.json`, set its `vaultPath`, and run:

```sh
npm run deploy
```

Deployment copies only `main.js`, `manifest.json`, and `styles.css` into:

```text
<vaultPath>/.obsidian/plugins/ttrpg-card-forge/
```

Generated PDFs and explicitly persisted artwork are written through Obsidian's Vault API. Persistent artwork is stored in `Card Forge Assets`, never in the configured item-source folder. Temporary artwork stays in memory for the current plugin session. Source files under the configured item folder remain read-only.

## Manual or BRAT installation

Copy `main.js`, `manifest.json`, and `styles.css` from a matching release into `.obsidian/plugins/ttrpg-card-forge/`, reload Obsidian, and enable **TTRPG Card Forge** under **Settings → Community plugins**. BRAT users can add the repository URL as a beta plugin.

Release tags must exactly match `manifest.json` without a `v` prefix. The GitHub Actions release workflow runs tests, lint, and build before attaching the three release artifacts.

## Data and privacy

TTRPG Card Forge is local-first. It does not include D&D rules text or artwork, call game-data APIs, upload vault content, add telemetry, or download game data. Source Markdown and source artwork are read-only. Print overrides and Saved Print Set snapshots live in plugin data. Temporary image bytes are never stored as Base64 in plugin data, and their ObjectURLs are revoked when no draft, queue entry, or legacy saved-set reference uses them during the current session. Vault writes are limited to PDFs explicitly requested by the user and artwork persisted through an explicit card or Saved Set save. Web artwork is fetched only from a user-supplied HTTPS URL, downloaded once, and then rendered locally without a continuing remote dependency.

## Project layout

```text
src/
├── main.ts                    Plugin lifecycle, commands, settings, queue, and saved-set state
├── models/                    Item, physical-card profile, page, queue, and saved-set contracts
├── parsers/                   Pure frontmatter/body parsing and normalization
├── renderer/                  Semantic pagination, physical fitting, and card DOM rendering
├── services/                  Vault indexing, artwork, workflow, and queue planning
├── export/                    Rasterization, A4 geometry, PDF assembly, and vault storage
├── views/card-forge-view.ts   Browser, canonical preview, workflow panel, and export UX
└── settings.ts                Persisted settings and settings UI
```
