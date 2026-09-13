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

## Phase 3 — Control panel — **done**

Landed: the docked panel with its three tabs, the `Params` object the panel and
the keyboard share, every parameter above live-editable, per-point focal weights
and canvas dragging, the aspect/resolution dropdowns, and PNG save. See "Control
panel, and the canvas as a render target" in `docs/decisions.md`.

Presets landed too: `scripts/Preset.js` and the Render tab's Presets section
save and load the whole state as JSON. See "Presets are a JSON file, and the
file is not trusted" in `docs/decisions.md`.

The URL hash carries the whole state now, encoded with the same schema —
seed-only links from before still load. See "The URL hash is a preset" in
`docs/decisions.md`.

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

## Phase 4 — Post-processing in-app — **done**

Replaces the manual image-editor pass that finished images used to need. That
pass was, almost exactly, a gradient colormap over density plus bloom — so this
phase is less "add effects" than "stop doing by hand what the density buffer
already has the information for".

**The phase is finished on its own terms: finished images now come out of the
app**, produced entirely in the browser with no editor afterwards. The design
prediction below held — the
bloom halo lands lower on the ramp than the core and takes the ramp's middle
colour by itself, which is what makes a two-tone glow fall out of a single
gradient rather than needing a second pass.

What landed, with the entries that explain each: the **Look tab** (4.0), the
**gradient colormap** (T16), **vignette and grain in one RGB pass** (T17),
**bloom into the density before the tone map** (T18), the **exposure/redraw
split** so a held image can be graded (T20), the **benchmark** (T22), and the
**post-pass skips** that made it 19% cheaper (T21). T19 measured the chain and
T7 was measured, un-parked and parked again — see "The browser is not slow, and
that is the answer T7 was waiting for" in `docs/decisions.md`.

The original plan follows, for context.

### 4.0 — A tab of its own — **done**

The tone map controls (`exposure`, `gamma`, `adaptation`, and the two colours)
left the Parameters tab for the **Look** tab, second of four, between Parameters
and Render. Every effect below lands there too. Parameters keeps what shapes the
simulation; Look keeps what turns density into a picture. See "A Look tab,
because grading happens after the image exists" in `docs/decisions.md`.

This first step moved controls and changed no maths — it is the one part of the
phase with no visual consequence, so it was not tangled up with a change that
has one.

### The pipeline

```
density buffer (Float32, linear)
   ├─ bloom: blurred copy of the density, added back      ← linear space
   ↓
tone map + colormap  (log → white point → gamma → ramp)   ← the LUT
   ↓ RGB
vignette
   ↓
grain                                                     ← last
   ↓
ImageData → putImageData
```

**Bloom goes before the tone map, not after** — an earlier version of this
roadmap said the opposite and was wrong. Bloom is light spilling, so it belongs
in linear space: blur the density, add it back to the density, then tone-map the
sum. Blurring the finished 8-bit RGB instead spreads already-clipped, already
quantised values and comes out flat and grey. The orange haze around the bright
curves is exactly what "blur the density, then send the
sum through the same log curve and ramp" produces — the halo lands lower on the
ramp than the core, so it takes the ramp's middle colour on its own.

Grain stays last: put it before the blur and it gets smeared into texture rather
than reading as grain.

### The effects

| Effect | Where | Controls |
| --- | --- | --- |
| **Tone map** | existing | exposure, gamma, adaptation — moved, not changed |
| **Gradient colormap** | inside the LUT | **done** — `scripts/Gradient.js`, stop list on the Look tab |
| **Bloom** | on density, pre-tone-map | **done** — radius, strength, threshold |
| **Vignette** | RGB | **done** — amount, radius, softness |
| **Grain** | RGB, last | **done** — amount, monochrome/colour, static or animated |

**The gradient colormap** replaced the two-colour background→foreground lerp
with a ramp of several stops, so a black → orange → white grading is a setting
rather than a post-process. See "A colour ramp instead of two colours" in
`docs/decisions.md`.

