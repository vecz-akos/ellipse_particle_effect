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

### `scripts/main.js`

The application. Owns the canvas and its 2D context, the particle array, the
single `NEllipse` instance, all the toggle flags (`animate`, `clearCanvas`,
`record`, `showFocalPoints`, `followFocalPoint`), the keyboard bindings, and the
resize handler. `particleCorrection` recycles particles that have drifted
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
       │     particle steps by f(error) in a random direction   ← Particle
       │     particleCorrection(particle)              ← recycle if far off-screen
       └─ draw()
            ├─ clearCanvas || !record ? fill background
            ├─ fill each on-screen particle at alpha 44 (live) or 16 (accumulating)
            └─ showFocalPoints ? stroke a cross at each focus
```

Resize cancels the pending frame, re-runs `init` (which reallocates every
particle at a random position) and restarts the loop — so resizing discards any
accumulated image.

## What is deliberately absent

- **No off-screen buffer.** The accumulated image lives only in the visible
  canvas; there is no export path yet, screenshots are taken by hand.
- **No post-processing.** The colour grading, bloom, vignette and grain in the
  reference images under `../imgs/` were applied afterwards in an image editor.
  Bringing them in-app is the next planned step.
- **No UI.** Every control is a single keypress; see `README.md`.
