# How to use this log

Newest entry first. Each entry records **why** something is the way it is —
especially the things that were tried, broke, and got replaced, so nobody
rediscovers the same failure.

Rules:

- **Entries are never edited after the fact.** If a decision changes, add a new
  entry at the top that says what it supersedes. The old entry stays as the
  record of what was true at the time.
- Big architectural calls get detail. Small ones (a rename, a moved file) get a
  few lines — this file grows forever, so keep the small stuff small.
- **No line numbers.** Refer to files, exported constants, functions and
  components by name; line references drift within a release.

Entry format:

```markdown
# Topic title

Date: YYYY-MM-DD

Paragraphs, tables, lists.
```

---

# Presets are a JSON file, and the file is not trusted

Date: 2026-09-06

`scripts/Preset.js` captures the seed, every `Params` field, the focal points,
and the canvas size the points were placed on, as one JSON document with a
`version`. The Render tab downloads it and loads it back.

**Two fields do not travel: `animate` and `followFocalPoint`.** They are session
state, not image state — a preset that pauses the run or hands a focal point to
the mouse the moment it loads would be surprising, and neither affects what the
image looks like once it is running.

**The canvas size is saved because the coordinates need it.** Focal points are
in pixels, so a preset made at 2560×1440 and loaded into a fitted window would
put the figure off-screen. Loading resizes the canvas from the preset's aspect
and resolution first, then scales the figure in with `rescaleFocalPoints` — the
same path a resolution change takes, so there is one rule for "the canvas
changed under the figure" rather than two.

**A preset file is user input.** `apply` validates the whole document before
writing anything, then copies only keys that already exist in `Params` and whose
type matches, nested objects included; unknown keys, wrong types and malformed
focal points are dropped. `resolution` is the one field allowed to be either a
string (`"fit"`) or a number. An empty focal-point list is legitimate — a
*missing* one means the file is not a preset, and is rejected. Half-applying a
broken file is worse than refusing it, so nothing is written until every check
has passed, and the Render tab reports the reason instead of failing silently.

---

# One weight for every focal point, and the end of `baseD`

Date: 2026-09-06

Per-point weights are the right model, but they are the wrong control for the
thing people do most often: making the whole figure bigger or smaller. That used
to mean editing every row by hand and keeping the numbers in step. The "Focal
points" section now opens with a **Manual** checkbox, **off** by default, and a
**Weight** slider. With Manual off — the normal case — one slider sizes every
point at once, including ones added afterwards, and the per-row `w` fields are
read-only. Tick Manual and each point carries its own weight again: the rows
become editable, a new point takes `NEllipse.unit_d`, and the slider is
disabled. The two are the same number seen twice, so exactly one of them is
editable at a time. Turning Manual off again leaves each point holding the value
it has; restoring what it had before would be cleverer and less predictable.

The slider runs from an eighth of the shorter canvas side to one and a half
times it, and `setWeightRange` moves it with the canvas.

The state (`manualWeight`, `sharedWeight`) lives in `Params`, and every
write goes through `NEllipse.setWeight`, so `d` is recalculated the one existing
way. `main.js` keeps `sharedWeight` equal to `unit_d` while Manual is on, so
switching back starts from the size the canvas suggests, and
`rescaleFocalPoints` scales it with everything else.

**`baseD` is gone.** `d` used to be `baseD + Σ weights`, with `baseD` a constant
belonging to no focal point — a leftover from the original code, which seeded
`NEllipse` with a target sum before any point existed. It made the shared weight
useless as a size control, since `d = baseD + n·W` is not proportional to `W`.

Folding it into the points looked like it would change the look of existing
seeds, and it does not — because the startup point was created with **weight 0**
to compensate for `baseD`. With `baseD = unit_d` and weights `[0]`, `d` is
`unit_d`; with no `baseD` and the startup point taking `unit_d` like every other
point, `d` is `unit_d` again, and the two stay equal for any number of points
(checked for one through four). So `baseD` was the first point's weight wearing
a disguise. `recalculateD` now reduces from zero, the startup point is added
with the ordinary default, and `d = n·W` under a shared weight — which is what
makes the slider a size control at all. A readout under the list shows the
resulting `d`, since with several points the number is no longer obvious.

