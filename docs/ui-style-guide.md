# Coldbrew UI Style Guide

Coldbrew is a streamer tool set in a bright coffee-cosmic world. Its story is “a long brew for bright moments”: donations and videos arrive as signals, wait in an orbital queue, and become quick reactions on stream. The visual identity makes that story memorable while working surfaces remain compact, legible, and predictable.

## Design direction

- Keep the product structure dense, familiar, and data-oriented. The themed shell must clarify hierarchy rather than compete with stream data.
- Use the coffee galaxy most strongly in entry scenes, page headers, the dashboard hero, public sharing, and focused calls to action.
- Treat the cup portal and Milky Way queue as one coherent signature. Avoid unrelated space decoration.
- Use childlike line drawings with confident, slightly imperfect curves. Decorative illustrations never replace controls, status text, or data.
- Keep long lists and form interiors clean. A small orbit marker or coloured edge is enough to connect them to the brand world.

## Color system

The six brand colours are:

- Milky Paper `#FFF8ED`: the light-theme atmosphere and light ink on dark brand scenes.
- Espresso Void `#251820`: the dark coffee-space base and primary light-theme text.
- Galactic Blue `#4056E8`: primary actions, links, selection, and the main chart route.
- Comet Coral `#FF647C`: emotional highlights, incoming signals, and selected decorative details.
- Solar Mango `#FFBD3E`: warm stars, sidebar identity, and high-energy accents.
- Mint Signal `#54CFA5`: connection, successful movement, and supporting chart data.

Treat the semantic variables in `apps/web/styles.css` as the source of truth. Prefer utilities such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-secondary`, `text-primary`, and `ring-ring`. Named brand colours may be hardcoded only in deliberate illustrations or one-off brand scenes where their identity matters.

Both themes are first-class. Light mode uses Milky Paper around nearly white work surfaces. Dark mode uses a deep plum Espresso Void atmosphere, not a simple inversion. Status and third-party service colours retain their semantic meaning.

## Typography

- Use Geist (`font-sans`) for navigation, controls, body copy, lists, forms, captions, and numeric data.
- Use Bitter (`font-heading`) for the `Coldbrew` wordmark, page titles, hero statements, and prominent values. Bitter provides a consistent Cyrillic and Latin voice; never rely on a generic serif fallback for translated headings.
- Use tight display leading and tracking only at large sizes. Dense content and small utility text remain neutral and highly readable.
- Use `Coldbrew` with an initial capital in the product wordmark, prose, and document titles.

## Layout and surfaces

- Use `flex`, `grid`, `gap`, and padding for layout; prefer them over margins wherever practical.
- Reusable components accept external positioning and sizing through `className`.
- Use the `cosmic-panel` component class for primary dashboard and settings panels. It combines a large radius, semantic border, card surface, and soft blue shadow.
- Use smaller radii for controls and nested items so page scenes and panels retain hierarchy.
- Keep content containers `min-w-0` inside flex layouts and test long names, messages, and URLs for horizontal overflow.
- Page headers use a quiet tinted surface and a contextual illustration. The dashboard, sign-in, and public queue may use the stronger `cosmic-hero` space scene.

## Illustration and motion

- Code-native decorative SVGs live in `apps/web/src/components/cosmic-art.tsx` and are the only exception to the Lucide UI-icon rule.
- Current motifs are the cup portal, orbital queue, and coffee-bean comets. Reuse or extend these motifs instead of adding unrelated stars and planets per page.
- Decorative SVGs use `aria-hidden="true"`, do not receive pointer events, and never contain essential text.
- Use one slow orbital animation for ambient motion. Short hover movement is acceptable when it reinforces an incoming signal or queue item.
- All non-essential animation and transition duration must collapse under `prefers-reduced-motion: reduce`.

## Components and interaction

- Start with existing shadcn components and semantic variants.
- Primary actions use `primary`; selected surfaces use `secondary`; quiet actions use `ghost` or `outline`.
- Preserve visible hover, active, disabled, error, and `focus-visible` states. Bright scenes need explicit contrast-aware control styles.
- Green communicates connected/success, amber communicates warning, and red communicates error or destructive action. Never rely on colour alone.
- Charts use the `--chart-*` tokens. Galactic Blue is the primary route; Coral, Mango, Mint, and violet support it.
- Skeletons remain structurally faithful to the content they replace. Empty and error states may use one faint contextual drawing.

## Interface icons

Application icons use `lucide-react`; do not add another icon library, inline SVG UI icons, or emoji. The Coldbrew mark and documented decorative artwork are exceptions, not replacements for UI icons.

### Catalog and meaning

- Product code and routes import semantic icons from `apps/web/src/components/icons.tsx`, such as `Icons.wallet` or `Icons.retry`. Add an entry there instead of importing from `lucide-react` directly.
- Keep the catalog namespace import, `import * as icons from "lucide-react"`, and refer to glyphs through `icons`.
- Name entries for product meaning (`retry`, `donations`, `notWatched`), not their current glyph. Keep separate semantic aliases even when they currently point to the same glyph.
- Reuse an established semantic icon before adding a new glyph. Direct Lucide imports are only appropriate within the reusable shadcn/Base UI primitive that owns a generic control.

### Layout and appearance

- Let the current `Button` size control inline icon size unless intentionally different. Use 15 px in compact fields and tabs, 16 px in ordinary inline controls and navigation, 18 px for small standalone actions, and 20 px for empty-state or feature icons.
- Make icon-only actions existing `Button` `icon-*` controls or equivalent focusable controls; the SVG itself is never the click target.
- Icons inherit `currentColor`; set a semantic text colour on the parent. Retain default Lucide strokes and use state or brand colour only where it communicates meaning.
- Use a parent `gap` for icon-label spacing. Avoid icon margins or absolute positioning except deliberate field decorations.

### Accessibility

- Set `aria-hidden="true"` when visible text, the control name, or an accessible label already communicates the icon's meaning.
- Every icon-only interactive control needs an accessible name, normally `aria-label`; add a tooltip when the action may be unfamiliar, but it never replaces that name.
- Do not communicate status or selection with icon shape or colour alone. Loading icons are decorative and accompany an accessible loading or busy state.
- Preserve the parent control's hover, disabled, active, and `focus-visible` states.

### Brand and decorative assets

- Use `apps/web/assets/logo.png` for the Coldbrew identity and favicon; use 36–40 px in compact navigation and 48 px in the sign-in hero.
- `apps/web/src/components/cosmic-art.tsx` contains decorative coffee-cosmic line art. Mark it `aria-hidden="true"`, disable pointer interaction, and keep essential copy outside the SVG.
- Reuse its established motifs and the six brand colours in this guide; routine actions remain Lucide icons in semantic UI colours.

## Brand assets

- Use `apps/web/assets/logo.png` for both the product mark and browser favicon.
- Keep the coffee-bean mark visually centred within its circular background. Use 36–40 px in compact navigation lockups and 48 px in the sign-in hero.
- The static logo, `CosmicArt` drawings, and Lucide interface icons have different jobs and should not be substituted for one another.

## Responsive and accessibility checks

- Verify every authenticated page, sign-in, and `/videos/$slug` at desktop and 390×844.
- Test light and dark themes, navigation, forms, loading, empty, error, success, overlays, and long content.
- Ensure there is no horizontal page overflow at 390 px, including unbroken URLs.
- Keep all decorative artwork hidden from assistive technology and ensure clipped art never covers interactive content.
- Check keyboard focus on every control, especially controls placed over `cosmic-hero` scenes.
