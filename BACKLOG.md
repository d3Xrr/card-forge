# TTRPG Card Forge backlog

These ideas are intentionally outside the Phase 4B / 0.4.0 release scope.

## Source Note tab

Consider a read-only `Preview | Edit card | Source note` toggle inside Card Forge. The Source Note view would provide a fast CLI-first validation aid for comparing the generated card with its original Markdown without introducing any source mutation. The existing **Open source note** action should remain available for normal Obsidian navigation.

## Dedicated bullet-marker troubleshooting

Run a separate evidence-driven troubleshooting session for the physical-card bullet marker. Inspect computed styles, the actual pseudo-element and glyph metrics, line height, parent positioning, font rendering, and screenshot/manual results before changing further CSS constants. Bullet appearance is not a 0.4.0 release blocker.

## Inherited base Cost visibility

Consider bounded field-visibility customization for magic variants that inherit base-equipment structured data. A future default could keep Damage, Properties, Mastery, Range, and Weight visible while allowing inherited base Cost to be hidden. Do not change current Cost extraction or display behavior for 0.4.0.