---

# Recycle margin is symmetric now

Date: 2026-09-06

`particleCorrection` compared against `±tolerance * width`, which is measured
from the canvas origin — so the right and bottom edges were one canvas stricter
than the left and top. Unintended, and invisible until the panel put the number
in front of someone. It now keeps `tolerance` canvases of margin beyond every
edge, and `0` means "recycle as soon as it leaves the visible area".

The default drops from 3 to 1 at the same time, which is a tighter image than
before on all four sides. The old `AGENTS.md` line calling three screens
deliberate is superseded: three was a starting point, not a tuning result.

# Control panel, and the canvas as a render target

Date: 2026-09-06

Roadmap Phase 3, first pass. Three things landed together because they do not
work apart.

**One parameters object.** `Params` holds every tunable — canvas aspect and
resolution, particle count, recycle tolerance, the step-curve constants, the
tone map, the colours, the four mode toggles. The panel and the keyboard handler
both write it, the loop only reads it. This supersedes the "main.js owns all
mutable state as module-level `let`s" rule in `AGENTS.md`, which was right while
there were six flags and wrong the moment two writers appeared.

**The canvas is no longer the window.** It has its own pixel size, chosen from
an aspect ratio and a render resolution, and CSS scales it to fit the space left
next to the panel. `stage.clientWidth/clientHeight` is the available area, not
the canvas size.

The question this settled: should the dropdown offer aspect ratio only, with
resolution left to a later export step? No — **resolution is part of the look,
not an output setting**. The simulation is in pixels: the hand-tuned step curve
is in pixels, focal points are pixel coordinates, and 20 000 particles cover a
4K buffer a quarter as densely as a 1080p one. The same seed at a different
resolution is a *different image*, not a bigger one. So both controls are
exposed, and the panel shows the resulting pixel size.

The alternative — normalising the simulation to a 0..1 space so a seed is
resolution-independent — is the only route to "preview small, re-render at print
size", and it was rejected for now because it changes the meaning of the tuned
constants and therefore the picture. It stays open for the export work.

**Hand-written CSS, no framework.** The panel is native `range`, `select`,
`number`, `color` and `checkbox` inputs; a component library would have styled
none of the parts that actually needed styling. `styles.css` replaces the inline
`<style>` block in `index.html`. The "UI layer may use a library" split from
"Dependencies stay minimal" stands — it was just not worth spending here.

**Focal points became editable.** `FocalPoint extends Point` and carries its own
`weight`, so `NEllipse.d` is the sum of the per-point weights plus a base — a
single point's contribution can now be changed after it was added, which the old
"add a number to a running total" version could not do. `addFocalPoint(point, d)`
keeps its signature and promotes a plain `Point` to a `FocalPoint`. Points are
also draggable on the canvas, with the panel's number fields following the drag.
The empty `scripts/FocusPoint.js` placeholder is gone.

**Not in this pass**, and still open in Phase 3: presets as JSON, the full state
in the URL hash (only the seed is there), and re-render at a resolution
multiplier on export. PNG save writes the canvas at its current resolution.

# Density-to-colour lookup table

Date: 2026-09-06

`DensityBuffer.render` no longer computes the tone curve per pixel. Density is
always an integer (`add` only ever does `+= 1`), so `buildTable` fills a
`Uint32Array` indexed by density with packed RGBA, and the pixel loop is one
array index plus one 32-bit store through a `Uint32Array` view of the
`ImageData`. The curve is unchanged: `log1p(d * exposure)` normalised to the
white point, `pow(t, 1/gamma)`, then a lerp between the colours.

**Measured** (Node, the real modules, 1920×1080, 20 000 particles, two focal
points, 30-run averages — not the browser, so read the ratios rather than the
absolute numbers):

| state | fill | particle loop | render, before | render, after |
| --- | --- | --- | --- | --- |
| early | 16% | 1.6 ms | 24.2 ms | 8.0 ms |
| after 3000 frames | 59% | 1.6 ms | 46.1 ms | 12.5 ms |
| after 10000 frames | 78% | 1.5 ms | 52.4 ms | 11.6 ms |

