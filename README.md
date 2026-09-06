# ellipse_particle_effect

A generative-graphics sketch. Twenty thousand particles wander a canvas, taking
steps whose length depends on how far they are from an *n-ellipse* — the curve
where the distances to every focal point sum to a fixed value. Near the curve
the steps shrink to sub-pixel, so particles effectively freeze there; elsewhere
they roam. Drawn at low alpha and left to accumulate, the traces build up into
orbit-like, x-ray-looking images. Move the mouse and add focal points to steer
the shape.

| Component | Role |
| --- | --- |
| `scripts/Point.js` | `{x, y}` plus distance helpers |
| `scripts/NEllipse.js` | focal points, target distance sum, per-point error |
| `scripts/Particle.js` | a `Point` that steps according to its error |
| `scripts/MouseFollower.js` | caches the cursor position |
| `scripts/main.js` | canvas, animation loop, keyboard controls |

## Quick start

```powershell
npm install
npm run dev        # dev server with hot reload
npm run build      # bundle into dist/, openable straight from the filesystem
```

Vite is the only dependency, and it is a devDependency — the sketch itself is
plain ES modules and Canvas 2D.

## Controls

| Key | Effect |
| --- | --- |
| `space` | pause / resume the simulation |
| `c` | toggle canvas clearing — off means the image accumulates |
| `s` | show / hide a cross at each focal point |
| `+` | add a focal point at the cursor |
| `-` | remove the most recently added focal point |
| `f` | make the newest focal point follow the mouse |

Turn clearing off with `c` and let it run: that is where the finished images
come from.

## Documentation

| Doc | What it covers |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | the modules and how a frame flows through them |
| [docs/decisions.md](docs/decisions.md) | why the project looks like this, including what the name gets wrong |
| [AGENTS.md](AGENTS.md) | conventions and traps, for AI agents |
