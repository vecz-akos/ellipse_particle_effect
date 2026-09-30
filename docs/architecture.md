# Architecture

A canvas and a control panel side by side, one `requestAnimationFrame` loop, and
a flat array of particles. There is no state container, no event bus and no
framework: every tunable lives in one `Params` instance that the panel and the
keyboard write and the loop reads, and the classes under `scripts/` are plain
data plus a method or two each. Vite serves and bundles the modules but does not
participate in the runtime.

The canvas has its own pixel size — an aspect ratio and a render resolution from
`Params` — and CSS scales it to fit the area left of the panel. Screen
coordinates and canvas coordinates are therefore different things; `main.js`
converts with `toCanvas`.

## Components

### `scripts/Point.js`

The geometry primitive: an `{x, y}` pair with `distance` (Euclidean) and
`dummyDistance` (the squared distance, no `sqrt`). Everything positional in the
project either is a `Point` or extends one.

### `scripts/NEllipse.js`

Owns the shape definition: an ordered list of `focalPoints` and a target sum of
distances `d`. An n-ellipse is the locus of points whose distances to all foci
sum to `d` — two foci give an ordinary ellipse, more give the lobed curves in
the reference images.

`addFocalPoint` prepends (so index 0 is always the newest, which is what the
mouse-follow mode steers) and gives the point a `weight` — `unit_d` unless an
explicit contribution is passed — promoting a plain `Point` to a `FocalPoint` if
needed. `d` is exactly the sum of those weights, recomputed by `recalculateD`,
so `setWeight` can change one point's contribution on its own and a weight
shared by every point sizes the whole figure.
`calcDistance(point)` returns the point's **error**: how far the sum of its
distances is from `d`. Zero means the point sits on the curve.

It knows nothing about the canvas, the mouse, or particles.

### `scripts/FocalPoint.js`

A `Point` with a `weight`: its own contribution to the target sum. Exists so a
focal point's pull can be edited in the panel after it was added.

### `scripts/Particle.js`

A `Point` that can step. `update(nEllipse, random, step)` converts its error into
a step length and moves it that far in a random direction. The mapping and its
constants (`step.offset`, `step.scale`, `step.bias`, editable in the panel) are
explained in `decisions.md`, under "Simulated annealing is a name, not an
implementation" — do not treat it as a physics integrator, there is no velocity
and no memory between frames.

### `scripts/MouseFollower.js`

Caches the last `mousemove` position. Holds its bound listener in `handler` so
`removeMouseMoveEventListener` can actually detach it.

### `scripts/Random.js`

The seeded PRNG — mulberry32 over an xmur3 hash of the seed string. `next`,
`between` and `angle` are the whole surface; `reset` restarts the stream from
the seed, which is how `init` makes a run replayable. `Random.randomSeed`
produces a short base-36 seed and is the only `Math.random` left in the project.

### `scripts/DensityBuffer.js`

The image. A `Float32Array` of `width * height` hit counts: `add(x, y)`
increments one cell and tracks the running maximum, `clear` zeroes it, `resize`
reallocates while copying the overlapping region so the accumulated image
survives a window resize. `render` maps density to colour into an `ImageData` —
`log1p(density * exposure)` normalised to a white point that lags the running
maximum (so the per-frame mode does not flicker), then a gamma curve, then a
`Gradient` sample. The curve is evaluated in `buildTable`, once per density value
rather than once per pixel, and the pixel loop only indexes that table. It knows
nothing about particles or the canvas; `main.js` does the `putImageData`.

### `scripts/Gradient.js`

The colormap: a list of `{ at, color }` stops over 0…1, and `sample(t, out)`
interpolating between the two neighbours, clamped outside the ends. Stops are
sorted here, so the panel can keep them in whatever order they were typed.
`Gradient.from` caches the parsed form against the stop list's text, because
`buildTable` asks for it every frame and the stops change only when someone edits
them. `sample` writes into a caller-owned array — it runs once per table entry.

### `scripts/Bloom.js`

The halo, and the only effect that happens before the tone map. `apply` copies
the density above a threshold into a half-resolution buffer, blurs it with three
separable box passes (a Gaussian approximation whose cost does not grow with the
radius), then adds it back to the full-resolution density and returns that buffer
together with its maximum — which is what `render` has to normalise to. It owns
its scratch buffers and recomputes everything each frame, so there is no state to
invalidate when the image is cleared.

