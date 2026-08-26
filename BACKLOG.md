# TTRPG Card Forge backlog

This file tracks completed workflow milestones and intentionally deferred work.

## Implemented for 0.8.0 development

- Added reusable bounded artwork framing for front and artwork-based back designs: Fit/Fill, 1–3× zoom, ±100 position controls, and side-specific reset. Framing clips inside the planner-owned box, affects raster identity only, and never changes physical-card geometry or content pagination.
- Added back design snapshots with **None**, **Generic**, **Rarity**, **Item Type**, **Artwork**, and vault-relative **Custom Image** styles. Back theme inherits the front theme. The same logical back applies to primary, continuation, and Crafting pages.
- Preserved back/framing state through source drafts, queue adds, batch/current-item adds, queue Save/Discard, Duplicate deep copies, restart migration, Saved Set canonical dirty state, Save/Load, A4 preview, and PDF export. Pre-0.8 data migrates to default framing with **None** back.
- Added explicit **Front | Back** preview and a bounded side selector inside the existing Design mode; no new application mode or freeform card-layout surface was introduced.
- Added persisted print-job settings for single-sided, manual-duplex, and automatic-duplex output; no backs/use card backs; landscape long-edge/short-edge mapping; and bounded ±10 mm back registration offsets.
- Added a pure duplex sheet planner. Single-sided backs are forward and unmirrored; automatic backs are interleaved; manual backs follow all fronts in reverse source-sheet order. Duplex slots mirror rows for long-edge or columns for short-edge output, preserve partial-sheet positions, and retain **None** backs as intentional blank alignment slots.
- Added separate front/back raster identities and reused completed front physical pages. Back-side calibration changes PDF placement only; it does not replan content, alter crop positions, or change canonical 63.5 × 88.9 mm / 750 × 1050 px cards.
- Extended pure tests and the deterministic design matrix across framing bounds, back styles, legacy migration, queue/Saved Set persistence, continuation behavior, duplex ordering, partial sheets, calibration, PDF structure, UI controls, and responsive rules.

### Intentionally deferred beyond 0.8.0

- Seamless sheet artwork belongs to a future print-job override rather than per-card design.
- Named printer/copyshop calibration profiles may build on the persisted current X/Y/edge settings after real printer testing.
- Interactive drag-to-frame handles remain deferred; the conservative sliders are the supported bounded control surface.

## Implemented for 0.7.0 development

- Added an explicit bounded `CardDesignProfile` that keeps theme, artwork allocation, density, and optional known-field visibility separate from source content and print overrides.
- Added the peer `Preview | Edit card | Design | Source note` workflow with one live canonical preview; source drafts retain design across tabs and queue-entry Save/Discard operates atomically on content plus design.
- Added global defaults for Dark/Light/Printer Friendly, Standard/Larger/Minimal/Hidden artwork, and Standard/Compact density. Defaults affect source previews and future adds only; queue and Saved Set entries snapshot resolved design.
- Preserved missing pre-0.7.0 design data as the stable Dark/Standard/Standard/automatic legacy profile, independent of later global-default changes.
- Added scoped physical-card theme tokens. Dark retains the 0.6.1 appearance, Light uses a readable light surface, and Printer Friendly uses white, low-ink surfaces with grayscale-readable hierarchy.
- Added planner-owned artwork allocations: Larger uses 56% image, 42% portrait, or 36% compact allocation; Minimal uses 16% image/compact or the safe 28% portrait column; Hidden retains the artwork selection while removing it from layout.
- Added bounded visibility overrides for Damage, Two-handed damage, Properties, Mastery, Range, Weight, Cost, and Source. Semantic automatic provenance remains authoritative, including inherited Cost hidden until explicitly force-shown.
- Strengthened Compact into a visibly distinct, measured density preset capped at 9 pt with tighter bounded rhythm and the shared 7 pt print-safe floor. Added explicit Auto density, which deterministically selects Compact only when it safely reduces physical pages and resolves once per logical card. Completed the monotonic typography invariant: for equivalent inputs, Compact is capped at the resolved Standard body size and is revalidated through normal Compact fitting.
- Stabilized compact structured-stat packing around the actual visible row set. Short rows pair in the two-column grid, unpaired or wide rows become full-width, portrait rows stack, and hidden fields consume no planned space. Completed width-safe packing by measuring candidate cells in the canonical physical layout and storing the resulting pair/full representation in the plan consumed by the renderer.
- Made Larger artwork a strong planner preference: safe continuation pages now take priority over artwork omission, while genuine non-splittable/measurement failures retain the hard printable-layout fallback and a clear diagnostic.
- Added delayed, accessible **Updating card layout…** feedback for non-trivial replanning while retaining the previous valid preview and existing stale-result gates.
- Added an exhaustive pure design-profile matrix and a deterministic ten-fixture planner stress matrix covering density, artwork, field masks, themes, continuation, Crafting, tables, and manual breaks.
- Split design identity into layout and visual fingerprints: artwork, fields, and density replan; theme-only changes reuse physical pages and rerasterize.
- Persisted independent design snapshots through queue add, batch add, current-item commands, Duplicate, restart, active Saved Set dirty comparison, Saved Set Save/Load, mixed A4 preview, and PDF export.
- Kept the existing missing temporary-artwork export block even when artwork presentation is Hidden; changing that lifecycle rule remains outside this presentation phase.