It was scheduled late here and was **pulled forward to 4.1**: it is the cheapest
of the four and the highest-impact. `buildTable` already existed and already ran
once per density value, so it was a different body for one loop and no change at
all to the pixel loop — T3 built the slot for it on purpose. It also had to come
first for a reason the effects below depend on: bloom takes its colour from the
middle of the ramp, so there has to be a ramp before a halo is worth looking at.

The remaining order is **4.1 colormap, 4.2 vignette + grain, 4.3 bloom, 4.4
measure** — broken into T16–T19 in `docs/task-list.md` and its archive.

### Traps worth knowing before starting

**Bloom breaks the assumption that makes the LUT fast.** `DensityBuffer` indexes
its colour table by density *because density is an integer* — every `add` is a
`+= 1`. A blurred float added into it is not. Do not answer this by going back to
per-pixel `log1p`/`pow`; that undoes the measured win recorded in
"Density-to-colour lookup table" in `docs/decisions.md`. Truncating the sum back
to an integer index (`table[(d + bloom)|0]`) keeps the table and costs one add
and one truncation per pixel — the quantisation error is far below one step of
the ramp anywhere the eye can see it.

**Grain must not draw from the simulation's RNG.** Everything random in the
simulation comes from the single seeded `Random`, and the seed only reproduces an
image because the stream is consumed in a fixed order. Grain is a render effect,
not part of the simulation: pulling from that stream would make the picture
depend on how many frames were rendered. Give it its own `Random`, or hash the
pixel index with the seed.

**This phase makes the render loop heavier, which puts T7 back on the table.**
*(Written before the phase landed. It did put T7 back on the table, and the
answer turned out to be no.)* T7 was un-parked by T19's numbers, then parked
again for a different reason than the one it was originally parked for: **the
browser is not slow.** Grading a held image redraws with no perceptible lag, and
T7 cannot help grading anyway — a render-parameter change dirties every pixel by
definition. Its remaining benefit is to the running exposure, which nobody
watches. Phase 5 or Phase 6 would revive it; nothing else will.

**Resolved: the post-process stays on the CPU.** The open question here was
whether to move the whole render to a WebGL fragment shader, with "revisit if
bloom alone makes the preview unusable" as the trigger. It does not, so CPU
stands and the one-render-path property is kept. Do not reopen this without a
new measurement and a felt problem.

**Still open, and deliberately not a task yet: splitting live from export** — a
cheaper preview while tuning, full quality only on save. Bloom leaves a floor
neither T7 nor T21 removes: ~19 ms a frame at 1080p and ~77 ms at 4K. That does
not hurt today at 1080p, so the work would be speculative. See the note under
Phase 5, which is what will trigger it.

---

## Phase 5 — Focal-point animation and playback

The furthest out, and the most open-ended. Rewritten after Phase 4: the earlier
version was drafted before the exposure and the redraw were separated, and half
of what it left unresolved is now already built.

### Why it exists

Today the only way to move a focal point is to drag it with the cursor while the
exposure runs. That is how the good images get made, and it has one bad
property: **the gesture is the artwork, and it cannot be edited.** One clumsy
movement is burned into an exposure that took minutes to build, with no undo and
no way to try the same motion slightly differently.

Paths fix that first and reproducibility second. Once a motion is data rather
than a gesture, it can be nudged, re-timed and re-run — and because everything
random already comes from a seeded `Random`, a seed plus a set of paths is a
**fully reproducible film**, which is what makes timelapse export worth having.

### What Phase 4 already provides

The old "unresolved" question — whether an animation frame should accumulate a
fixed number of simulation steps or run in real time — is mostly answered.
**T20 split stepping from rendering**, so "step the simulation N times, then
render once" already exists as a separable thing, and rendering is change-driven
rather than tied to the run state. Phase 5 does not have to decide this; it has
to use it. What remains is the smaller question of which mode the *timeline*
runs in: real time while scrubbing, fixed-step while exporting.

