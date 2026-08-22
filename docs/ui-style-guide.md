# Coldbrew UI Style Guide

Coldbrew is a tool for streamers first. Its visual identity may reference specialty coffee, but the interface must remain neutral, focused, and suitable for a productivity dashboard. Coffee colors are brand accents, not a reason to tint every surface.

## Design direction

- Keep the interface modern, calm, compact, and data-oriented.
- Use warm brown and caramel accents selectively for branding, primary actions, active states, charts, and promotional blocks.
- Keep light-theme backgrounds, cards, borders, and muted surfaces close to neutral gray or off-white. Avoid pervasive yellow or cream casts.
- Preserve service brand colors, status colors, and destructive colors when they communicate meaning.
- Do not reintroduce the previous violet Omnistream palette.

## Color system

- Treat the semantic variables in `apps/web/styles.css` as the source of truth.
- Prefer Tailwind utilities such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-secondary`, `text-primary`, and `ring-ring`.
- Do not hardcode neutral colors inside components. Add or adjust a semantic token when a reusable role is missing.
- Hardcoded colors are acceptable only for deliberate brand artwork, third-party service branding, status colors, or a one-off decorative gradient.
- Every new component must work in both light and dark themes without selector-based compatibility hacks.

## Typography

- Use Geist (`font-sans`) for navigation, controls, body copy, labels, and numeric data.
- Use Fraunces (`font-heading`) for the Coldbrew wordmark, page titles, and prominent card headings.
- Do not use the display font for dense tables, forms, status labels, or small utility text.
- Keep the product wordmark lowercase as `coldbrew`; use `Coldbrew` in prose and document titles.

## Layout and surfaces

- Use `flex`, `grid`, `gap`, and padding for layout; prefer them over margins where practical.
- Reusable components must accept external positioning and sizing through `className` rather than hardcoding width, margin, or growth on their root.
- Use `rounded-2xl border border-border bg-card` for primary dashboard panels. Add only subtle warm shadows such as `shadow-sm shadow-primary/5`.
- Use smaller radii for controls and nested elements so cards remain visually dominant.
- Keep content containers `min-w-0` inside flex layouts and test long names, messages, and URLs for horizontal overflow.
- Maintain the existing compact information density; decorative elements must not compete with stream data or actions.

## Components and interaction

- Start with the existing shadcn components and their semantic variants.
- Primary actions use `primary`; selected and active surfaces use `secondary` or sidebar accent tokens; quiet actions use `ghost` or `outline`.
- Preserve visible hover, active, disabled, error, and `focus-visible` states.
- Use status colors consistently: green for success/connected, amber for warnings, and red for errors or destructive actions.
- Charts should use the `--chart-*` tokens instead of embedded palette colors.
- Skeletons and empty states must use semantic muted and secondary surfaces.

## Brand assets

- Use `apps/web/assets/logo.svg` for the product mark and favicon.
- Keep the coffee-bean mark legible at 20-24 px and visually centered within its circular background.
- Reserve the espresso-to-caramel gradient for high-emphasis brand moments; do not use it for routine controls or large page backgrounds.

## Responsive and accessibility checks

- Verify authenticated pages, sign-in, and public share pages at desktop and mobile widths.
- Test both themes, including navigation, forms, loading states, empty states, and overlays.
- Ensure there is no horizontal page overflow at 390 px, including with unbroken URLs.
- Keep text and control contrast accessible and never rely on color alone to communicate status.
