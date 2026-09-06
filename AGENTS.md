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
index.html            Vite entry point; holds the whole (tiny) stylesheet inline
vite.config.js        one setting: base "./" so builds open from the filesystem
scripts/              the sketch — one class per file, default-exported
docs/                 architecture and the decision log
../imgs/              reference renders, hand-edited outside this repo (not tracked here)
```

## Where documentation goes

| What you are writing | Where it goes |
| --- | --- |
| Why something is the way it is; what was tried and broke | `docs/decisions.md` |
| What a component is, what it owns, how pieces connect | `docs/architecture.md` |
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
- Plain ES modules and Canvas 2D. No TypeScript, no JSX. Styles currently live
  inline in `index.html`; that holds until there is enough UI to justify a
  stylesheet or a CSS framework.
- `main.js` owns all mutable state as module-level `let`s. Keep it that way
  rather than introducing a state object; the file is small enough.

## Hard constraints that look arbitrary but aren't

- **The step-length formula `sqrt(error + 128) * 8 - 90` in `Particle.update`
  is hand-tuned.** All three constants are load-bearing for the look. Do not
  "simplify" them.
- **This is not simulated annealing**, despite the repository name — no energy
  acceptance, no cooling schedule. Adding a real one would kill the effect,
  because the system is supposed to never converge. Full explanation in
  `docs/decisions.md`.
- **The `record` flag toggling itself inside `draw` is intentional**, not a
  stray assignment. It is how the accumulating low-alpha mode gets exactly one
  background fill after `clearCanvas` is switched off.
- **`particleCorrection` uses a tolerance of three screens.** Particles far off
  canvas are still part of the simulation; recycling them sooner tightens the
  image visibly.

## Gotchas already investigated

- `MouseFollower` stores its listener in `this.handler` because
  `removeEventListener` needs the same function reference — passing a fresh
  arrow function silently removes nothing. This was a real bug; do not inline it
  back.
- Resizing the window reallocates every particle and wipes the accumulated
  image. That is current behaviour, not a bug report waiting to happen.
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
