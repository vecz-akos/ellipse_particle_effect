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

### `scripts/PostProcess.js`

Everything that happens to the finished RGB: a vignette, then grain, in one pass
over the `ImageData` bytes — after the tone map, before `putImageData`. The
vignette fades the edge towards a base colour the caller passes in, which
`main.js` takes from the ramp at density 0. It holds
the two things worth keeping between frames: the cached vignette multiplier
(rebuilt only when the canvas or one of its settings changes) and a 256×256 noise
tile from a `Random` of its own, read at a per-frame offset when the grain is
animated. With both effects off, `apply` returns before touching a pixel.

### `scripts/Params.js`

Every tunable in one object: canvas `aspect` and `resolution`, `particleCount`,
`tolerance`, the `step` curve constants, the tone-map settings, the `gradient`
stop list, the `vignette` and `grain` settings, and the four mode toggles. `canvasSize(freeWidth, freeHeight)` turns the aspect and
resolution into the canvas' pixel size — the one place that decision is made.
`Params.aspects` and `Params.resolutions` are the dropdown contents.

### `scripts/Panel.js`

The control panel: four tabs (Parameters, Look, Render, Playback) built from
native inputs, plus a footer with the four mode toggles that sits outside the
tabs and stays visible — those are the ones a keyboard shortcut flips. The
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

### `scripts/Preset.js`

The save format. `capture` collects the seed, the `Params` fields worth keeping,
the focal points and the canvas size they were placed on into one versioned
JSON document; `apply` validates a parsed document and writes it back into a
`Params` and an `NEllipse`, returning the seed and canvas size for `main.js` to
act on. `encode` and `decode` are the same document as a base64url URL hash
behind a `p1.` marker, with `strip` removing everything the defaults already say
— one schema for the file and the link, two serialisations of it. It touches no DOM
and reads no globals.

### `scripts/main.js`

The application. Owns the canvas and its 2D context, the density buffer and its
`ImageData`, the single `Random` instance and the seed (read from and written to
the URL hash by `applySeed`), the particle array, the single `NEllipse`, `Params`
and `Panel` instances, the keyboard bindings, focal-point dragging, PNG and
preset export, and the resize handler. `resizeCanvas` and `spawnParticles` are the two rebuild
steps the panel triggers. `particleCorrection` recycles particles that have
drifted several canvases away back to a random on-canvas position.

### `index.html` and `styles.css`

The Vite entry point is a flex `body`: a `.stage` that centres the canvas, and
the panel that `Panel.js` appends beside it. All styling lives in `styles.css` —
hand-written, no framework, a dark surface with one accent colour.

## Frame flow

```
requestAnimationFrame
   └─ update()
       ├─ followFocalPoint ? focalPoints[0] ← mouse position, in canvas pixels
       ├─ for each particle:
       │     error = nEllipse.calcDistance(particle)   ← NEllipse
       │     particle steps by f(error) in a seeded random direction ← Particle, Random
       │     particleCorrection(particle)              ← recycle if far off-screen
       └─ draw()
            ├─ clearCanvas ? density.clear()
            ├─ density.add(x, y) for each particle    ← DensityBuffer
            ├─ density.render(imageData)              ← DensityBuffer + Gradient
            ├─ post.apply(imageData.data)             ← vignette, then grain
            ├─ putImageData
            └─ showFocalPoints ? stroke a cross at each focus
```

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
  pixels — so "preview small, render at print size" needs the normalised
  coordinate space discussed in `decisions.md`.
- **No presets.** The URL hash carries the seed only; the rest of `Params` is
  not serialised.
- **No post-processing.** The colour grading, bloom, vignette and grain in the
  reference images under `../imgs/` were applied afterwards in an image editor.
