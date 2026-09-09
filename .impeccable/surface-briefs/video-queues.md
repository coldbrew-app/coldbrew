# Video queues

Target: `apps/web/src/routes/_authenticated/videos.tsx` and the public video queue.
Mode: Operate. Extend the existing Coldbrew working surface.

## Direction contract

THESIS: Independent queues remain visible while choosing videos and configuring priorities.

OWN-WORLD: Existing cream/plum surfaces, violet selection, Bitter headings and Geist controls.

STORY: Choose a queue, inspect its videos and thresholds, add or move a video, share its public view.

FIRST VIEWPORT: Compact queue tabs below the existing header; creation and settings alongside them.
Inline settings reveal name and default destination. Video cards expose a labeled destination selector.
Status filters, scrolling content and pagination retain their current positions.

RESPONSIVE BEHAVIOR: On mobile, queue navigation occupies the full row, followed by
settings and creation actions. From `sm`, navigation and actions sit inline, with
queue links wrapping as needed. Video destinations use a labeled native select
with the existing semantic surface, border, text and focus tokens.

FORM: Local extension of the established layout; no new visual identity or concept seed.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
