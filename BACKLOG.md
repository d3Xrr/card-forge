# TTRPG Card Forge backlog

This file tracks completed workflow milestones and intentionally deferred work.

## Implemented in Phase 4C core

- Multi-select item browser with path-based batch selection.
- Indexed-metadata search and Type, Rarity, Source, and Attunement filters.
- Deterministic **Add selected** queue workflow with one queue notification/persistence cycle.
- Read-only `Preview | Edit card | Source note` navigation using the current vault file.
- Context-aware actions that remove duplicate Preview actions while Edit or Source note is active.
- Configurable vault-relative **Card Forge Assets folder** for future persistent artwork imports; existing explicit artwork paths remain unchanged.
- Theme-compatible native browser filters, centered Edit preview region, and per-source session scroll memory for Source Note.

## Implemented in Phase 4D

- Persistent Saved Print Sets with snapshot-based save, rename, delete, and confirmed queue replacement.
- Export Gallery for canonical Card Forge PDFs in the configured vault export folder, with Open and recoverable Delete actions.
- **Open current item in Card Forge** and **Add current item to print queue** command-palette workflows.
- Queue-entry **Duplicate** convenience with fresh IDs and independent print overrides.
- Compact right-side **Print queue | Saved sets | Exports** workflow navigation.
- True mutually exclusive Workflow views with queue-only A4/PDF controls.
- Session-local active Saved Set state with canonical dirty detection and contextual **Save | Save as…** actions.
- Durable Saved Set artwork preparation that persists available temporary artwork into the configured Card Forge Assets folder.
- Compact accessible Lucide actions for queue-entry Duplicate, Edit, and Remove.

## Future Phase 4C follow-ups

- Favorites.
- Recently used items.
- Optional per-row Add action in the item browser.
- Saved Print Set append/merge behavior.
- Richer Export Gallery metadata or thumbnails.
- Further Preview/Source navigation decisions after manual workflow testing.

### Preview navigation / pagination layout revisit

Pagination currently remains in a stable shared location when switching between Preview and Edit card, but after Edit preview centering the controls can appear optically detached from the centered card. Revisit placement after the Card Preview toolbar and surrounding controls mature. Evaluate centered top navigation, card-relative navigation, bottom navigation, or another shared toolbar layout while preserving a stable control position across Preview and Edit whenever practical. Do not change pagination layout before 0.5.0.

### Idle resource footprint audit

Measure Card Forge resource use while the plugin is enabled and its view is not open. Audit idle CPU activity, retained memory, metadata-cache and index memory, registered event listeners, timers or intervals, queue persistence activity, planner and cache lifetime, artwork resources and Object URLs, and A4, PDF, or raster resources. With no Card Forge view open, there should be no periodic background CPU work, card planning, artwork processing, PDF or A4 materialization, or DOM work—only lightweight data and listeners required for plugin functionality. Measure first in a future performance pass; do not optimize speculatively.

## Longer-term deferred work

- Customization presets.
- A printer-friendly style preset.
- Duplex printing and card backs.
- Generic Markdown input and parser work.
- A manual custom-card creator.
- Additional card types, including spells, feats, conditions, and monster or NPC cards.
- GitHub Actions Node-runtime maintenance after the 0.5.0 release; do not update action dependencies solely to silence a non-blocking runtime warning.

## Dedicated bullet-marker troubleshooting

Run a separate evidence-driven troubleshooting session for the physical-card bullet marker. Inspect computed styles, the actual pseudo-element and glyph metrics, line height, parent positioning, font rendering, and screenshot/manual results before changing further CSS constants. Bullet appearance is not a 0.4.0 release blocker.

## Inherited base Cost visibility

Consider bounded field-visibility customization for magic variants that inherit base-equipment structured data. A future default could keep Damage, Properties, Mastery, Range, and Weight visible while allowing inherited base Cost to be hidden. Do not change current Cost extraction or display behavior for 0.4.0.

## Artwork persistence choice before import

Move the **Save to vault** choice before the temporary local-file selection or HTTPS fetch so it applies to that import action. Currently the artwork is already temporary when the choice appears, requiring the user to select or load it again to persist it. Optionally investigate a secondary **Save current artwork to vault** action for artwork that is already loaded temporarily. Do not redesign this behavior for 0.4.0.

## Activation profiling follow-up

Warm ribbon activation already follows a render-free path that only reveals the existing Obsidian leaf; it does not rebuild the index, browser, preview, queue, or A4 sheets. The optional performance debug API now records cold initialization and leaf-reveal stages separately. If the small host-level reveal/repaint delay remains noticeable, capture an interactive Obsidian performance profile before considering browser virtualization or another architectural change.