### The words this phase uses

Fixed vocabulary, because the parts are easy to mix up — a **dwell** in
particular is the *opposite* of movement, not a kind of it.

| word | what it is | does the point move? |
| --- | --- | --- |
| **station** | a position and a weight, at one time on the timeline | — |
| **leg** | the transition between two stations; position and weight interpolate across it | yes, as planned |
| **dwell** | the time spent held at a station; position and weight stay put | no |
| **phase** | collective noun: a leg or a dwell | — |
| **track** | one focal point's whole plan — a sequence of stations | — |
| **modulation** | a wobble added on top of wherever the point already is | yes, off-plan |

A track alternates in time, always: `dwell → leg → dwell → leg → dwell`. **Path**
means a whole track's shape; the piece between two stations is a **leg** — the
two are not interchangeable, and calling both "path" is what makes this confusing
to talk about.

Modulation sits perpendicular to all of it. It does not change the plan, it
perturbs the result — at amplitude zero, exactly the stations remain.

### What gets animated

- **Position**, along a leg: a straight segment or a Bézier curve, with control
  points dragged on the canvas and the numbers in the panel.
- **Weight**, on the same timeline. This is not a lesser feature than position —
  animating a point's weight changes `d`, so the figure **breathes** in place
  rather than travelling, which is a different family of images entirely.
  Breathing is the weights *differing*, so it lives in Manual weight mode; with
  the shared Weight slider in charge, it sizes every station along with every
  point (see decisions.md, "The shared weight is one number…").
- **Dwell.** A track is legs *and* holds: stand still at a station for a given
  time so the figure settles and the exposure builds density there. Without
  dwell, a moving focus draws an even smear; with it, the stations become the
  bright structure.
- **Modulation** — a layer *on top of* the plan, not an alternative to it. The
  track gives the trajectory, the modulation gives it character, and they
  compose. Several kinds, all sharing an **amplitude** control so they can be
  dialled to nothing:

  | kind | parameters | what it gives |
  | --- | --- | --- |
  | sine | amplitude, waves | a predictable wave: up and down on a dwell, perpendicular to the leg on a leg — the point weaves instead of sliding |
  | orbit (two sines, on x and y) | amplitude, two wave counts | circles and Lissajous figures through the station; a point can orbit while the leg carries it |
  | smooth random drift | amplitude, how fast it wanders | organic drift that never repeats but is not twitchy |
  | per-frame tremor | amplitude | the actual shake — small, fast, and the least predictable |
  | weight pulse | amplitude, waves | the figure breathes on a timer rather than along a leg |

  Every one of them is a **pure function of time since the phase began and a
  seed** — never a state carried from the previous step. A drift written as a
  random walk cannot be seeked and cannot be reproduced; written as seeded value
  noise it can be both. **Built on dwells (T25) — see "Modulators are functions
  of phase time" and "Waves per dwell" in `docs/decisions.md`;** legs are T26.
  The periodic kinds count waves per phase, so a whole number returns the point
  to the station as the hold ends; amplitudes are pixels; the drift is a sum of
  seeded sines, the tremor a hash of the step.

  Predictable and random are both wanted, so treat this as a small set of
  interchangeable modulators rather than one "jitter" slider.

**A modulator belongs to a phase, not to a track.** This is the one structural
decision in the modulation design, and it follows from what the two phases are:

- **During a dwell the point is standing still.** Unmodulated it burns a dead
  spot. What is wanted here is trembling, small orbiting, a weight pulse — the
  point keeps drawing *in one place*, which is where the bright detail comes
  from. This is the most valuable place a modulator can sit.
- **During a leg the point is already moving.** Here a modulator shapes the
  *trajectory* — a perpendicular wave, an orbit carried along the line. Different
  amplitude, different frequency, different intent.

