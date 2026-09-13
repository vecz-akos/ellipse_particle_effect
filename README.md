# ellipse_particle_effect

A generative-graphics sketch. Twenty thousand particles wander a canvas, taking
steps whose length depends on how far they are from an *n-ellipse* — the curve
where the distances to every focal point sum to a fixed value. Near the curve
the steps shrink to sub-pixel, so particles effectively freeze there; elsewhere
they roam. Every hit is counted into a density buffer and tone-mapped to the
screen, so the traces build up into orbit-like, x-ray-looking images. Drag the
focal points around, or add new ones, to steer the shape; a panel on the right
edits everything else live. Plain ES modules and Canvas 2D, no framework; how
the pieces fit is in [docs/architecture.md](docs/architecture.md).

## Quick start

```powershell
npm install
npm run dev        # dev server with hot reload
npm run build      # bundle into dist/, openable straight from the filesystem
npm run bench      # what the render chain costs per frame, stage by stage
```

Vite is the only dependency, and it is a devDependency.

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
  (exposure, gamma, and adaptation — not a look control but how fast the white
  point follows the brightest spot while the exposure runs), a vignette and
  film grain. Bloom, vignette and
  grain are off until you turn them on, and cost nothing while they are. None of
  it touches the simulation, so the usual way to work is to let an image build up
  first and grade it afterwards. They cost frame rate while the exposure runs —
  the vignette and the grain more than bloom, and all of it more at 4K — but a
  stopped exposure is redrawn only when you change something, so grading a
  finished image stays responsive.
- **Render** — the seed (type one and apply it, or roll a new one), PNG save at
  the current canvas resolution, and presets as JSON. The URL follows the state
  on its own; the preset file is for keeping one on disk.
- **Playback** — the timeline (duration, play/pause, loop or one-shot, a scrub)
  and, below it, the open point's **track**: an ordered list of **stations**.
  Each station is a position and a weight at one step of the timeline, held for
  a **dwell**, with a straight or curved **leg** to the next one. Most points
  never get a track and simply stand where you put them.

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

## Moving a focal point on a timeline

Dragging a point while the exposure runs is the fast way to steer the image, and
it has one bad property: the gesture is the artwork and cannot be edited. The
**Playback** tab makes the movement data instead.

Pick a point — from the selector, or by clicking it on the canvas — and press
**Add station here**. That records the point's current position and weight at the
current step. Add another somewhere else on the timeline and the point travels
between them, dragging its weight along too, so the figure can breathe in place
as well as move. **Hold** is how long it stands still at a station, and it is
where the image gets its bright structure: without holds a moving focus draws an
even smear.

Two rules that will look like restrictions and are not:

- **You can only edit a station while the timeline is stopped and the clock is
  sitting exactly on it.** Click a station's step number to go there. Retiming
  a station takes the clock with it, so its `t` can be edited without losing it.
- **Scrubbing back does not erase anything.** What the exposure has already
  burned in cannot be un-burned, so the panel refuses to rewrite a station you
  have already run past rather than letting the plan and the picture disagree.
  Re-running a stretch draws over what is there, which is sometimes what you
  want.

Station times snap to other points' station times, so two points can be made to
arrive together without typing matching numbers. A point with no stations is
untouched by any of this.

A point can also **wobble on top of the plan**. The **Dwell modulation** and
**Leg modulation** blocks above the station list set a movement that every hold,
or every leg, on the track adds to where the plan puts the point — a **sine**,
an **orbit**, a smooth random **drift**, a per-step **tremor**, or a **pulse**
of the weight (Manual weight mode only) — and any station can carry its own for
its hold or for the leg it departs on. A trembling point keeps drawing structure
in one place instead of burning a dead spot; a sine on a leg swings across the
leg's direction, so a curved leg weaves along its own curve. Amplitude is in
pixels; **waves** is how many full cycles fit in the hold or the leg, so a whole
number brings the point back onto the plan exactly as the phase ends, however
long it is. Every wobble is computed from the step and the seed, so the same
link gives the same film however you scrub to a step.

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
the image is — including every point's track. The timeline's duration and loop
mode are saved; whether it is running and where the playhead sits are not, so a
loaded preset starts at the beginning, stopped.

The file keeps every field, while the link carries only what differs from the
defaults — a link is shared and ephemeral, a saved file is what you come back to
in six months.

## Colours

The image is a density buffer, and the **colour ramp** on the Look tab is what
density is mapped through: position `0` is empty canvas, `1` is the densest
pixel, and every stop in between is a colour the image passes on the way. Two
stops give the plain white → black default; add a couple more and a
black → orange → white grading is a setting rather than something done
afterwards in an image editor.

The stop at `0` doubles as the image's base colour: the vignette fades the edge
towards it rather than towards black, so it works the same way on a light look
and a dark one.

Stops are sorted for you, so a position can be typed in any order, and a new
stop lands in the widest gap with the colour the ramp already has there — adding
one changes nothing until you move it.

## How it was made

The idea and the proof of concept are from early 2024: a few hundred lines of
hand-written JavaScript that already did the one thing that matters — particles
freezing along an n-ellipse. Everything since has been added with Claude Opus:
from 2026 on, the commits are mostly the agents' work.

The split is roughly this. A person decides what the project is for, which
phase comes next, what a feature should feel like, and whether it actually
works — by running it in the browser and looking at the pictures, which is the
one check no agent here can make. Two agents do the rest in turn: one reads
the code and the last change, writes up what it found and turns it into a task
prompt; the other takes that prompt, writes the code, tests it and lands it.
Then the first one reads the result again. The tasks, the reviews and the
reasoning in `docs/decisions.md` come out of that loop, and so do most of the
mistakes it caught — several of them the agents' own.

## Documentation

| Doc | What it covers |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | the modules and how a frame flows through them |
| [docs/decisions.md](docs/decisions.md) | why the project looks like this, including what the name gets wrong |
| [docs/roadmap.md](docs/roadmap.md) | where it is going next, in dependency order |
| [AGENTS.md](AGENTS.md) | conventions and traps, for AI agents |