Two things the measurement settled. The render loop was never close to the
particle loop — it was **fifteen to thirty times more expensive** from the first
frame, so the "dramatically faster" claim in the density-buffer entry was about
dropping the per-particle canvas calls, not about the frame as a whole. And the
cost still grows with fill, just from a much lower base: the remaining work is
the per-pixel store, which the table cannot remove.

Output is pixel-identical to the previous implementation — verified by rendering
both into separate buffers at the same seed and comparing all 8.3 million
channels, at three points in a run. `Math.round` in the table matches what
`Uint8ClampedArray` did on assignment.

**For Phase 4: this table is the colormap.** The black → orange → white grading
of the reference images is a different `buildTable` body, not a new code path.

# Seeded RNG

Date: 2026-09-06

Roadmap Phase 2. `Math.random` is gone from the simulation: `Random`
(mulberry32, seeded through an xmur3 string hash) is created once in `main.js`
and passed to `Particle.update`; particle spawning and `particleCorrection` draw
from the same instance. `init` calls `random.reset()`, so a run restarts the
stream from its seed.

**Why hand-written, when a package was on the table.** The user offered one.
Mulberry32 is six lines and beats the obvious candidate (`seedrandom`) on both
size and maintenance; the whole thing is behind one module, so swapping it for a
package later is a one-file change. This also keeps the "simulation stays
dependency-free" split from "Dependencies stay minimal" intact.

**Seed handling.** The seed is a short base-36 string, read from the URL hash on
load and written back there whenever it changes, so a run is a link. `r` rolls a
new one, which clears the density buffer and re-inits. `Random.randomSeed` is
the one remaining `Math.random` call in the codebase — it picks the seed, it is
not part of the simulation.

**What is reproducible, and what is not.** Seed plus parameters plus **window
size** determine the run: `init` spawns from the stream, so a different canvas
size consumes it differently. Mouse-driven focal points (`f`, `+`) break
determinism too, by design — they are input, not state. Making the render
size-independent is Phase 3/4 work (re-render at resolution from a seed), not
something this phase promised.

# The density buffer, and the fade that came with it

Date: 2026-09-06

Roadmap Phase 1. `draw` no longer draws: it increments a `Float32Array` of
`width * height` hit counts (`DensityBuffer`) and blits one `ImageData` per
frame. This supersedes the per-particle `beginPath` / `arc` / `fill` at alpha
`44` / `16`, and with it the `record` flag — brightness is now `exposure` and
`gamma` in `main.js`. Real-time rendering got dramatically faster, as expected:
the per-particle cost is one array write.

**Tone map.** `log1p(density * exposure)`, normalised to a white point, then
`pow(t, 1/gamma)`, then a lerp from the background to the foreground colour.
Values around `exposure = .9`, `gamma = .5` were the first ones that looked
right; treat them as a starting point, not a result.

**The white point is adaptive, and that is what makes old traces fade.** It is
not the raw running maximum but a value that lags it
(`whitePoint += (max - whitePoint) * adaptation`). The lag was added for a
narrow reason: in per-frame mode the frame maximum jumps around and normalising
by it flickers.

The interesting consequence was unplanned. In accumulating mode nothing in the
buffer ever decreases, but the white point keeps rising as the densest region
grows, so every *older*, no-longer-fed region gets quieter relative to it. The
image behaves like a long exposure with a slowly closing aperture: shapes the
focal points only visited briefly sink back into the background, while the ones
still being fed stay bright. This reads as motion in a way the old fixed-alpha
accumulation never did, so it stays.

Knobs, if it ever needs taming: `adaptation` (lower = slower fade), or dropping
the normalisation entirely for a fixed white point (no fade at all, and
per-frame mode goes back to flickering).

**Resize keeps the image.** `DensityBuffer.resize` copies the overlapping
region row by row. The particles are still reallocated by `init` — only the
accumulated density survives.

# Dependencies stay minimal

Date: 2026-09-06

This is a hobby graphics sketch, not a product. Keep the dependency list short
— but "short" is the goal, not "empty". The split that matters is **which layer**
a package would land in:

**The simulation and the drawing stay dependency-free.** `Point.distance` and
`NEllipse.calcDistance` are the entire math layer; a particle framework or a
vector-math package would trade twenty lines of arithmetic for an API to learn
and a version to track. The planned post-processing (colour grading, bloom,
vignette, grain — currently done by hand in an image editor after the fact) is a
fragment-shader or offscreen-canvas job and needs no package either.

**The UI layer is fair game for a library.** The sketch is heading towards real
controls — an image-export button, a couple of sliders for the tuned constants,
input fields for focal-point coordinates and colours — and hand-rolling styled
form controls is exactly the kind of work worth outsourcing. A CSS framework
(Tailwind, Bootstrap or similar) is a reasonable addition when that UI arrives.

So the test before adding a package is not "can I avoid it" but: does it touch
the canvas loop, or the chrome around it? Chrome, yes; loop, write the fifteen
lines.

# Vite as the only devDependency

Date: 2026-09-06

The project was a bare `index.html` plus `scripts/*.js` opened from the
filesystem. It is now an npm project (`package.json`, `type: "module"`) with
**one** devDependency: Vite.

What it buys, and why the alternatives lost:

| Option | Why not |
| --- | --- |
| Keep it dependency-free, open `index.html` directly | Works, but `file://` blocks some browser APIs and there is no reload loop; also nowhere to hang future tooling |
| A plain static server (`npx serve`, `http-server`) | Solves the origin problem only — no hot reload, no production bundle |
| Webpack / Rollup / Parcel | Configuration cost for a five-module sketch |
| **Vite** | Zero-config for vanilla ES modules, hot reload while tuning constants, `npm run build` for a distributable |

`vite.config.js` sets `base: "./"` so a build in `dist/` still opens straight
from the filesystem — the one property the pre-Vite setup had that was worth
keeping. See also [Dependencies stay minimal](#dependencies-stay-minimal).

# "Simulated annealing" is a name, not an implementation

Date: 2026-09-06 (recorded retroactively; behaviour dates from the first commits)

The repository name says simulated annealing. **The code does not implement
it** — there is no energy function, no acceptance probability, no cooling
schedule, and no per-particle temperature that decays over time.

What `Particle.update` actually does: it takes the particle's error against the
n-ellipse (`NEllipse.calcDistance` — the absolute difference between the sum of
distances to all focal points and the target `d`), maps that error to a step
length, and moves the particle that far in a uniformly random direction.

```
error = |Σ distance(particle, focalPoint) − d|
step  = sqrt(error + 128) * 8 − 90
```

The step length is the only thing carrying the annealing analogy, and it is
governed by **position, not time**: on the curve the error is zero and the step
is about 0.5 px, so particles effectively freeze there; far away the step is
large and they wander. The picture emerges because the slow regions are exactly
the n-ellipse.

This matters because the obvious "fix" — adding a real cooling schedule — would
destroy the effect. The system never converges by design; it stays in permanent
motion and the image is the accumulated trace.

# The `record` mode and the tuned constants

Date: 2026-09-06 (recorded retroactively)

Several magic numbers in `main.js` and `Particle.js` are hand-tuned to the look
in the reference images, not derived from anything. They are not oversights:

| Value | Where | Role |
| --- | --- | --- |
| `128`, `8`, `90` | `Particle.update` | Step-length curve. Chosen so the step at zero error is a sub-pixel ~0.5 px. Changing any one of them changes how tightly particles hug the curve |
| `20_000` | `init` in `main.js` | Particle count. Trades frame rate for density; was 10 000 originally |
| `44` / `16` | `draw` in `main.js` | Per-particle alpha as a hex suffix. `44` for live view, `16` for the low-alpha accumulating pass |
| `3` (`tolerance`) | `particleCorrection` | Particles are recycled only once they are three screens out, so the wandering fringe stays visible |

`record` exists because the interesting output is the **accumulation**: with
canvas clearing off, thousands of near-transparent dots build up the x-ray-like
layering over many frames. It toggles itself inside `draw` in tandem with
`clearCanvas` (the `c` key) so that the first frame after switching still paints
a background, and every frame after that draws on top of the previous one.