Setting one modulator for a whole track would force those two to share numbers,
and the compromise is worse than either. So each dwell and each leg may carry its
own, with a **track-level default that phases inherit** and can override — so a
twenty-phase track is not twenty forms to fill in, but the places that matter can
differ.

**Every random modulator draws from its own `Random`, never the simulation's** —
the same rule grain follows. Pulling from the simulation stream would make the
particle motion depend on how long the animation ran, and a seed would stop
reproducing a film.

Worth considering later, not now: the **step-curve constants** on the timeline.
Animating `bias` changes how tightly particles hug the curve, so the figure could
sharpen and dissolve over a run — the strongest remaining knob, and the one most
likely to break the look if it is animated carelessly. Look parameters
(exposure, ramp, bloom) should **not** animate for a still image, since grading
is meant to happen after the exposure; for video they are fair game, because
each frame is graded independently. Keep the two cases apart.

### Settled: focal points do not appear or disappear

**The set of focal points is fixed for the length of an animation.** Points can
move and their weights can change, but none is added or removed on the timeline.
Decided rather than deferred, so a path implementation can assume a stable list.

**The workaround that looks obvious does not work, and this is worth stating
plainly because it is easy to believe otherwise.** Animating a weight down to 0
is *not* close to removing the point. `NEllipse.calcDistance` sums **every**
focal point's distance regardless of its weight; the weight feeds only `d`. So a
point at weight 0 still pulls at full strength — and worse, it **shrinks the
figure**, because its distance joins the sum while contributing nothing to the
target it is compared against. Weight 0 is the opposite of absent: it is a point
that constrains the curve without paying for any of it.

That is not a defect. Weight 0 is a legitimate and interesting setting — an
anchor that shapes the figure without enlarging it — and it stays available. It
simply is not an "off switch", and nothing in Phase 5 should treat it as one.

Real appearance and disappearance would need a per-point factor on the
**distance** term, not the weight — a change to `calcDistance`, the one piece of
maths the entire sketch rests on. **Not planned.** If it is ever wanted, it is
its own decision with its own entry, not a detail of path work.

### The Playback tab

**Built (T23, T23b, T24, T25), apart from the leg modulators.** Duration,
play/pause, loop or one-shot and a scrub are on the tab, and below them the open
point's track: a Dwell modulation block with the track's default, a station list
with times, positions, weights, dwells and a per-station modulation override, a
mini time bar, a curve toggle per leg, and stations draggable on the canvas. The
clock counts simulation steps rather than milliseconds, so pausing the exposure
pauses the timeline. See "The animation clock counts steps", "Stations are the
track" and "Modulators are functions of phase time" in `docs/decisions.md`. What
is left on this tab is the **leg slot** (T26).

**It stays in the right-hand panel. There is no timeline strip along the bottom
of the window.** A bottom strip is where an editor puts time when it wants to
show *proportions* across many tracks at once; what this tab needs is an ordered
list, which reads better in a narrow tall column than in a wide short one. The
panel is not a compromise here, it is the better shape for the model below.

**One global time.** Every track lives in the single `params.animation.duration`
already on the tab, and station times are absolute steps within it. A track whose
last station comes early simply holds there to the end. Station times **snap to
other tracks' station times**, so points can be made to arrive together without
typing matching numbers — which is what makes a figure move as one rather than as
several independent points.

**The station list *is* the track — legs are not separately creatable.** If
stations and legs were both things you add, the tab could hold nonsense: a leg
with no endpoint, a gap between two stations, an ambiguous order. Instead each
row is a station carrying two things, what happens *here* and how it gets to the
*next* one:

```
1  (960, 540)  w 300   dwell 90
   ↓ curve, 240 steps
2  (1240, 400) w 380   dwell 0
   ↓ straight, 180 steps
3  …
```

A leg then cannot exist half-made, deleting a station rejoins its neighbours on
its own, and there is no second list to keep in step. The last station has no
"to next" — in loop mode it joins back to the first.

