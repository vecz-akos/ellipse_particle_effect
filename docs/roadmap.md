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

## Phase 2 — Seeded RNG

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

## Phase 3 — Control panel

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

## Not planned

- **A real simulated-annealing implementation.** The name is historical; a
  cooling schedule would make the system converge and kill the effect. See
  `docs/decisions.md`.
- **A framework for the canvas layer.** The simulation stays plain ES modules
  and typed arrays.
