---
name: design-gallery
description: Builds a full-screen, interactive design picker with option controls on the left and a live preview of the real page on the right, offering 2-4 choices per element (color schemes, fonts, selectors, navigation, and every page section). Use this whenever the user wants to explore, compare, or choose layouts, looks, styles, color schemes, or fonts for a page or module, asks to "see options" or "mock up some directions", says "design gallery", or wants to redesign how a screen looks, even if they don't name this skill. Not for implementing an already chosen design.
---

# Design Gallery

The user decides by seeing, not by reading descriptions. So the gallery renders their actual page, and every choice updates it instantly. The result is a private hosted page they can return to on any device, and a "Copy my picks" button that brings their decisions back here.

## Workflow

### 1. Study the page and its constraints
Read the page's current code and any project design docs (`CLAUDE.md`, `docs/`, theme tokens, memory). List every visible element: navigation, sub-menus, selectors, each section and repeated card. Standing decisions limit the options: never offer something the user has already ruled out, and don't reintroduce banned content.

### 2. Gather real content
Use the user's real names, images, and figures, because layouts look different with real content lengths. Before using sensitive figures on a hosted page, confirm the user is fine with that, and offer made-up numbers instead. Leave out fields the page shouldn't show.

- Pull data through read paths. Importing an app's entry module can run its startup code, including migrations, so prefer its API or a read-only query.
- Write data and the image list to the scratchpad, not the repo, so personal figures aren't committed.

### 3. Write the spec
Save it as `<project>/mockups/design-gallery/<page>.spec.js` so it survives this session. It holds no personal data; content comes from the data file. See the contract below.

Choosing options:
- Cover these groups, in this order: color and type first, then page chrome, then one group per page section.
- Color schemes: at least two dark and two light. Each one needs its own considered neutrals, not an inversion.
- Offer 2-4 options per control, and make them truly different in structure, not small variations. Three kinds of tile with the same layout count as one option.
- Include today's look where one exists, marked `current: true`, as the first option and the default. This gives the user a baseline to compare against.
- Include form-control styles as elements of their own when the page has them: segmented, underline, radio, slider, checkbox, dropdown.
- Use sliders for continuous values (corner radius, density, card size) and toggles for show/hide choices.
- Make interactive elements work in the preview when that's cheap (carousel arrows, filters). Interaction is part of judging them.
- Every option must work with every other option. Check combinations rather than only the defaults, since the user will mix them.
- Design each page for desktop first. Phone design is a separate exercise for each screen, with its own gallery (`phone: true` in the spec opens it at phone width with a Phone button). Don't ask for phone decisions in a desktop gallery.

### 4. Build and publish
Run from the project root (the skill lives in the repo at `.claude/skills/design-gallery/`):
```bash
python3 .claude/skills/design-gallery/scripts/build_gallery.py \
  --spec mockups/design-gallery/<page>.spec.js --data <scratchpad>/data.json --images <scratchpad>/images.json \
  --title "Cards Portfolio Gallery" --out <scratchpad>/<page>-gallery.html
```
Embedding images needs Pillow (`pip install pillow`); a gallery without `--images` doesn't.
Check the built page once in the browser (pick a few unusual combinations, both color modes), then publish it with the Artifact tool using a short `description` and an `icon`. Republishing the same file path keeps the same link, and the viewer's picks survive.

### 5. Iterate on their picks
The user pastes the copied picks, which list each element, their choice, and any notes.
- Treat anything in the notes as their direction, and build what they asked for into the preview so they can judge it.
- Run the next round by narrowing. Mark settled choices `locked: true` (keep only the chosen option, as the default) and put them in a closed group at the bottom, `{ open: false }`. They show read-only and still appear in the copied picks. Open controls cover only what's undecided, with new variations around the winners.
- Change the spec `id` each round (`-r2`) so old picks and notes don't carry over, and republish to the same link. Rounds usually converge in two or three.
- When they're happy, write the final choices to the project's design doc as a concrete spec. Don't implement until they say so; the gallery chooses the look, and behavior and code come afterward.

## Spec contract

```js
Gallery.define({
  id: 'cards-portfolio',           // key for remembering picks
  name: 'Cards: Portfolio',
  fonts: ['https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&display=swap'],
  css: `#pv .tile { padding: calc(14px * var(--c-density)); }`,  // scope every rule under #pv
  groups: [{ id: 'carousel', label: 'Your cards', controls: [
    { id: 'scheme', label: 'Color scheme', type: 'choice', options: [
      { id: 'midnight', label: 'Midnight', hint: 'One-line description', current: true,
        swatches: ['#020617', '#2563EB'], tokens: { '--bg': '#020617' }, sample: 'font-family:Outfit' },
    ]},
    { id: 'density', label: 'Density', type: 'slider', min: .8, max: 1.3, step: .05, default: 1, unit: '' },
    { id: 'pending', label: 'Show pending', type: 'toggle', default: true },
  ]}],
  render(picks, data, h) { return `<section data-region="carousel">...</section>`; },
  after(root, picks) { /* optional: wire up preview interactions */ },
});
```

- Any control can take `locked: true` to show as a settled, read-only value. Any group can take `open: true/false` to set its starting state.
- Each pick is available in three ways: `picks.<id>` in `render`, `#pv[data-<id>="value"]` in CSS, and `--c-<id>` for sliders. An option's `tokens` are set as CSS variables on `#pv`.
- `data-region="<group id>"` connects a preview section to its group: clicking the section opens its options, and hovering the group outlines the section.
- `h` provides `h.esc(text)`, `h.img(key)` (an embedded image, or `''` if missing), and `h.num(n)`.
- `images.json` maps keys to `{ "path": "...", "width": 360, "trim": false }`. `trim` removes transparent margins, which makes logos line up. Images are resized and embedded because the hosted page can't load other files. The build stops if the page goes over 16MB.
- Fonts must come from Google Fonts, the only font host hosted pages allow.
