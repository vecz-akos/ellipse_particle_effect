# AGENTS.md

Orientation notes for AI agents working on this repo. Read `README.md` too —
that one is user-facing; this file is the stuff that is easy to get wrong.

## What this is

A hobby generative-graphics sketch. Twenty thousand particles wander a canvas
with a step length driven by their distance from an n-ellipse, so they pile up
along the curve and trace out orbit-like, x-ray-looking images. Nothing here is
production, there is no test suite, and the only judge of a change is what it
looks like on screen.

The output is the point. A "cleanup" that makes the code tidier and the picture
different is a regression.

## Layout

```
index.html            Vite entry point; the stage element and the canvas
styles.css            all styling, hand-written, no framework
vite.config.js        one setting: base "./" so builds open from the filesystem
scripts/              the sketch — one class per file, default-exported
docs/                 architecture, the decision log, and the roadmap
../imgs/              reference renders, hand-edited outside this repo (not tracked here)
```

## Where documentation goes

| What you are writing | Where it goes |
| --- | --- |
| Why something is the way it is; what was tried and broke | `docs/decisions.md` |
| What a component is, what it owns, how pieces connect | `docs/architecture.md` |
| Planned work, in dependency order | `docs/roadmap.md` |
| A small follow-up task to hand to an agent | `docs/agent-message.md` (untracked; skeleton in `docs/agent-message.template.md`) |
| How to run or build the project | `README.md` |
| A rule an agent must not break | this file, in one or two sentences |

Rules for all of it:

- **`docs/decisions.md` is newest-first and append-only at the top.** Never edit
  an existing entry; a changed decision gets a new entry saying what it
  supersedes.
- **Big calls get detail, small ones get a few lines.** The file grows forever.
- **No line-number references anywhere in the docs.** Name the file, function,
  constant, or component instead — line references drift.
- **Documentation is written in English**, regardless of the conversation
  language.
- **Keep code comments short.** A paragraph of reasoning belongs in
  `docs/decisions.md`; the comment states the constraint in a line or two and
  names the entry that explains it.

## Conventions

- **Dependencies stay minimal, split by layer.** The simulation and the canvas
  drawing get no packages — check whether fifteen lines of arithmetic would do.
  The UI around the canvas (export button, sliders, inputs) may use a CSS or
  component library; Tailwind or Bootstrap are acceptable there. See the
  "Dependencies stay minimal" entry in `docs/decisions.md`.
- **No semicolons** in `scripts/`, and one class per file with a `default`
  export. Match it.
- Plain ES modules and Canvas 2D. No TypeScript, no JSX. Styling is hand-written
  in `styles.css`; there is no CSS framework, and the panel is built from native
  inputs.
- **Every tunable belongs in `Params`.** The panel and the keyboard both write
  that one object and the loop reads it; do not add a new module-level `let` in
  `main.js` for something the user can change. Non-tunable runtime state (the
  canvas size, the particle array, the drag target) stays in `main.js`.

## Hard constraints that look arbitrary but aren't

- **The step-length formula `sqrt(error + offset) * scale - bias` in
  `Particle.update` is hand-tuned.** The defaults in `Params` (128, 8, 90) are
  load-bearing for the look. They are editable in the panel now; do not
  "simplify" the formula or change what the defaults are.
- **The canvas is not the window.** Its pixel size comes from `Params.aspect`
  and `Params.resolution`, and CSS scales it into the area beside the panel.
  Anything reading mouse coordinates must go through `toCanvas` in `main.js`,
  and resolution is part of the look — the same seed at another resolution is a
  different image, not a larger one.
- **`d` is exactly the sum of the focal-point weights.** There is no constant
  term any more — the old `baseD` was the startup point's weight in disguise, and
  removing it is what makes the shared weight slider a size control (`d = n·W`).
  Do not reintroduce a term that belongs to no point.
- **This is not simulated annealing**, despite the repository name — no energy
  acceptance, no cooling schedule. Adding a real one would kill the effect,
  because the system is supposed to never converge. Full explanation in
  `docs/decisions.md`.
- **The image is the density buffer, not the canvas.** `draw` writes no shapes:
  it accumulates hits into `DensityBuffer` and blits one `ImageData`. The old
  `record` flag and the per-particle alpha are gone — brightness is `exposure`
  and `gamma` now.
- **No `Math.random` in the simulation.** Everything random draws from the
  single `Random` instance in `main.js` (passed into `Particle.update`), or the
  seed stops determining the image. The one exception is `Random.randomSeed`,
  which picks the seed itself.
- **`particleCorrection` keeps an equal margin on every side**, one canvas by
  default (`Params.tolerance`). Particles out there are still part of the
  simulation; recycling them sooner tightens the image visibly. The margin used
  to be measured from the canvas origin, which made the right and bottom edges
  one canvas stricter than the left and top — that asymmetry was a bug, not a
  tuning.

## Gotchas already investigated

- `MouseFollower` stores its listener in `this.handler` because
  `removeEventListener` needs the same function reference — passing a fresh
  arrow function silently removes nothing. This was a real bug; do not inline it
  back.
- **The two resize paths clear different things, on purpose.** Both reallocate
  every particle. A *window* resize (`onresize`) keeps the accumulated density:
  `DensityBuffer.resize` copies the overlapping region and recomputes `max` over
  it, so nudging the window edge does not destroy a run that has been building
  for minutes. Changing *aspect or resolution* from the panel (`canvasChanged`)
  clears it, because that is a deliberate act of choosing a new pixel size and
  the buffer's contents are resolution-specific — the step curve is tuned in
  pixels, so old traces and new ones are drawn at different scales and blending
  them just looks like a mistake. The same split governs the figure:
  `canvasChanged` calls `rescaleFocalPoints` so the points keep their place in
  the frame and their size relative to it, and `applyDefaultWeight` so newly
  added points are sized for the canvas you are on; a window resize touches
  neither, because the surviving density was drawn around the figure where it
  stands.
- The keyboard handler returns early when the event comes from inside `.panel`,
  so typing a seed does not toggle modes. After changing `Params` from a
  shortcut it calls `panel.sync()`, or the controls would show stale values.
- `savePng` exports an offscreen canvas built from the last `imageData`, not the
  visible one, because `draw` strokes the focal-point crosses onto the visible
  canvas after the blit. Anything drawn on top of the image belongs there, not in
  the export.
- `correctionCounter` in `update` is accumulated and unused. It is a debug hook
  left in place deliberately; a linter will flag it.

## Verifying changes

```powershell
npm run build     # catches import and syntax errors; the only static check there is
```

There are no tests, no linter and no type checker, and none of the above will
tell you whether the change is correct — the sketch is judged visually. **Do not
start the dev server unasked**; the user runs `npm run dev` and looks at it. When
you need a visual check, say what to look for (density on the curve, how quickly
the fringe recycles, alpha build-up in accumulating mode) and let the user
report back.

## Environment

Windows 11, VS Code, PowerShell as the primary shell (Bash also available).
Node 24, npm 12. Give commands in PowerShell form.
