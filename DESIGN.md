---
name: Coldbrew
description: A warm coffee observatory for bright moments on stream.
colors:
  background: "#f6efe4"
  foreground: "#251820"
  card: "#fffdf8"
  primary: "#5844b8"
  primary-foreground: "#ffffff"
  secondary: "#eee5f3"
  secondary-foreground: "#57418a"
  muted: "#f4eee9"
  muted-foreground: "#70616a"
  border: "#e7dcd8"
  input: "#d8cbc8"
  ring: "#7962cd"
  destructive: "#d84557"
  sidebar: "#251c20"
  sidebar-primary: "#edbf88"
  milky-paper: "#fff8ed"
  cosmic-blue: "#4056e8"
  comet-coral: "#ff647c"
  solar-mango: "#ffbd3e"
  mint-signal: "#54cfa5"
  dark-background: "#191418"
  dark-card: "#241d23"
  dark-primary: "#bcabf2"
typography:
  display:
    fontFamily: '"Bitter Variable", serif'
    fontSize: "clamp(2.75rem, 5.4vw, 4.75rem)"
    fontWeight: 500
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  headline:
    fontFamily: '"Bitter Variable", serif'
    fontSize: "clamp(28px, 4vw, 42px)"
    fontWeight: 600
    lineHeight: 1
  body:
    fontFamily: '"Geist Variable", sans-serif'
rounded:
  lg: "1rem"
  xl: "1.4rem"
  2xl: "1.8rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
  panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.2xl}"
---

# Design System: Coldbrew

## Overview

**Creative North Star: “The warm coffee observatory.”** Creamy paper surrounds
plum cosmos, a cup holds a small universe, and geometric orbits suggest the wait
before a bright reaction on stream. The mood is warm, playful, and quietly
magical. Bitter gives the identity an editorial voice; Geist keeps live work clear.

Brand scenes carry the strongest atmosphere. Lists, forms, and working panels
remain calm and compact. Repeated signatures are the arched landing illustration,
coffee cup, orbital paths, and roasted-gold navigation.

This is the canonical guide for Coldbrew's visual direction and UI conventions.
Product context lives in [PRODUCT.md](PRODUCT.md); terminology and domain
invariants live in [AGENTS.md](AGENTS.md). Exact tokens and component behavior
are defined in [styles.css](apps/web/styles.css) and the existing UI components.
Review evidence belongs in the [redesign review](.impeccable/review/final-review.md),
not in the design rules.

## Original associations

The design follows a coffee-and-cosmos aesthetic: coffee, galaxies, and childlike illustrations with simple lines.

Here is what the person who coined the name Coldbrew suggested:

I associate it with a black hole, coffee, a long stream, eternity, energy, a shot, speed, a queue, a row, a chain, a line, a dot, storage, a production line, and the Milky Way. Like a cup of coffee with the cosmos flowing inside it.

There is a beautiful idea in this name and in the purpose of your service.
It captures the viewer's long wait for the streamer to notice them,
and the streamer's quick glance at a video or message that sparks a vivid reaction.
Yet a stream is made of many such moments, and it lasts a long time.
It is literally coffee brewed slowly and drunk quickly.

## Colors

The palette pairs cream and espresso with observatory violet. Use semantic CSS
variables from `apps/web/styles.css` for application surfaces and controls.
Prefer semantic utilities such as `bg-background`, `bg-card`, `text-foreground`,
`text-muted-foreground`, `border-border`, `bg-secondary`, `text-primary`, and
`ring-ring`. Hardcoded brand colors are reserved for deliberate illustrations
and brand scenes. Charts use the `--chart-*` tokens.

- **Primary:** violet identifies actions and links; dark mode uses pale violet.
- **Navigation:** the dark coffee sidebar uses roasted gold for its primary state.
- **Neutrals:** creamy background, nearly white cards, espresso text, and warm
  borders keep data readable. Muted text uses its dedicated semantic token.
- **Illustration:** coral, mango, mint, and cosmic blue punctuate the cup and
  orbits. They also participate in the chart palette; they do not replace action
  or status semantics.
- **Dark mode:** deep plum backgrounds and raised plum surfaces use the `.dark`
  overrides. Preserve those overrides instead of hardcoding light colors.

Green communicates connected/success, amber warning, and red error or destructive
actions. Never rely on color alone. Cream text on plum brand scenes is deliberate. Functional success, warning,
error, and service colors retain their meaning and require text or icon cues.

## Typography

Use **Bitter Variable** (`font-heading`) for the wordmark, hero statements, page
titles, and prominent values. Use **Geist Variable** (`font-sans`) for navigation,
controls, body copy, lists, forms, and numbers. Both Latin and Cyrillic headings
must use the intended font.

The landing display uses the fluid frontmatter scale. Shared page headings use
the smaller fluid headline scale; landing section headings use 30–36 px. Body
copy is generally 14–18 px with generous leading, while compact controls use
14 px. Keep tight tracking and leading with display text. Inputs and times use
tabular numerals. Headings balance their wrapping. Use `Coldbrew` with an initial
capital in the wordmark, prose, and document titles.

## Layout