### `scripts/PostProcess.js`

Everything that happens to the finished RGB: a vignette, then grain, in one pass
over the `ImageData` bytes — after the tone map, before `putImageData`. The
vignette fades the edge towards a base colour the caller passes in, which
`main.js` takes from the ramp at density 0. It holds
the two things worth keeping between frames: the cached vignette multiplier
(rebuilt only when the canvas or one of its settings changes) and a 256×256 noise
tile from a `Random` of its own. The grain is sampled per cell rather than per
pixel, cut so that only a set fraction of the frame gets a speck, and scaled by
how far the pixel is from the base colour, so the empty canvas stays clean. With
both effects off, `apply` returns before touching a pixel.

### `scripts/Params.js`

Every tunable in one object: canvas `aspect` and `resolution`, `particleCount`,
`tolerance`, the `step` curve constants, the tone-map settings, the `gradient`
stop list, the `bloom`, `vignette` and `grain` settings, whether the exposure is
running (`exposing`) and building up (`accumulate`), and the two overlay
toggles. `canvasSize(freeWidth, freeHeight)` turns the aspect and
resolution into the canvas' pixel size — the one place that decision is made.
`Params.aspects` and `Params.resolutions` are the dropdown contents.

### `scripts/Panel.js`

The control panel: four tabs (Parameters, Look, Render, Playback) built from
native inputs, plus a footer of four toggle buttons that sits outside the tabs
and stays visible — pause/resume, the Live/Exposure mode, and the two overlays,
which are the things a keyboard shortcut flips. The
Parameters tab runs from the settings that change the frame outright to the ones
rarely touched once a look is found: canvas, simulation, focal points, step
curve, and a reset back to the constructor defaults. The Look tab is everything
downstream of the density buffer — the tone map today, the rest of Phase 4
later. It holds no state — every control gets a `read`/`write` closure over the
`Params` instance, plus an optional callback telling `main.js` what has to be
rebuilt (canvas geometry, particles, seed). `sync` pulls every control back from
`Params`, which is how a keyboard shortcut keeps the UI honest;
`syncFocalPoints` rebuilds the focal-point rows, `syncGradientStops` the ramp's
rows, and `refreshFocalValues` follows a drag. `sync` is the whole contract for a
`Params` written from outside: values, the weight slider's range, the clamped
`sharedWeight`, which weight editor is live, and the stop list.

The one piece of state it does own is **`selectedPoint`**, the app's selected
focal point: interface state, never saved. `selectPoint` sets it from the track
selector or from a click on the canvas, `openTrack` derives that point's track,
and `main.js` reads it for follow mode, the ringed cross and the drawn track.

### `scripts/Preset.js`

The save format. `capture` collects the seed, the `Params` fields worth keeping,
the focal points and the canvas size they were placed on into one versioned
JSON document; `apply` validates a parsed document and writes it back into a
`Params` and an `NEllipse`, returning the seed and canvas size for `main.js` to
act on. `encode` and `decode` are the same document as a base64url URL hash
behind a `p1.` marker, with `strip` removing everything the defaults already say
— one schema for the file and the link, two serialisations of it. It touches no DOM
and reads no globals.

### `scripts/Animation.js`

The timeline. Owns the run state — whether the transport is playing, where the
playhead sits — and one track per focal point; the settings it runs on, duration
and loop, live in `Params` and are passed to `advance` and `seek`, the way
`Bloom` and `PostProcess` take theirs. Keeping run state off `Params` is what
stops `Preset` from saving it. **Time is
counted in simulation steps**, one unit per `step`, so a run reproduces exactly
and a paused exposure holds the timeline with it. Tracks are bound to focal
points by index: `insertTrack` and `removeTrack` follow single edits to the
figure, `syncTracks` the paths that replace it whole.

A track is an ordered list of **stations** — a position and a weight at one
absolute time, a **dwell** held there, and whether the **leg** to the next
station is straight or bends through one Bézier control point. `at` answers
where the point is at a given time, or `null` when the track has no stations,
which is the normal state and means the point stands where it was left.
`normalise` sorts and clamps every dwell to the gap before the next station; `at`
assumes it has run. It touches no DOM and has no notion of which stations are in
the past — that lock belongs to `Panel`.

