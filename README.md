# ellipse_particle_effect

A generative-graphics sketch. Twenty thousand particles wander a canvas, taking
steps whose length depends on how far they are from an *n-ellipse* — the curve
where the distances to every focal point sum to a fixed value. Near the curve
the steps shrink to sub-pixel, so particles effectively freeze there; elsewhere
they roam. Every hit is counted into a density buffer and tone-mapped to the
screen, so the traces build up into orbit-like, x-ray-looking images. Drag the
focal points around, or add new ones, to steer the shape; a panel on the right
edits everything else live.

| Component | Role |
| --- | --- |
| `scripts/Point.js` | `{x, y}` plus distance helpers |
| `scripts/FocalPoint.js` | a `Point` with its own weight in the target sum |
| `scripts/NEllipse.js` | focal points, target distance sum, per-point error |
| `scripts/Particle.js` | a `Point` that steps according to its error |
| `scripts/MouseFollower.js` | caches the cursor position |
| `scripts/DensityBuffer.js` | per-pixel hit counts, and the tone map that turns them into an image |
| `scripts/Gradient.js` | the colour ramp density is mapped through |
| `scripts/Bloom.js` | the halo, blurred into the density before the tone map |
| `scripts/PostProcess.js` | the vignette and the grain, over the finished pixels |
| `scripts/Random.js` | the seeded PRNG every random step comes from |
| `scripts/Params.js` | every tunable in one object, and the canvas sizing rule |
| `scripts/Panel.js` | the control panel on the right |
| `scripts/Preset.js` | the JSON save format, and the validation on load |
| `scripts/Animation.js` | the timeline, and one track per focal point |
| `scripts/main.js` | canvas, animation loop, keyboard controls |
| `bench/bench.js` | what each render stage costs per frame; tooling, not part of the sketch |

## Quick start

```powershell
npm install
npm run dev        # dev server with hot reload
npm run build      # bundle into dist/, openable straight from the filesystem
npm run bench      # what the render chain costs per frame, stage by stage
```

Vite is the only dependency, and it is a devDependency — the sketch itself is
plain ES modules and Canvas 2D.

## The panel

A fixed column on the right; the canvas gets the rest of the window and is
scaled to fit it whole.

- **Parameters** — canvas aspect and render resolution; particle count and
  recycle tolerance; the focal points — one shared weight to resize the whole
  figure, or a per-point coordinate and weight for each; the step-curve
  constants; and at the very bottom, **Reset parameters** — every field back to
  its startup value with one centred focal point, keeping the seed.
- **Look** — everything between the density buffer and the pixels: the colour
  ramp first, since that is where grading starts, then bloom, the tone map
  (exposure, gamma, adaptation), a vignette and film grain. Bloom, vignette and
  grain are off until you turn them on, and cost nothing while they are. None of
  it touches the simulation, so the usual way to work is to let an image build up
  first and grade it afterwards. They cost frame rate while the exposure runs —
  the vignette and the grain more than bloom, and all of it more at 4K — but a
  stopped exposure is redrawn only when you change something, so grading a
  finished image stays responsive.
- **Render** — the seed (type one and apply it, or roll a new one), PNG save at
  the current canvas resolution, and presets as JSON. The URL follows the state
  on its own; the preset file is for keeping one on disk.
- **Playback** — the timeline: a duration, play/pause, loop or one-shot, and a
  scrub. Nothing moves along it yet — focal-point paths and modulators are the
  next two steps of Phase 5.

Four buttons sit in a strip at the bottom of the panel, outside the tabs, so
they are visible whichever tab is open: **Pause / Resume** and the
**Live / Exposure** mode above, the two overlay toggles below. They mirror the
keyboard. The mode button is named for the state it is in; the pause button for
what pressing it does.

**Recycle tolerance** is how far past the canvas a particle may drift before it
is teleported back to a random point on it, measured in canvases and applied
equally on all four sides. Particles outside the canvas are still simulated and
can wander back, so a lower value collects them sooner and tightens the image;
`0` recycles a particle the moment it leaves the visible area.

**Aspect and resolution are separate on purpose.** The simulation works in
pixels, so the render resolution is part of the look: the same seed at 4K is a
different image from the same seed at 1080p, not a bigger one. The panel shows
the resulting pixel size under the dropdowns. Changing either one starts a new
image, since the accumulated density belongs to the resolution it was drawn at;
resizing the window keeps what has built up so far.

## Controls

Keyboard shortcuts stay the fast path, and the panel follows them.

| Key | Effect |
| --- | --- |
| `space` | pause / resume the exposure |
| `e` | switch between Live and Exposure |
| `s` | show / hide a cross at each focal point |
| `+` or `a` | add a focal point at the cursor |
| `-` or `x` | remove the most recently added focal point |
| `f` | make the newest focal point follow the mouse |
| `r` | roll a new seed and start a new exposure |

**Live** draws every frame from where the particles are right now. **Exposure**
keeps what they have drawn, so the image builds up — that is where the finished
images come from, and the canvas gets a red frame to say so. Regions the focal
points stopped feeding fade back over time: the tone map normalises to a white
point that keeps rising with the densest area, so a long run behaves like an
exposure with a slowly closing aperture.

**Pausing stops the exposure, not the app.** Nothing is added to the image and
the particles stand still, but everything else keeps working — so the way to
finish an image is to pause it and then take your time on the Look tab. Every
change there repaints immediately, and none of them touches what has been
collected. While the exposure is paused a focal point set to follow the mouse
stops following, so moving the cursor over to the panel cannot smear the picture
you just finished.

## Seeds

The run is driven by a seeded PRNG, and **the URL hash carries the whole state**
— the seed, every parameter and the focal points. Copy the link and you get the
same image back; the address bar updates itself a moment after any change, so
there is nothing to press first. `r` rolls a new seed. Reproducibility holds for
a given canvas resolution, and stops the moment you steer the shape with the
mouse. Links from the older seed-only format still load.

## Presets

**Download** on the Render tab writes `n-ellipse-<seed>.json` — the seed, every
parameter, and the focal points, together with the canvas size they were placed
on. **Load…** reads one back: the canvas is resized to the preset's aspect and
resolution, the figure is scaled into it, and the run restarts from the saved
seed. Whether the simulation is running, whether a point follows the mouse and
whether the focal-point crosses are shown are not saved; everything that shapes
the image is. The timeline's duration and loop mode are saved; whether it is
running and where the playhead sits are not, so a loaded preset starts at the
beginning, stopped.

The file keeps every field, while the link carries only what differs from the
defaults — a link is shared and ephemeral, a saved file is what you come back to
in six months.

## Colours

The image is a density buffer, and the **colour ramp** on the Look tab is what
density is mapped through: position `0` is empty canvas, `1` is the densest
pixel, and every stop in between is a colour the image passes on the way. Two
stops give the plain white → black default; add a couple more and the
black → orange → white grading of the reference renders is a setting rather than
something done afterwards in an image editor.

The stop at `0` doubles as the image's base colour: the vignette fades the edge
towards it rather than towards black, so it works the same way on a light look
and a dark one.

Stops are sorted for you, so a position can be typed in any order, and a new
stop lands in the widest gap with the colour the ramp already has there — adding
one changes nothing until you move it.

## Documentation

| Doc | What it covers |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | the modules and how a frame flows through them |
| [docs/decisions.md](docs/decisions.md) | why the project looks like this, including what the name gets wrong |
| [docs/roadmap.md](docs/roadmap.md) | where it is going next, in dependency order |
| [AGENTS.md](AGENTS.md) | conventions and traps, for AI agents |
