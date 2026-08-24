# Coldbrew Icon Guide

## Current implementation

- Application icons come from `lucide-react`.
- `apps/web/src/components/icons.tsx` imports Lucide as `import * as icons from "lucide-react"`; preserve this namespace import when editing the catalog.
- Feature code imports semantic names from `apps/web/src/components/icons.tsx`, for example `Icons.wallet` and `Icons.retry`.
- A small number of generic shadcn/Base UI primitives import a Lucide icon directly. Keep this exception limited to the primitive that owns the control (for example, a sheet close button or sidebar toggle).
- The product mark and browser favicon use the simplified raster artwork at `apps/web/assets/logo.png`. It is not a replacement for Lucide UI icons.

## Choosing and importing icons

- In routes and product components, add a semantic entry to `Icons` and use it rather than importing from `lucide-react` directly. This makes the visual vocabulary searchable and lets us change an icon in one place.
- In the `Icons` catalog, reference glyphs through the `icons` namespace rather than adding individual named imports.
- Name entries for their product meaning, not their glyph: use `retry`, `donations`, or `notWatched`, rather than `rotateCcw`, `sparkles`, or `circle`.
- Keep separate semantic aliases when one glyph has different meanings, such as `checked`, `copied`, and `submit`. They may share a Lucide implementation today but can diverge without a broad refactor.
- Prefer an established semantic icon before adding another glyph. Add a new entry only when it makes the action, object, or state clearer.
- Do not introduce a second icon library, inline SVG UI icons, or emoji as an icon substitute. Exceptions are third-party service logos, the Coldbrew brand asset, and the decorative coffee-cosmic illustrations documented below.

## Size, layout, and appearance

- Let the existing `Button` sizes set an inline icon's default size. Do not add a `size` prop unless the icon deliberately differs from that control's scale.
- Use `15px` for compact field affordances and tabs, `16px` for ordinary inline controls and navigation, `18px` for small standalone actions, and `20px` for empty-state or feature icons. The current UI follows these sizes.
- For icon-only actions, use the existing `Button` `icon-*` sizes or an equivalently sized, focusable control. Never make the SVG itself the click target.
- Icons inherit `currentColor`; apply semantic text utilities to the surrounding control whenever possible. Use status colors only to communicate status, and preserve third-party brand colors where meaningful.
- Keep the default Lucide stroke style. Do not mix filled, heavy, or multi-colour variants into routine interface controls. A stateful exception is acceptable when it communicates state, such as the filled saved bookmark.
- Use `gap` in the parent for icon-and-label spacing. Do not use margins or absolute positioning unless the icon is an intentional field decoration, such as search or select chevrons.

## Accessibility and interaction

- Mark icons `aria-hidden="true"` when adjacent visible text, a control name, or an accessible label already conveys their meaning. This is the normal case in the current app.
- Every icon-only interactive control needs an accessible name, normally `aria-label`. Add a tooltip when the action may not be immediately familiar; a tooltip never replaces the accessible name.
- Use an icon as a visual status cue alongside text or another programmatic state. Do not use icon shape or colour as the only way to convey success, warning, failure, or selection.
- Loading icons should be decorative and paired with an accessible loading or busy state on the relevant region/control.
- Preserve the parent control's hover, disabled, active, and `focus-visible` styles. An icon must not suppress keyboard focus or pointer events intended for its control.

## Brand assets and decorative illustrations

- Use `apps/web/assets/logo.png` for both the Coldbrew identity and browser favicon.
- Keep the mark visually centred in its circular background. Use 36–40px in compact navigation lockups and 48px in the sign-in hero, as specified in the [UI style guide](ui-style-guide.md#brand-assets).
- Decorative line-art scenes live in `apps/web/src/components/cosmic-art.tsx`. They may draw cups, orbital queues, beans, and stars, but they do not communicate an action or replace a Lucide glyph.
- Always mark decorative illustrations `aria-hidden="true"`, remove them from pointer interaction, and keep essential copy outside the SVG.
- Reuse the established motifs and six brand colours from the [UI style guide](ui-style-guide.md) instead of inventing a separate mini-style per route.
- Routine UI actions continue to use semantic UI colours and Lucide icons.

## Review checklist

- Is the icon imported through `Icons` unless it belongs to a reusable UI primitive?
- Does its semantic name describe the product meaning?
- Is its size consistent with its context and the Button size?
- Is it decorative for assistive technology, or does the icon-only control have a clear accessible name?
- Does the icon retain semantic colour, visible focus, and a text/programmatic status equivalent where needed?
