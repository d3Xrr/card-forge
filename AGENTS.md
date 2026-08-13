# AGENTS.md

## Purpose

TTRPG Card Forge is an Obsidian desktop plugin that creates printable item cards from structured Markdown in a user's vault. Phase 1 indexes TTRPG CLI/5etools-style item frontmatter. Phase 2 owns normalized item content, semantic pagination, artwork handling, and card DOM rendering. Phase 3 owns the persistent print queue, deterministic physical-card planning, A4 sheet geometry, and local PDF export.

The plugin ID is permanently `ttrpg-card-forge`. Do not rename it.

## Architecture

- `src/main.ts`: plugin lifecycle, commands, view registration, settings, and persisted queue state.
- `src/models/`: normalized items, semantic card pages, print-queue entries, and the canonical physical profile.
- `src/parsers/`: pure parsing and normalization, independent of UI and export.
- `src/renderer/`: semantic pagination, fixed physical fit measurement, safe Markdown DOM, and reusable card rendering.
- `src/services/`: Obsidian integration and queue resolution/flattening. `item-index.ts` owns discovery; `artwork-resolver.ts` resolves local images.
- `src/export/`: fixed A4 geometry, DOM-to-PNG rasterization, PDF assembly, and Vault API storage.
- `src/views/`: native Obsidian browser, scaled canonical preview, print queue, sheet preview, and export UX.
- `src/settings.ts`: persisted plugin settings and settings UI.
- `tests/`: pure parser, renderer-helper, queue, geometry, and PDF-structure tests.
- `scripts/deploy.mjs`: local filesystem access used only to copy release artifacts into a development vault.

The Phase 3 flow is:

```text
ItemCardData
→ canonical physical planner (750 × 1050 measurement)
→ ItemCardPage[]
→ PrintQueue
→ ordered physical-page flattening
→ fixed 4 × 2 A4 landscape slots
→ existing card DOM renderer
→ 750 × 1050 PNG rasterizer
→ PDF exporter
→ Obsidian Vault API storage
```

PDF code must never own or reproduce item-content pagination. It consumes completed `ItemCardPage[]` from the canonical physical planner. The existing card renderer remains the visual source of truth; do not redraw card content with PDF primitives.

## Physical print invariants

- Card size: exactly 63.5 × 88.9 mm (2.5 × 3.5 inches, 5:7).
- Canonical raster: exactly 750 × 1050 px at 300 DPI.
- Sheet: A4 landscape, exactly 297 × 210 mm.
- Grid: four columns by two rows, eight cards per sheet, row-major order.
- Gap: 3 mm. Margins: 17 mm horizontal and 14.6 mm vertical.
- Partial final sheets retain fixed slot positions.
- Queue flattening preserves queue order, copy order, then page order. Never group continuation pages across copies.
- Preview and export must use canonical physical page planning, never visible pane dimensions.
- Crop marks remain outside the exact card rectangles. Phase 3 has no bleed.

Centralize these values in the physical profile and A4 geometry modules. Do not scatter print magic numbers.

## Safety and data rules

- Treat all source vault files and artwork as read-only. Never modify anything under the configured item folder.
- Use Obsidian `Vault` and `MetadataCache` APIs for vault content.
- PDF output must use `Vault.createBinary` in the configured vault-relative export folder.
- Do not use Node filesystem APIs for vault content. Node filesystem access is permitted only in local development/build scripts such as deployment.
- Keep the plugin local-first and offline. Do not add external APIs, CDNs, telemetry, uploads, remote code, or export-time network dependencies.
- Do not include copyrighted D&D text, images, PDFs, or datasets in the repository.
- Store vault paths as vault-relative plugin settings. Never hard-code an absolute production path.
- The ignored `dev.config.json` is local tooling configuration and is the only expected location for an absolute development vault path.
- Hidden measurement/export DOM roots require `try/finally` cleanup. Do not persist raster caches.

## Commands

```sh
npm install       # install dependencies
npm run dev       # esbuild watch mode
npm test          # pure unit and PDF-structure tests
npm run lint      # ESLint plus Obsidian plugin rules
npm run build     # strict TypeScript check and production bundle
npm run deploy    # production build, then copy three release artifacts
```

Before handing off a change, run tests, lint, and build. For Phase 3 changes, also run `npm run deploy` when the configured development vault exists and confirm only `main.js`, `manifest.json`, and `styles.css` are copied. Compare the configured source-item folder before and after work.

## Releases

Keep `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` synchronized. GitHub release tags must exactly match the manifest version without a `v` prefix. Release assets are `main.js`, `manifest.json`, and `styles.css`.
