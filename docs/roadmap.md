# Roadmap

Planned direction, roughly in dependency order — each phase unlocks the next, so
the order matters more than the dates (there are none; this is a hobby project).

This file is forward-looking and **is** edited as plans change. When a phase
actually lands, the reasoning behind how it was built goes into
`docs/decisions.md` as a new entry, and the phase here gets marked done rather
than deleted.

---

## Phase 1 — Density buffer instead of alpha accumulation — **done**

Landed as `scripts/DensityBuffer.js`; see "The density buffer, and the fade that
came with it" in `docs/decisions.md`. The colour grading this unlocks is still
a hardcoded two-colour lerp — a real colormap arrives with the UI in Phase 3/4.
The original plan follows, for context.

**The problem.** Two problems, one fix. Drawing translucent dots clips: at alpha
`16` a pixel saturates to full white after a few dozen hits, and every hit after
that is lost — the brightest, most interesting regions carry the *least*
information. Separately, `beginPath` / `arc` / `fill` per particle per frame is
the actual render cost, and it is absurd for what is effectively a half-pixel
dot.

**The change.** Accumulate into a `Float32Array` of `width * height` — one `+= 1`
per particle hit, no canvas calls in the particle loop at all. Then map density
to colour once per frame (a tone curve over the buffer, written into an
`ImageData` and blitted with `putImageData`).

This is what fractal-flame renderers do, and this sketch is structurally one of
those: a stochastic attractor sampled by a particle swarm. Worth reading up on
their tone mapping (log density, gamma, "vibrancy") before inventing one.

**What it unlocks.**

- Unlimited dynamic range — the tone curve decides what saturates, not the
  hardware.
- Colour grading for free: the black → orange → white look of the reference
  images is a colormap over density, not a post-process.
- Resize can keep the accumulated image instead of wiping it (currently `init`
  reallocates everything).
- Particle count can go up an order of magnitude, because the per-particle cost
  becomes an array write.

**Watch out for.** The buffer is the image now, so `clearCanvas` / `record`
stop meaning what they mean today — they collapse into "reset the buffer" and
"exposure". Expect to rewrite `draw` completely rather than patch it.

---

## Phase 2 — Seeded RNG — **done**

Landed as `scripts/Random.js` (mulberry32, hand-written); see "Seeded RNG" in
`docs/decisions.md`. The seed lives in the URL hash and `r` rolls a new one.
Caveat for the phases below: the run is reproducible for a given **window
size**, because `init` spawns particles from the stream. The original plan
follows, for context.

Currently `Math.random` everywhere, so **no image is reproducible**. That is the
one thing a generative project cannot afford: a good render cannot be recovered,
only re-rolled.

Swap in a small seedable PRNG (a hand-written xorshift128+ or mulberry32 — a
dozen lines, no package) behind a single module, used by particle spawning and
by the step direction in `Particle.update`.

With this, `seed + parameters` fully determines the image. That is what makes
Phase 3's presets and Phase 4's high-resolution re-render meaningful: you can
export a small preview, then re-render the exact same image at print size.

---

## Phase 3 — Control panel — **mostly done**

Landed: the docked panel with its three tabs, the `Params` object the panel and
the keyboard share, every parameter above live-editable, per-point focal weights
and canvas dragging, the aspect/resolution dropdowns, and PNG save. See "Control
panel, and the canvas as a render target" in `docs/decisions.md`.

Presets landed too: `scripts/Preset.js` and the Render tab's Presets section
save and load the whole state as JSON. See "Presets are a JSON file, and the
file is not trusted" in `docs/decisions.md`.

**Still open in this phase:** the full parameter state in the URL hash — only
the seed is there, and the preset schema is the obvious thing to encode.

The resolution multiplier has **left this phase**. It was going to need
normalised coordinates, which is now rejected outright — see "Not planned"
below. The output-size problem it was meant to solve is real and stays on the
list as Phase 6, by a route that does not touch the tuned constants.

The original plan follows, for context.

A multi-tab panel docked to the right edge of the window; the canvas keeps the
rest. This is where a CSS/component library is welcome — see "Dependencies stay
minimal" in `docs/decisions.md`. The keyboard shortcuts stay as the fast path.

**Tab: Parameters.** Everything currently hardcoded, live-editable:

- the step-curve constants from `Particle.update`
- particle count and the recycle tolerance
- exposure / tone curve (Phase 1) and the colours
- the focal-point list: per-point coordinates and **per-point weight** — note
  that `NEllipse.addFocalPoint` already accepts a per-point `d` contribution,
  it is simply unreachable from the keyboard today
- dragging existing focal points on the canvas, not only add/remove

**Tab: Render / export.** Resolution multiplier, re-render at size from the
current seed, PNG save, preset save/load as JSON, and the state encoded in the
URL hash so an image can be linked.

