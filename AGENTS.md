# AGENTS.md

## Purpose

TTRPG Card Forge is an Obsidian desktop plugin that will generate printable TTRPG cards from structured Markdown in a user's vault. Phase 1 indexes TTRPG CLI/5etools-style item frontmatter. Phase 2 parses item rules text, resolves local artwork, and renders a live item-card preview. PDF generation remains future work.

The plugin ID is permanently `ttrpg-card-forge`. Do not rename it.

## Architecture

- `src/main.ts`: plugin lifecycle, commands, ribbon action, view registration, and event wiring.
- `src/models/`: normalized domain models shared by parsers, services, and future renderers.
- `src/parsers/`: pure parsing and normalization. Keep these modules independent of UI and rendering.
- `src/renderer/`: adaptive layout selection, safe Markdown-to-DOM rendering, and reusable item-card rendering. Renderers consume normalized models only.
- `src/services/`: Obsidian vault and metadata-cache integration. `item-index.ts` owns item discovery; `artwork-resolver.ts` resolves local images.
- `src/views/`: native Obsidian UI. Views consume normalized models; they do not parse frontmatter.
- `src/settings.ts`: persisted plugin settings and settings UI.
- `tests/`: unit tests for pure parser and helper behavior.
- `scripts/deploy.mjs`: local filesystem access used only to copy release artifacts to a development vault.

Keep parsers separate from future card renderers. A parser converts source metadata to a stable internal model; a renderer must consume that model and must not reach back into vault frontmatter.

## Safety and data rules

- Treat all source vault files as read-only. Never modify anything under the configured item folder.
- Use Obsidian `Vault` and `MetadataCache` APIs for vault content. Do not use Node filesystem APIs for vault content.
- Node filesystem access is permitted only in local development/build scripts such as deployment.
- Keep the plugin local-first and offline. Do not add external APIs, telemetry, data downloads, or remote code.
- Do not include copyrighted D&D text, images, or datasets in this repository.
- Store vault paths as vault-relative plugin settings. Never hard-code an absolute production path.
- The ignored `dev.config.json` is local tooling configuration and is the only expected location for an absolute development vault path.

## Commands

```sh
npm install       # install dependencies
npm run dev       # esbuild watch mode
npm test          # pure parser/helper unit tests
npm run lint      # ESLint plus Obsidian plugin rules
npm run build     # strict TypeScript check and production bundle
npm run deploy    # production build, then copy three release artifacts
```

Before handing off a change, run tests, lint, and build. When deployment behavior changes and the configured development vault exists, also run `npm run deploy` and confirm only `main.js`, `manifest.json`, and `styles.css` are copied.

## Releases

Keep `manifest.json`, `package.json`, and `versions.json` synchronized. GitHub release tags must exactly match the manifest version without a `v` prefix. Release assets are `main.js`, `manifest.json`, and `styles.css`.
