# TTRPG Card Forge

TTRPG Card Forge is a desktop Obsidian plugin for creating printable TTRPG cards from structured Markdown already stored in your vault. The project is starting with TTRPG CLI/5etools-style magic item notes and is designed to grow into spell, feat, monster, and other card types.

Phase 2 adds a live, responsive item-card preview while continuing to stop before PDF generation or print queues. The plugin now turns indexed TTRPG CLI item notes into normalized rules text, resolves local artwork, and renders an isolated poker-proportion card inside Obsidian.

## Current features

- Indexes Markdown files only within a configurable vault-relative item folder.
- Identifies TTRPG CLI items by the `json5e-item` CSS class in YAML frontmatter.
- Reads item metadata through Obsidian's metadata cache without modifying source notes.
- Normalizes name, detail, image path, damage, properties, mastery, weight, tags, rarity, source, and attunement.
- Continues indexing when an individual note is malformed and logs a useful console warning.
- Provides a ribbon button and the `TTRPG Card Forge: Open Card Forge` command.
- Displays a searchable item browser with name, detail, rarity, source, and attunement status.
- Rebuilds automatically after relevant vault metadata changes and manually from settings.
- Extracts rules prose while removing CLI headings, summary metadata, image embeds, and source footers.
- Preserves paragraphs, emphasis, inline dice/code, and legitimate ordered or unordered rules lists.
- Resolves local raster artwork through Obsidian's vault resource-path APIs.
- Renders IMAGE, COMPACT, or TEXT card layouts using an adaptive, centralized heuristic.
- Provides a responsive master-detail browser with selection, live card preview, diagnostics, and a separate source-note action.
- Keeps all browser and card styling isolated under plugin-specific namespaces.

The default item folder is `2. Mechanics/items`. The setting is vault-relative; no absolute production vault path is stored in plugin code or settings defaults.

## Development

Requirements:

- Node.js 18.18 or newer
- npm
- An Obsidian desktop vault containing your own structured item notes

Install dependencies and run the watch build:

```sh
npm install
npm run dev
```

Useful checks:

```sh
npm test
npm run lint
npm run build
```

The production build writes `main.js` at the repository root. Obsidian loads `main.js`, `manifest.json`, and `styles.css` from the installed plugin directory.

## Local development deploy

The source repository should remain outside your vault. Copy the example configuration:

```sh
cp dev.config.example.json dev.config.json
```

Set `vaultPath` in the ignored `dev.config.json` to the absolute path of your development vault, then run:

```sh
npm run deploy
```

This command builds the plugin and copies only `main.js`, `manifest.json`, and `styles.css` to:

```text
<vaultPath>/.obsidian/plugins/ttrpg-card-forge/
```

## Manual or BRAT installation

For a manual installation, copy the three release artifacts into `.obsidian/plugins/ttrpg-card-forge/`, reload Obsidian, and enable **TTRPG Card Forge** under **Settings → Community plugins**.

After this repository has a public GitHub URL and a release, BRAT users can add that repository URL as a beta plugin. Release tags must exactly match the version in `manifest.json` without a `v` prefix. Each release must attach:

- `main.js`
- `manifest.json`
- `styles.css`

The included GitHub Actions workflow performs the checks, build, tag validation, and release creation when an exact-version tag is pushed.

## Data and privacy

TTRPG Card Forge does not include D&D rules text, art, or other copyrighted game content. It reads user-provided local Markdown files and metadata already present in the Obsidian vault. It does not call external services or download game data.

Source Markdown is treated as read-only. Phase 1 does not generate, edit, or delete vault files.

## Project layout

```text
src/
├── main.ts                    Plugin lifecycle and Obsidian integration
├── models/item.ts             Normalized item data contract
├── parsers/                   Pure frontmatter/body parsing and normalization
├── renderer/                  Layout selection, safe Markdown DOM, and card renderer
├── services/                  Vault indexing and artwork resolution
├── views/card-forge-view.ts   Master-detail browser and live preview
└── settings.ts                Persisted settings and settings UI
```

PDF generation and print-queue behavior remain intentionally out of scope.
