# TTRPG Card Forge backlog

These ideas are intentionally outside the Phase 4B / 0.4.0 release scope.

## Source Note tab

Consider a read-only `Preview | Edit card | Source note` toggle inside Card Forge. The Source Note view would provide a fast CLI-first validation aid for comparing the generated card with its original Markdown without introducing any source mutation. The existing **Open source note** action should remain available for normal Obsidian navigation.

## Dedicated bullet-marker troubleshooting

Run a separate evidence-driven troubleshooting session for the physical-card bullet marker. Inspect computed styles, the actual pseudo-element and glyph metrics, line height, parent positioning, font rendering, and screenshot/manual results before changing further CSS constants. Bullet appearance is not a 0.4.0 release blocker.

## Inherited base Cost visibility

Consider bounded field-visibility customization for magic variants that inherit base-equipment structured data. A future default could keep Damage, Properties, Mastery, Range, and Weight visible while allowing inherited base Cost to be hidden. Do not change current Cost extraction or display behavior for 0.4.0.

## Configurable Card Forge Assets folder

Persistent imported artwork is currently stored in `Card Forge Assets` at the vault root. Add a setting similar to the PDF export folder so the user can choose a vault-relative folder, while keeping `Card Forge Assets` as a possible default. Plan migration and backward compatibility carefully so existing saved artwork paths never break silently.

## Artwork persistence choice before import

Move the **Save to vault** choice before the temporary local-file selection or HTTPS fetch so it applies to that import action. Currently the artwork is already temporary when the choice appears, requiring the user to select or load it again to persist it. Optionally investigate a secondary **Save current artwork to vault** action for artwork that is already loaded temporarily. Do not redesign this behavior for 0.4.0.

## Navigation

### Open current item in Card Forge command

Add a future command-palette action available while viewing an item Markdown note: **TTRPG Card Forge: Open current item in Card Forge**. It should detect the active Markdown file, verify or resolve that it is an indexed Card Forge item, open or focus Card Forge, select that exact item, and show its canonical Preview immediately. A note that is not a recognized item should produce a small Notice instead of failing.

This would provide a fast transition from ordinary vault browsing into the print workflow, especially alongside the future Source Note tab, Export Gallery, and batch/print workflow improvements. A later companion command could be **TTRPG Card Forge: Add current item to print queue**. Do not implement either command as part of the 0.4.1 bullet-marker patch.
