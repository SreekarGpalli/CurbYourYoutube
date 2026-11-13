# Curb interface direction

Keep YouTube familiar while making the current intent and time spent continuously visible. Playback awareness must remain near the video in normal, theater, and fullscreen modes, including when native controls auto-hide. The indicator must let clicks pass through and leave playback controls clear.

## Decisions

- Use neutral black and gray surfaces. No green tint, colored surface wash, gradients, or glass blur. Error text can use restrained red because it carries meaning.
- Leave YouTube's own theme alone. Curb's dock, prompts, and pages are dark and neutral, and never recolor or force a theme on YouTube itself.
- Let type size, spacing, and separators express hierarchy. Body text is 13–14px, utility labels 11–12px, dialog headings 26px. Timers use tabular monospace figures.
- Keep copy literal: Settings, Session controls, Break interval, Start session, Session finished. Omit motivational slogans and repeated privacy claims in headings.
- Use white for the principal action, outlined dark buttons for secondary actions, and visible keyboard outlines. Chosen intent options have both a border change and a checkmark.
- Group settings in flat sections with dividers. Reserve an enclosed panel for the current session; do not put every section inside another rounded card.
- Omit decorative icons, numbered navigation, and pill badges. Intent options use three columns on desktop and two on narrow screens; saved searches have a distinct card treatment.
- Keep extension assets and fonts local. The monochrome toolbar icon uses the same neutral palette.
- Inspect wide and narrow screenshots, native controls, error states, and text contrast before describing the result as verified.

## Research applied

- [NN/g: AI Prototyping in Real Design Contexts](https://www.nngroup.com/articles/ai-prototyping/) identifies poor grouping, overused colors, inconsistent spacing, and generic patterns. This revision specifies a concrete utility-oriented hierarchy and removes unrelated decoration.
- [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui) describes reducing visual noise and improving alignment and navigation hierarchy. This revision uses a compact navigation rail, aligned setting rows, and fewer surface treatments.
- [NN/g: Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/) emphasizes retaining information that serves the task. Setting and timer explanations live in [GUIDE.md](GUIDE.md); the interface keeps action labels, session data, errors, and reset confirmation.
- [Material: Color roles](https://m3.material.io/styles/color/the-color-system) separates surfaces, text, outlines, and action emphasis. This revision uses those roles with neutral colors instead of tinting every surface.
- [SmoothUI: AI Design Slop](https://smoothui.dev/blog/ai-design-slop) was consulted as a practitioner perspective on generic generated interfaces. It is not treated as a universal ban on otherwise useful UI patterns.

These are design references, not external runtime dependencies or installed agent skills.