**Selection, not nesting.** Tab → section → point → station → fields is four
levels of accordion in a narrow column, and unusable by the third. One track is
open at a time: a track selector above, that track's stations below. The
**canvas is also the selector** — `pickFocalPoint` in `scripts/main.js` already
does the hit test, so clicking a point to open its track is nearly free, and the
same selection then drives both the Bézier handles on the canvas and the numbers
in the panel. Selection is **interface state, not `Params`** — the same category
as `showFocalPoints` and `followFocalPoint`, which are deliberately not saved.

**A per-track mini time bar.** An ordered list shows sequence but not proportion:
nothing in it says whether station 2 falls early or late, or whether two tracks
coincide. A ~16px strip in each track's header — dwells as blocks, legs as lines,
a marker at the current time, click to seek — fits the panel width and gives back
the one thing a bottom strip would have provided. Stacked, several tracks' strips
show at a glance what lines up.

The canvas carries the *spatial* view alongside it: the track's curve, markers at
the stations, and a dot at the current time.

**No track is the normal state, and it must stay usable.** Most points will never
be animated; a point without a track simply stands where it is, and the existing
by-hand workflow is unchanged. The list therefore opens on "no track — Add
station", not on an empty form.

### Editing rules on the Playback tab

Two rules, both from the user, and both with a reason worth keeping:

- **Editing only while the timeline is stopped.**
- **A station the timeline has already passed cannot be edited.** To change one,
  scrub back to it first.

The second looks like a restriction and is actually honesty: **the exposure
accumulates.** What is already burned into the image cannot be un-burned, so a
panel that let a past station be rewritten would state one thing while the image
showed another, silently. Locking it keeps the plan and the picture the same
object.

Four consequences the implementation has to get right:

- **The lock is in the interface, not in the data.** `Animation` has no notion of
  a past; presets and the URL restore every station regardless. Only the panel
  refuses the edit — do not bake this into the model.
- **A leg in progress is half locked.** With the clock between two stations, the
  origin is past and frozen while the destination is future and editable. So a
  point can be re-aimed mid-flight, which falls out of the rule for free and is
  worth keeping rather than special-casing away.
- **Scrubbing back does not clear the image.** Re-running a stretch draws over
  what is already there — sometimes deliberately, to brighten a trace by
  repeating it. The tab has to say so, because it is otherwise a surprise.
  Clearing stays a separate, explicit action.
- **This settles the two-writers trap** that path work would otherwise walk into:
  a point under animation and a point under the cursor are two writers of one
  position. With editing confined to a stopped timeline there is only ever one —
  while playing, dragging writes nothing; while stopped, dragging moves the
  selected station. The one gap is dragging while the clock sits mid-leg, where
  there is no station to move: refuse it, and say to scrub onto a station.

Everything else follows the rule the rest of the panel follows: every tunable
lives in `Params`, and `Panel.sync()` restores all of it.

### Timelapse export, and what it will force

`MediaRecorder` over a `canvas.captureStream()`. Watching the image build is at
least as good as the final frame, and with paths it is repeatable.

**This is what will trigger the live/export split left open in Phase 4.** An
export renders hundreds of frames back to back, so a frame's cost stops being a
comfort question and becomes wall-clock time. The cheap thing to get right now,
while there is still only one consumer of the render path: **make the export
loop call a render that takes its settings as arguments**, rather than one that
renders "the current state" from module scope. Splitting live from export
afterwards is then a matter of passing different settings, instead of untangling
two callers that both assumed the global one.

The trap that comes with it: **the effects are parameterised in pixels.** Bloom
radius, grain cell size and the vignette mask are all resolution-dependent, so a
reduced-resolution preview does not look like the full-resolution export unless
they scale with it. That is the same class of problem as Phase 6's supersampling
— pixel-valued parameters that have to move with the canvas — and the two should
share one rule rather than inventing it twice.

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