`at` also reports the **phase** — dwell or leg, the station it belongs to, τ,
time since it began, its `length`, and on a leg the unit `tangent` — and that
is what a **modulator** reads. The module exports `KINDS`, `SLOTS`, `modulator`
and `modulate`: a modulator is a flat record (kind and numbers) and
`modulate(m, τ, length, seed, normal)` is a pure function returning an offset
in x, y and weight. `Animation.modulate(track, at, seed)` picks the slot in
charge — the station's own `modulation[phase]` or the track's default of the
same name — turns the tangent into the sine's normal, and seeds the noise from
the run seed, the track id, the station and the slot. Nothing holds state
between steps, so seeking equals playing.

### `scripts/main.js`

The application. Owns the canvas and its 2D context, the density buffer and its
`ImageData`, the single `Random` instance and the seed (read from and written to
the URL hash by `applySeed`), the particle array, the single `NEllipse`, `Params`
and `Panel` instances, the keyboard bindings, focal-point dragging, PNG and
preset export, the timelapse export (`exportRun`, `exportFrame`, a hidden
canvas recorded with `MediaRecorder`), and the resize handler. `resizeCanvas`
and `spawnParticles` are the two rebuild steps the panel triggers.
`particleCorrection` recycles particles that have drifted several canvases away
back to a random on-canvas position.

### `index.html` and `styles.css`

The Vite entry point is a flex `body`: a `.stage` that centres the canvas, and
the panel that `Panel.js` appends beside it. All styling lives in `styles.css` —
hand-written, no framework, a dark surface with one accent colour.

## Frame flow

```
requestAnimationFrame
   └─ update()
       ├─ steeredPoint() >= 0 ? the selected focal point ← mouse, in canvas pixels
       ├─ exportRun ? exportFrame()                ← stepsPerFrame × step(), render, capture to the hidden canvas
       ├─ else exposing ? step()                   ← and raise needsRender
       │    ├─ applyTracks()                              ← Animation.at + modulate, before anything moves
       │    ├─ for each particle:
       │    │     error = nEllipse.calcDistance(particle)   ← NEllipse
       │    │     particle steps by f(error) in a seeded random direction ← Particle, Random
       │    │     particleCorrection(particle)              ← recycle if far off-screen
       │    ├─ accumulate ? keep the buffer : density.clear()
       │    ├─ density.add(x, y) for each particle          ← DensityBuffer
       │    └─ animation.playing ? animation.advance()      ← Animation, one unit per step
       ├─ needsRender ? render()
       │    ├─ bloom ? density + blurred density      ← Bloom, in linear space
       │    ├─ density.render(imageData)              ← DensityBuffer + Gradient
       │    ├─ post.apply(imageData.data)             ← vignette, then grain
       │    ├─ putImageData
       │    └─ showFocalPoints ? stroke a cross at each focus
       └─ the hash is due ? writeHash()
```

**Stepping the exposure and drawing the image are separate.** `step` is what
`exposing` gates; `render` runs whenever `needsRender` has been raised — by a
step, or by anything else that changes the picture. With the exposure paused and
nothing touched, a frame costs nothing at all, and every control on the Look tab
still repaints the finished image immediately. The flag is raised by
`markStateChanged` (which also schedules the debounced hash write) and, for the
per-frame stepping path, directly.

A window resize, or an aspect/resolution change in the panel, recomputes the
canvas size; if it actually changed, the density buffer is resized and the
particles are respawned from the seed. The two differ in what happens to the
accumulated image: a window resize keeps it, since `resize` copies the
overlapping region, while an aspect or resolution change clears it — the
density is resolution-specific, and the panel path is a deliberate choice of a
new pixel size. Nothing cancels the loop any more.

## What is absent today

All of these are planned; see `docs/roadmap.md` for the order and the reasoning.

- **No re-render at size.** PNG export writes the canvas at its current
  resolution. A seed does not survive a resolution change — the simulation is in
  pixels — so "preview small, render at print size" is Phase 6, by scaling the
  step curve rather than by normalising coordinates.
- **No cheap preview.** Phase 4 landed whole, and bloom costs 23 ms a frame at
  1080p and 78 ms at 4K on the machine it was written on. Tuning a look at 4K is
  not interactive; splitting a reduced-resolution preview from a full-quality
  export is the open question, measured under T19 in `docs/task-list.md`.
- **No animation.** Focal points move only when dragged; paths, a timeline and
  timelapse export are Phase 5.
