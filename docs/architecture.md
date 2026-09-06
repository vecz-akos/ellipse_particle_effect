# Architecture

A single canvas filling the viewport, one `requestAnimationFrame` loop, and a
flat array of particles. There is no state container, no event bus and no
framework: `main.js` owns every mutable variable and the four classes under
`scripts/` are plain data plus one method each. Vite serves and bundles the
modules but does not participate in the runtime.

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
mouse-follow mode steers) and grows `d` by `unit_d` unless an explicit
contribution is passed; `removeFocalPoint` is the inverse. `calcDistance(point)`
returns the point's **error**: how far the sum of its distances is from `d`.
Zero means the point sits on the curve.

It knows nothing about the canvas, the mouse, or particles.

### `scripts/Particle.js`

A `Point` that can step. `update(nEllipse)` converts its error into a step
length and moves it that far in a random direction. The mapping and its
constants are explained in `decisions.md`, under "Simulated annealing is a name,
not an implementation" — do not treat it as a physics integrator, there is no
velocity and no memory between frames.

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
lerp between the background and foreground colour. It knows nothing about
particles or the canvas; `main.js` does the `putImageData`.

### `scripts/main.js`

The application. Owns the canvas and its 2D context, the density buffer and its
`ImageData`, the single `Random` instance and the seed (read from and written to
the URL hash by `applySeed`), the particle array, the single `NEllipse`
instance, all the toggle flags (`animate`, `clearCanvas`, `showFocalPoints`,
`followFocalPoint`) and the tone-map parameters (`exposure`, `gamma`), the
keyboard bindings, and the resize handler. `particleCorrection` recycles particles that have drifted
several screens away back to a random on-screen position.

### `index.html`

The Vite entry point. Carries the whole stylesheet inline — three rules to kill
margins and make the canvas fill the page — and a single module `<script>`.
There is no separate CSS file.

## Frame flow

```
requestAnimationFrame
   └─ update()
       ├─ followFocalPoint ? focalPoints[0] ← mouse position
       ├─ for each particle:
       │     error = nEllipse.calcDistance(particle)   ← NEllipse
       │     particle steps by f(error) in a seeded random direction ← Particle, Random
       │     particleCorrection(particle)              ← recycle if far off-screen
       └─ draw()
            ├─ clearCanvas ? density.clear()
            ├─ density.add(x, y) for each particle    ← DensityBuffer
            ├─ density.render(imageData) + putImageData
            └─ showFocalPoints ? stroke a cross at each focus
```

Resize cancels the pending frame, re-runs `init` (which reallocates every
particle at a random position, and resizes the density buffer) and restarts the
loop. The accumulated density survives the resize; the particles do not.

## What is absent today

All three of these are planned; see `docs/roadmap.md` for the order and the
reasoning.

- **No export path.** The density buffer holds the image, but there is no way to
  save it at a different resolution; screenshots are taken by hand.
- **No post-processing.** The colour grading, bloom, vignette and grain in the
  reference images under `../imgs/` were applied afterwards in an image editor.
- **No UI.** Every control is a single keypress; see `README.md`.
