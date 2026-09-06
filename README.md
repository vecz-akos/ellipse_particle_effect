# ellipse_particle_effect

A generative-graphics sketch. Twenty thousand particles wander a canvas, taking
steps whose length depends on how far they are from an *n-ellipse* — the curve
where the distances to every focal point sum to a fixed value. Near the curve
the steps shrink to sub-pixel, so particles effectively freeze there; elsewhere
they roam. Every hit is counted into a density buffer and tone-mapped to the
screen, so the traces build up into orbit-like, x-ray-looking images. Move the
mouse and add focal points to steer the shape.

| Component | Role |
| --- | --- |
| `scripts/Point.js` | `{x, y}` plus distance helpers |
| `scripts/NEllipse.js` | focal points, target distance sum, per-point error |
| `scripts/Particle.js` | a `Point` that steps according to its error |
| `scripts/MouseFollower.js` | caches the cursor position |
| `scripts/DensityBuffer.js` | per-pixel hit counts, and the tone map that turns them into an image |
| `scripts/Random.js` | the seeded PRNG every random step comes from |
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
| `c` | toggle buffer clearing — off means the image accumulates |
| `s` | show / hide a cross at each focal point |
| `+` | add a focal point at the cursor |
| `-` | remove the most recently added focal point |
| `f` | make the newest focal point follow the mouse |
| `r` | roll a new seed and restart from an empty image |

Turn clearing off with `c` and let it run: that is where the finished images
come from. Regions the focal points stopped feeding fade back over time — the
tone map normalises to a white point that keeps rising with the densest area,
so a long run behaves like an exposure with a slowly closing aperture.

## Seeds

The run is driven by a seeded PRNG, and the seed is in the URL hash — copy the
link and you get the same image back. `r` rolls a new seed. Reproducibility
holds for a given window size, and stops the moment you steer the shape with the
mouse.

## Documentation

| Doc | What it covers |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | the modules and how a frame flows through them |
| [docs/decisions.md](docs/decisions.md) | why the project looks like this, including what the name gets wrong |
| [docs/roadmap.md](docs/roadmap.md) | where it is going next, in dependency order |
| [AGENTS.md](AGENTS.md) | conventions and traps, for AI agents |