The landing uses a centered `max-w-6xl` container with 20 px mobile and 32 px
larger-screen side padding. Its introduction stacks on mobile and becomes two
equal columns at `lg` (1024 px). The artwork follows the copy in document order.
Feature rows form two columns from `sm` (640 px), separated by fine horizontal
rules. Broad section gaps give the entry page a slower rhythm than working pages.

Working surfaces use flex/grid, gap, and padding rather than margins wherever practical.
Keep flex children `min-w-0` and allow long names, messages, and URLs to wrap. Shared page headers have 20 px
padding, increasing to 28 px at `sm`, and reserve room for faint right-side art.
Reusable components receive external sizing and positioning through `className`.
Keep long content shrinkable and wrapping; illustrations need safe space around
copy and interactive controls at every breakpoint.

The authenticated shell places quiet working panels alongside a coffee sidebar.
On mobile, video sharing and video priority configuration sit behind a disclosure
button; video status filters remain visible in two columns. Desktop retains
the visible configuration and a right-hand filter column. Multichat puts its feed
before connection management on narrow screens, while desktop uses a connection
column beside the feed. Channel cards use a neutral border and muted surface.

The public video queue uses a centered `max-w-4xl` panel, a plum scene header,
restrained cup artwork, and compact video priority group dividers. Mobile padding
is 12 px with safe-area accommodation; larger screens use 32 px.

### Reading surfaces

Privacy and terms use an unboxed cream reading column capped at `max-w-3xl`,
with 20 px mobile and 32 px larger-screen side padding. The existing 36 px product
mark and faint orbital art give the header a quiet brand presence. Bitter titles
scale from 26 to 44 px and allow long words to wrap; Geist body text uses 16 px
type with 28 px leading. Fine header and footer dividers, understated purple
cross-links, and visible keyboard focus outlines complete the reading surface.

## Elevation & Depth

Tonal layering and borders provide most depth. `cosmic-panel` has no shadow.
The landing observatory alone uses a diffuse `0 28px 60px #39212c1a` shadow;
its main sign-in action adds a restrained violet shadow. Plum radial gradients,
sparse starlight, and thin orbital lines establish atmospheric depth without
decorating list interiors.

## Shapes

The CSS base radius is `1rem`; `rounded-lg` uses that base, `rounded-xl` is
`1.4rem`, and `rounded-2xl` is `1.8rem`. Panels and page scenes use `rounded-2xl`;
ordinary buttons and inputs use `rounded-lg`. These are the actual custom
Tailwind mappings, not the framework's default radius values.

The signature observatory has an arched top:
`48% 48% 1rem 1rem / 28% 28% 1rem 1rem`. At desktop it tilts three degrees while
its contents counter-rotate. Circles, elliptical paths, dashed trails, and small
geometric stars connect artwork across surfaces.

## Components

- **Buttons:** reuse the existing shadcn/Base UI primitive. Primary is violet,
  secondary is pale violet, and outline/ghost provide quiet actions. The default
  height is 32 px; the landing CTA explicitly grows to 48 px with 24 px horizontal
  padding. Preserve focus rings, hover, disabled, invalid, and pressed states.
- **Inputs:** 32 px high, semantic border, transparent light surface, and a tinted
  dark surface. Focus uses the ring token; invalid fields use destructive styling.
- **Panels:** `cosmic-panel` combines a card surface, semantic border, and the
  custom `rounded-2xl` radius. Keep content clean and legible.
- **Navigation:** sidebar links have a 48 px minimum height and warm translucent
  selection fill with a gold border and label. Secondary status filters use the
  existing secondary/ghost button variants with counts and accessible selection.
- **Configuration disclosures:** mobile video configuration uses a full-width
  ghost button with `aria-expanded` and `aria-controls`. Keep frequent status
  filters outside the collapsed region.
- **Page headers:** `CosmicPageHeader` places cream Bitter titles and warm muted
  descriptions on `cosmic-page-scene`, with restrained orbit or bean art.
- **Landing artwork:** `CosmicArt` combines the existing `cosmic-cup.png` and
  `cosmic-cup@2x.png` rasters with geometric SVG orbits. Reuse this composition;
  it is distinct from the product mark in `assets/logo.png`.
- **States:** skeletons follow the structure of the content they replace. Empty
  and error states may use one faint contextual drawing. Keep hover, active,
  disabled, error, and `focus-visible` states visible, including on brand scenes.
- **Motion:** use one slow orbital animation (18 seconds per cycle). Short hover
  movement should reinforce an arriving signal or a video moving through the queue.
  All nonessential animations and transitions collapse under
  `prefers-reduced-motion: reduce`.

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

## Do's and Don'ts

- **Do** concentrate the coffee-cosmic atmosphere in entry scenes and headers.
- **Do** keep purple actions, gold navigation, and status colors distinguishable.
- **Do** reuse the cup, orbit, and bean motifs with clear space around text.
- **Do** check translated wrapping, keyboard focus, mobile overflow, and both themes
  when extending the implementation.
- **Don't** replace working panels with heavily illustrated containers.
- **Don't** substitute decorative stars, emoji, or the logo for interface icons.
- **Don't** treat source-level theme support as evidence of visual validation.