**Tab: Playback.** See Phase 5.

**Prerequisite work.** The module-level `let` flags in `main.js` are fine today
and stop being fine here. They need to become one parameters object, with the
panel and the keyboard handler both writing to it, and the loop reading it.
That refactor is part of this phase, not a separate one.

---

## Phase 4 — Post-processing in-app

Replaces the manual image-editor pass that produced the renders in `../imgs/`.

- **Tone curve + colormap** — mostly done by Phase 1; this is the UI for it.
- **Bloom** — a blurred copy of the density buffer added back. A separable
  Gaussian at half resolution is enough.
- **Vignette** and **grain** — cheap, and they do a lot of the "photographic"
  work in the reference images.

Order matters: tone map, then bloom, then vignette, then grain last (grain
before bloom gets smeared and looks wrong).

Open question: keep it on the CPU over the density buffer, or move the whole
render to a WebGL fragment shader. CPU first — it is simpler and the bottleneck
after Phase 1 is the particle loop, not the post-process.

---

## Phase 5 — Focal-point animation and playback

The furthest out, and the most open-ended.

Give each focal point a **path** — a straight segment or a Bézier curve — plus a
duration, and play the whole thing on a timeline. The accumulated image then
traces the motion, which is where the galaxy-like structures should come from:
today the shapes are static and only the noise moves.

The Playback tab drives it: scrub the timeline, set per-point paths and
durations, loop or one-shot. Path editing happens on the canvas itself (drag the
control points), with the panel holding the numbers.

**Timelapse export** belongs here too — `MediaRecorder` over a
`canvas.captureStream()`, since watching the image build up is at least as good
as the final frame.

**Unresolved.** Whether a "frame" of the animation should accumulate for a fixed
number of simulation steps (deterministic, slow, exportable) or in real time
(interactive, non-reproducible). Probably both, with the deterministic mode used
only for export.

---

## Phase 6 — Supersampled export at print size

The largest image you can keep today is your screen. That is the real
limitation behind what used to be called the "resolution multiplier", and it
has nothing to do with making the simulation resolution-independent.

**The route.** Render the same figure at `N` times the linear pixel density and
scale the step curve so every length grows by the same factor. Because the step
length must scale by `N` when the error does, the three constants do **not** all
take the same multiplier:

| constant | multiplier |
| --- | --- |
| `step.offset` | × N |
| `step.scale` | × √N |
| `step.bias` | × N |

That is an identity, not an approximation:

```
√(N·e + N·offset) · (√N · scale) − N·bias
    = √N · √(e + offset) · √N · scale − N·bias
    = N · (√(e + offset) · scale − bias)
```

So the geometry, the relative line widths and the width of the freezing band
around the curve all come out unchanged — the same picture, on more pixels.
Multiplying all three constants by `N` instead — the intuitive guess, and the
first version proposed — overshoots the step length by a factor of `√N` and
smears the image. Check the identity above before trusting any variant of these
multipliers.

At `N = 1` every constant is its current value, so nothing about today's look or
about `Params` changes. This is three multiplications applied to a copy of the
step curve at export time, not an architectural change.

**The cost, which is the reason this is an offline export and not a mode.** At
`N` times the linear resolution the canvas has `N²` times the area, so it needs
roughly `N²` times the samples to reach the same density — four times the
resolution is sixteen times the work. It runs for minutes and produces a file;
it does not run at sixty frames a second.

That makes it a natural neighbour of Phase 5's deterministic export mode (a
fixed number of simulation steps per frame rather than real time), and the two
should probably share whatever offscreen render loop gets written first.

**Still open.** Whether the particle count scales with `N²` or the run simply
accumulates for longer — the first keeps the run length constant, the second
keeps the RNG stream comparable to the on-screen run. Neither reproduces an
on-screen image pixel for pixel, and neither needs to: this renders the same
*figure* at a larger size, which is what the use case actually wants.

---

## Not planned

- **A real simulated-annealing implementation.** The name is historical; a
  cooling schedule would make the system converge and kill the effect. See
  `docs/decisions.md`.
- **A framework for the canvas layer.** The simulation stays plain ES modules
  and typed arrays.
- **Normalised (0–1) coordinates for the simulation.** Proposed as the way to
  make a seed reproducible at any resolution, and rejected. The `step` constants
  are hand-tuned and mean something *in pixels*; moving to a unit square does not
  generalise them, it destroys their meaning and restarts the tuning on a scale
  nobody has any intuition for — and `AGENTS.md` protects those constants
  precisely because the look depends on them. The universality it buys has no
  use case here: this is a sketch that draws on a canvas, not a geometry library.
  Phase 6 solves the output-size problem instead, without touching them.
