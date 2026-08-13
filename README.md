# TTRPG Card Forge

TTRPG Card Forge is a desktop Obsidian plugin for turning structured item notes already stored in a user's vault into printable TTRPG cards. It indexes TTRPG CLI/5etools-style item Markdown, renders deterministic physical cards, and exports print-ready A4 PDF sheets without uploading vault content.

Phase 3 adds a persistent print queue and local PDF export on top of the completed Phase 2 item renderer. Spells, feats, monsters, and other card types are not implemented yet.

## Current features

- Indexes item Markdown only inside a configurable vault-relative folder.
- Reads source metadata and Markdown through Obsidian's `Vault` and `MetadataCache` APIs without modifying source notes or artwork.
- Normalizes item identity, rules prose, structured weapon statistics, tables, source details, and local artwork.
- Plans semantic primary, continuation, and Crafting cards without clipping content.
- Uses one canonical physical profile for planning and export: 63.5 × 88.9 mm (2.5 × 3.5 inches), 750 × 1050 px at 300 DPI.
- Scales the already-planned physical card for the visible preview, so pane width no longer determines its page count.
- Provides a searchable item browser, source-note action, page navigation, and fit diagnostics.
- Adds selected items to a persistent print queue only when the user requests it.
- Supports quantity changes, removal, clearing, and accessible move-up/move-down ordering.
- Keeps continuation pages together in copy order. A two-card item at quantity three becomes `1,2,1,2,1,2`.
- Shows unique item types, total copies, physical cards, and required A4 pages.
- Shows a simple fixed-slot A4 sheet preview with page navigation.
- Exports eight exact-size cards per A4 landscape page in a four-column by two-row grid.
- Draws optional thin crop marks outside card content; crop marks are enabled by default and no bleed is added.
- Saves PDFs to the vault-relative `Card Forge Exports` folder by default and creates collision-safe filenames such as `card-forge-2026-08-13-1305-2.pdf`.
- Can open the last generated PDF in Obsidian, with optional automatic opening after export.

## Print workflow

1. Open **TTRPG Card Forge** from the ribbon or command palette.
2. Select an item and inspect its canonical physical-card pages.
3. Choose **Add to print queue**. Adding the same item again increments its quantity.
4. Use `+`, `−`, move-up, move-down, and remove controls to prepare the queue.
5. Inspect the physical-card count and A4 sheet preview.
6. Choose **Export PDF**.
7. Open the generated PDF with **Open last PDF**.

A queue entry represents copies of an item, not a single rendered page. Every copy is fully emitted before the next copy begins, so continuation and Crafting cards remain adjacent to their primary card.

## Physical PDF layout

Each PDF page is exact A4 landscape (297 × 210 mm). Cards are placed row-major in fixed positions:

```text
1  2  3  4
5  6  7  8
```

Each card is drawn at exactly 63.5 × 88.9 mm. The grid uses 3 mm gaps, 17 mm left/right margins, and 14.6 mm top/bottom margins. A partial final sheet uses the same positions instead of being recentered.

Card DOM is rasterized locally to a lossless 750 × 1050 PNG, then embedded with `pdf-lib`. Duplicate copies reuse the same in-memory raster during one export. No raster cache is persisted between Obsidian sessions.

## Settings

- **Item folder** — vault-relative source folder; default `2. Mechanics/items`.
- **PDF export folder** — vault-relative output folder; default `Card Forge Exports`.
- **Show crop marks** — enabled by default.
- **Open PDF after export** — disabled by default.

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

The PDF pipeline uses the browser-compatible `html-to-image` and `pdf-lib` packages bundled into `main.js`. It does not use a CDN, remote service, system print dialog, private Electron API, or network request at export time.

## Local development deploy

Keep the source repository outside the vault. Copy `dev.config.example.json` to the ignored `dev.config.json`, set its `vaultPath`, and run:

```sh
npm run deploy
```

Deployment copies only `main.js`, `manifest.json`, and `styles.css` into:

```text
<vaultPath>/.obsidian/plugins/ttrpg-card-forge/
```

Generated PDFs are written through Obsidian's Vault API to the configured export folder. Source files under the configured item folder remain read-only.

## Manual or BRAT installation

Copy `main.js`, `manifest.json`, and `styles.css` from a matching release into `.obsidian/plugins/ttrpg-card-forge/`, reload Obsidian, and enable **TTRPG Card Forge** under **Settings → Community plugins**. BRAT users can add the repository URL as a beta plugin.

Release tags must exactly match `manifest.json` without a `v` prefix. The GitHub Actions release workflow runs tests, lint, and build before attaching the three release artifacts.

## Data and privacy

TTRPG Card Forge is local-first and offline. It does not include D&D rules text or artwork, call external APIs, upload vault content, add telemetry, or download game data. Source Markdown and artwork are read-only. The only vault write performed by Phase 3 is the PDF explicitly requested by the user in the configured export folder.

## Project layout

```text
src/
├── main.ts                    Plugin lifecycle, persisted settings, and queue state
├── models/                    Item, physical-card profile, page, and print-queue contracts
├── parsers/                   Pure frontmatter/body parsing and normalization
├── renderer/                  Semantic pagination, physical fitting, and card DOM rendering
├── services/                  Vault indexing, artwork resolution, and queue planning
├── export/                    Rasterization, A4 geometry, PDF assembly, and vault storage
├── views/card-forge-view.ts   Browser, canonical preview, queue, sheet preview, and export UX
└── settings.ts                Persisted settings and settings UI
```
