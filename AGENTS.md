# AGENTS.md

## Purpose

TTRPG Card Forge is an Obsidian desktop plugin that creates printable item cards from structured Markdown in a user's vault. Phase 1 indexes TTRPG CLI/5etools-style item frontmatter. Phase 2 owns normalized item content, semantic pagination, artwork handling, and card DOM rendering. Phase 3 owns the persistent print queue, deterministic physical-card planning, A4 sheet geometry, and local PDF export.

The plugin ID is permanently `ttrpg-card-forge`. Do not rename it. Phase 4B owns non-destructive print overrides, same-note variant resolution, manual card boundaries, session-only artwork, and optional managed artwork imports. Phase 4D owns Saved Print Set snapshots, current-item commands, queue duplication, and the lightweight vault Export Gallery.

Phase 6 owns bounded artwork framing inside planner-owned boxes, logical per-card back designs, deterministic front/back A4 side planning, and print-job-only duplex/calibration settings. Back designs remain part of `CardDesignProfile`; duplex mode, edge mapping, and X/Y calibration must not enter card content or physical pagination.

## Architecture

- `src/main.ts`: plugin lifecycle, commands, view registration, settings, and persisted queue and Saved Print Set state.
- `src/models/`: normalized items, semantic card pages, print-queue entries, Saved Print Sets, and the canonical physical profile.
- `src/parsers/`: pure parsing and normalization, independent of UI and export.
- `src/renderer/`: semantic pagination, fixed physical fit measurement, safe Markdown DOM, and reusable card rendering.
- `src/services/`: Obsidian integration, workflow helpers, and queue resolution/flattening. `item-index.ts` owns discovery; `artwork-resolver.ts` resolves local images; `export-gallery.ts` filters vault metadata only.
- `src/export/`: fixed A4 geometry, DOM-to-PNG rasterization, PDF assembly, and Vault API storage.
- `src/views/`: native Obsidian browser, scaled canonical preview, Queue/Saved Sets/Exports workflow panel, sheet preview, and export UX.
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

The Phase 4B effective-card flow is:

```text
indexed source ItemCardData (read-only)
→ same-note variant resolution
→ persisted CardOverrides
→ effective ItemCardData
→ deterministic override fingerprint / physical-plan cache key
→ canonical physical planner and Phase 3 export flow
```

The Phase 4D saved-session flow is:

```text
live PrintQueueEntry[]
→ canonical ID-free queue fingerprint
→ validated persisted active Saved Print Set association
→ Save / Save As preparation
→ available temporary artwork persisted once per save into Card Forge Assets
→ durable SavedPrintSetEntry[] and matching live queue artwork with Vault overrides
→ existing plugin-data persistence
```

Overrides belong to queue entries and plugin data, never source Markdown. `///CARD BREAK///` is an editor-only delimiter that becomes an explicit page boundary and must not appear in rendered rules. Variant discovery must remain structural and data-driven; do not add item-name condition trees. Editor code never owns physical pagination or card rendering; it supplies effective data to the canonical planner and renderer.

Editable fields use inheritance by absence: an absent field follows the current source/variant default, while a present field is an explicit print override. Variant changes must preserve explicit fields and refresh inherited fields. Temporary artwork stores only a lightweight runtime identifier in plugin data; Blob/ObjectURL bytes stay in memory, are owner-tracked, and are revoked when no draft or queue entry references them. Explicit Saved Set Save/Save As must persist currently available temporary artwork through the managed Vault API and promote matching live queue references to the resulting vault-relative override. Missing temporary artwork blocks a new Saved Set save. Persist only the active Saved Set ID; on load, validate the referenced set and derive clean/Modified state from canonical queue-versus-set snapshots.

PDF code must never own or reproduce item-content pagination. It consumes completed `ItemCardPage[]` from the canonical physical planner. The existing card renderer remains the visual source of truth; do not redraw card content with PDF primitives.

The Phase 6 export flow is:

```text
completed PhysicalQueueCard fronts
→ pure fixed-slot front/back sheet plan
→ front or bounded back DOM renderer
→ separate deterministic front/back raster identities
→ optional back-only X/Y PDF placement correction
→ existing exact A4 PDF assembly and Vault storage
```

Artwork framing may change pixels inside the fixed artwork box but must not change its planner-owned allocation. `None` backs remain blank occupied duplex positions, not removed cards. Single-sided back sheets are unmirrored; duplex backs use the documented landscape edge mapping. Seamless sheet backs and named calibration profiles are deferred.

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

The bounded density policy uses the existing 10 pt target and 7 pt absolute
print-safe body-text floor. Standard retains the enumerated 10–7 pt adaptive
steps. Compact is capped at 9 pt, uses the same 7 pt floor, and tightens only
bounded body/section/stat rhythm. Auto may resolve once per logical card to
Standard or Compact; it must never create an intermediate density or mix
densities across continuation/Crafting pages.

Centralize these values in the physical profile and A4 geometry modules. Do not scatter print magic numbers.

## Safety and data rules

- Treat all source vault files and artwork as read-only. Never modify anything under the configured item folder.
- Persistent artwork may be created only through the Vault API in the managed `Card Forge Assets` folder after explicit opt-in. Use collision-safe filenames and never overwrite an existing asset.
- Local-file and HTTPS choices are temporary by default. HTTPS artwork must be explicitly requested by the user, downloaded once into a session ObjectURL before planning, and never remain a render/export-time network dependency.
- Use Obsidian `Vault` and `MetadataCache` APIs for vault content.
- PDF output must use `Vault.createBinary` in the configured vault-relative export folder.
- Do not use Node filesystem APIs for vault content. Node filesystem access is permitted only in local development/build scripts such as deployment.
- Keep the plugin local-first and offline after import. The only network exception is a user-initiated HTTPS artwork import; do not add external game-data APIs, CDNs, telemetry, uploads, remote code, or export-time network dependencies.
- Do not include copyrighted D&D text, images, PDFs, or datasets in the repository.
- Store vault paths as vault-relative plugin settings. Never hard-code an absolute production path.
- The ignored `dev.config.json` is local tooling configuration and is the only expected location for an absolute development vault path.
- Hidden measurement/export DOM roots require `try/finally` cleanup. Do not persist raster caches.

## Commands

```sh
npm install       # install dependencies
npm run dev       # esbuild watch mode
npm test          # pure unit and PDF-structure tests
npm run test:design-matrix # exhaustive pure profiles + deterministic planner stress matrix
npm run lint      # ESLint plus Obsidian plugin rules
npm run build     # strict TypeScript check and production bundle
npm run deploy    # production build, then copy three release artifacts
```

Before handing off a design-system change, run tests, the design matrix, lint,
and build. For Phase 3 changes, also run `npm run deploy` when the configured
development vault exists and confirm only `main.js`, `manifest.json`, and
`styles.css` are copied. Compare the configured source-item folder before and
after work.

## Releases

Keep `manifest.json`, `package.json`, `package-lock.json`, and `versions.json` synchronized. GitHub release tags must exactly match the manifest version without a `v` prefix. Release assets are `main.js`, `manifest.json`, and `styles.css`.
