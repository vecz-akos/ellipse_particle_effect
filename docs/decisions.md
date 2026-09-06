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