## Implemented in 0.6.1 stabilization

- Added bounded source/base/override provenance for structured card fields and included it in physical-plan identities.
- Kept inherited base-equipment statistics available to Edit card while suppressing only inherited Cost on physical cards; source and explicit Cost still render.
- Separated indexed base resolution from safe family-wrapper selector labels, completing concise labels for Armor of Cold Resistance, +1 Yklwa, and indexed or unindexed Monster Hunter's Weapon variants without item-name condition trees.
- Kept selected variant/base equipment rows in normal item content when a family Crafting section precedes the variant marker; actual recipe components remain on Crafting pages.
- Preserved qualified attunement text for Retribution, Holy Avenger, Inexhaustible Armor, and other generic sources.
- Normalized Obsidian callouts in card rules, including the real inline Multiweapon shape, without changing Source Note rendering or source Markdown.
- Defined exact case-insensitive `Unknown` rarity as a non-printing physical-card sentinel while retaining values such as `Unknowns`.
- Added subtle inline queue-title provenance only for meaningful explicit title edits, plus a compact physical-card/A4 summary with detailed counts retained as a tooltip; ordinary variant selection remains uncluttered.
- Reflowed the outer workspace before its three columns can squeeze the preview, and made the locally responsive Edit card stack with a flow-reserving scaled-card viewport at narrow notebook/split-pane widths while preserving canonical physical geometry.

## Release roadmap

- **0.6.1 — Stabilization / parser hygiene / responsive workspace.**
- **0.7.0 — Card Presentation / Design System.** Intended scope: a Design tab; Dark, Light, and Printer Friendly presets; Standard, Larger, Minimal, and Hidden artwork sizing; bounded field visibility; and safe information-density presets. This work must avoid arbitrary CSS customization and preserve planner/fitting guarantees.
- **0.8.0 — Duplex / card backs / bounded artwork framing and printer calibration.**
- **0.9.x — Print and workflow quality-of-life.**

Post-0.9 work may include the final responsive workspace polish after the print workflow is stable.

Potential **1.0** remains the stable complete CLI item-to-physical-card workflow with finalized front/back design and printing. Generic platform work may remain post-1.0.

The 0.9.x items remain roadmap documentation and are not part of the 0.8.0 development build.

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
- Restart-safe active Saved Set association with canonical dirty detection and contextual **Save | Save as…** actions.
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

### Persistent / warm Saved Set plan cache investigation

Measure the actual cost of re-planning a Saved Print Set after Obsidian restart. Any future persistent or warm plan reuse must have robust invalidation covering the renderer/planner schema version, effective-card fingerprint, source revision/content, artwork revision, layout-affecting settings, and physical profile. Saved Set semantic snapshots remain authoritative; do not persist physical planner output without that evidence and versioning.

### Idle resource footprint audit

Measure Card Forge resource use while the plugin is enabled and its view is not open. Audit idle CPU activity, retained memory, metadata-cache and index memory, registered event listeners, timers or intervals, queue persistence activity, planner and cache lifetime, artwork resources and Object URLs, and A4, PDF, or raster resources. With no Card Forge view open, there should be no periodic background CPU work, card planning, artwork processing, PDF or A4 materialization, or DOM work—only lightweight data and listeners required for plugin functionality. Measure first in a future performance pass; do not optimize speculatively.

## Longer-term deferred work

- Additional bounded presentation presets only after real physical-card testing.
- Seamless sheet backs and advanced named printer/copyshop calibration profiles.
- Final responsive workspace polish after 0.9; preserve the accepted 0.6.1 responsive architecture until then.
- Generic Markdown input and parser work.
- A manual custom-card creator.
- Additional card types, including spells, feats, conditions, and monster or NPC cards.
- GitHub Actions Node-runtime maintenance after the 0.5.0 release; do not update action dependencies solely to silence a non-blocking runtime warning.

## Dedicated bullet-marker troubleshooting

Run a separate evidence-driven troubleshooting session for the physical-card bullet marker. Inspect computed styles, the actual pseudo-element and glyph metrics, line height, parent positioning, font rendering, and screenshot/manual results before changing further CSS constants. Bullet appearance is not a 0.4.0 release blocker.

## Artwork persistence choice before import

Move the **Save to vault** choice before the temporary local-file selection or HTTPS fetch so it applies to that import action. Currently the artwork is already temporary when the choice appears, requiring the user to select or load it again to persist it. Optionally investigate a secondary **Save current artwork to vault** action for artwork that is already loaded temporarily. Do not redesign this behavior for 0.4.0.

## Activation profiling follow-up

Warm ribbon activation already follows a render-free path that only reveals the existing Obsidian leaf; it does not rebuild the index, browser, preview, queue, or A4 sheets. The optional performance debug API now records cold initialization and leaf-reveal stages separately. If the small host-level reveal/repaint delay remains noticeable, capture an interactive Obsidian performance profile before considering browser virtualization or another architectural change.
