---
name: coldbrew-icons
description: "Choose and implement Coldbrew UI icons when editing routes, product components, or the shared icon catalog."
---

# Coldbrew icons

Use this skill for Coldbrew product-interface icons. Application icons use `lucide-react`; do not add another icon library, inline SVG UI icons, or emoji. The Coldbrew mark and documented decorative artwork are exceptions, not replacements for UI icons.

## Catalog and meaning

- Product code and routes import semantic icons from `apps/web/src/components/icons.tsx`, such as `Icons.wallet` or `Icons.retry`. Add an entry there instead of importing from `lucide-react` directly.
- Keep the catalog namespace import, `import * as icons from "lucide-react"`, and refer to glyphs through `icons`.
- Name entries for product meaning (`retry`, `donations`, `notWatched`), not their current glyph. Keep separate semantic aliases even when they currently point to the same glyph.
- Reuse an established semantic icon before adding a new glyph. Direct Lucide imports are only appropriate within the reusable shadcn/Base UI primitive that owns a generic control.

## Layout and appearance

- Let the current `Button` size control inline icon size unless intentionally different. Use 15px in compact fields/tabs, 16px in ordinary inline controls/navigation, 18px for small standalone actions, and 20px for empty-state or feature icons.
- Make icon-only actions existing `Button` `icon-*` controls or equivalent focusable controls; the SVG itself is never the click target.
- Icons inherit `currentColor`; set a semantic text colour on the parent. Retain default Lucide strokes and use state/brand colour only where it communicates meaning.
- Use a parent `gap` for icon-label spacing. Avoid icon margins or absolute positioning except deliberate field decorations.

## Accessibility

- Set `aria-hidden="true"` when visible text, the control name, or an accessible label already communicates the icon's meaning.
- Every icon-only interactive control needs an accessible name, normally `aria-label`; add a tooltip when the action may be unfamiliar, but it never replaces that name.
- Do not communicate status or selection with icon shape or colour alone. Loading icons are decorative and accompany an accessible loading/busy state.
- Preserve the parent control's hover, disabled, active, and `focus-visible` states.

## Brand and decorative assets

- Use `apps/web/assets/logo.png` for the Coldbrew identity and favicon; use 36–40px in compact navigation and 48px in the sign-in hero.
- `apps/web/src/components/cosmic-art.tsx` contains decorative coffee-cosmic line art. Mark it `aria-hidden="true"`, disable pointer interaction, and keep essential copy outside the SVG.
- Reuse its established motifs and the six brand colours from `docs/ui-style-guide.md`; routine actions remain Lucide icons in semantic UI colours.
