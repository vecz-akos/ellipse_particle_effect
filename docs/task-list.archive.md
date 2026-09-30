# Task list archive

> Finished, superseded and rejected tasks, oldest first. **Nothing here needs to
> be read while working.** The open queue is `docs/task-list.md`; the format is
> `docs/task-list.template.md`.

This file is tracked, and the live queue is not, on purpose. What survives here
is the thing `docs/decisions.md` does not capture: **what was asked, and what was
explicitly forbidden.** A decision entry records the answer; these prompts record
the constraints the answer had to satisfy — the alternatives ruled out, the fixes
that looked obvious and were wrong, the invariants that could not move.

Two ways in:

- A `docs/decisions.md` entry names the task ID that produced it.
- Nothing else references these. Grep by ID or by symptom.

Entries are moved here verbatim when they land. They are **not** updated
afterwards; a prompt that turned out to contain a false premise stays as it was
written, because that is the record of what the implementer was told. Where that
matters, the `docs/decisions.md` entry says so.

---

## T1 — `resize` can darken the image permanently

- **Kind:** bug
- **Roadmap:** Phase 1 addendum
- **Touches:** `scripts/DensityBuffer.js`
- **Status:** done

**Prompt**

> In `scripts/DensityBuffer.js`, `max` only ever grows: `add` raises it and
> `clear` zeroes it, but `resize` leaves it untouched while discarding part of
> the buffer. Shrink the window so that the densest region is cropped away and
> `max` keeps its old, now-nonexistent value forever. The tone map normalises to
> a white point that follows `max`, so the image goes dark and never recovers.
>
> Recompute `max` over the region that survives the resize. The row-copy loop
> already walks exactly that data, so do it there rather than in a second pass.

**Done when**

- After shrinking the window across the brightest area, the image returns to a
  normal brightness within a few frames instead of staying dark.
- No extra full-buffer pass was added to `resize`.

---

## T2 — `clear` leaves a stale white point

- **Kind:** bug (cosmetic)
- **Roadmap:** Phase 1 addendum
- **Touches:** `scripts/DensityBuffer.js`
- **Status:** done

**Prompt**

> `DensityBuffer.clear` resets `max` but not `whitePoint`. Because `whitePoint`
> only moves towards `max` by `adaptation` per frame, a clear that follows a
> long accumulation run leaves the white point far too high, and the tone map
> renders everything too dark for roughly 20-30 frames.
>
> This is only visible when `max` drops sharply — pressing `r` after a long
> accumulating run, or toggling `c` back on — and it lasts about a third of a
> second, so treat it as the small cosmetic fix it is. Reset `whitePoint` in
> `clear` alongside `max`.

**Done when**

- Pressing `r` after a long accumulating run shows no dark flash before the
  image settles.

---

## T3 — Density-to-colour lookup table

- **Kind:** performance
- **Roadmap:** Phase 1 addendum; **unblocks the colormap in Phase 4**
- **Touches:** `scripts/DensityBuffer.js`
- **Status:** done

**Prompt**

> `DensityBuffer.render` walks every pixel each frame and runs `Math.log1p` and
> `Math.pow` on every non-zero one. In per-frame mode this is cheap and the
> current implementation is fine — the buffer is cleared each frame, so most
> pixels are zero and the `d > 0` guard skips the maths. **The problem is
> accumulating mode** (`c` off): the canvas fills with non-zero pixels over time,
> so the render cost *grows as the run goes on*, which is exactly backwards for
> the mode that produces the finished images.
>
> Every increment in `add` is `+= 1`, so **density is always an integer**. Build
> a lookup table once per frame — index by density, value is the tone-mapped `t`
> (or the packed RGB directly, if that measures faster) — for the range 0 to the
> current white point, and clamp above it. The pixel loop then becomes an array
> index, and `log1p` / `pow` disappear from it entirely. Filling a few thousand
> table entries replaces millions of transcendental calls.
>
> Keep the tone curve identical to today's: `log1p(d * exposure)` normalised to
> the white point, then `pow(t, 1/gamma)`, then a lerp between the background and
> foreground colours. This task is a pure optimisation; the output should be
> visually indistinguishable.
>
> Note for whoever picks up Phase 4: **this table is the colormap.** Turning the
> current two-colour lerp into the black → orange → white grading of the
> reference images becomes a matter of filling the table differently, not a new
> code path. Leave the table's construction in a shape that makes that easy.
>
> Measure before and after in accumulating mode specifically — see T4 — and put
> the numbers in a `docs/decisions.md` entry.

**Done when**

- The per-pixel loop contains no `Math.log1p` or `Math.pow` call.
- A long accumulating run is measurably faster than before, with the numbers
  recorded.
- Renders are visually indistinguishable from the current output at the same
  seed and parameters.

---

## T4 — Measure the render cost in accumulating mode

- **Kind:** measurement
- **Roadmap:** Phase 1 addendum
- **Touches:** nothing permanent
- **Status:** done

**Prompt**

> The existing claim that the density buffer made rendering "dramatically
> faster" was observed in **per-frame** mode, where it is not in doubt. Nobody
> has measured **accumulating** mode, where the render loop's cost rises as the
> buffer fills.
>
> Time the particle loop and the render loop separately, at a fixed seed and
> window size, sampled at the start of a run and again after a few thousand
> frames of accumulation. The question to answer: does the render loop overtake
> the particle loop as the buffer fills, and if so, when?
>
> Report the numbers; do not leave profiling instrumentation in the committed
> code. If T3 has already landed, measure both implementations so the entry has a
> before and after.

**Done when**

- Numbers exist for particle loop vs render loop, early run vs late run.
- The working tree has no leftover timing code.

---

## T5 — Type check in the particle hot loop

- **Kind:** cleanup
- **Roadmap:** Phase 1 addendum
- **Touches:** `scripts/Particle.js`, `scripts/main.js`
- **Status:** done

**Prompt**

> `Particle.update` runs `nEllipse instanceof NEllipse` on every call — twenty
> thousand times per frame — as a guard that cannot fail in practice, since
> `main.js` owns exactly one `NEllipse`. Worse, when it does fail the particle
> silently does not move.
>
> Move the check out of the hot loop, or drop it. Do not replace it with a
> different per-particle check. Keep the behaviour identical for the one caller
> that exists.

**Done when**

- The innermost loop has no `instanceof` check.
- The rendered output is unchanged at the same seed.

---

## T6 — One access pattern for the RNG

- **Kind:** cleanup
- **Roadmap:** Phase 2 addendum
- **Touches:** `scripts/Particle.js`, `scripts/main.js`
- **Status:** done

**Prompt**

> The seeded `Random` instance reaches its users two different ways:
> `Particle.update` takes it as a parameter, while `particleCorrection` in
> `main.js` closes over the module-level one. Both work and both draw from the
> same stream, but it is two conventions for one object.
>
> Pick one and apply it consistently. Passing it explicitly is the better
> default — it keeps `Particle` free of module-scope dependencies and will
> matter when Phase 3 makes parameters swappable at runtime.
>
> **Do not change the order in which the stream is consumed.** The sequence of
> `next()` calls per frame is what makes a seed reproducible; if the order
> changes, every existing seed renders a different image. Verify a known seed
> renders identically before and after.

**Done when**

- The `Random` instance is reached the same way everywhere.
- A known seed produces a pixel-identical image to before the change.

---

## T8 — One weight for every focal point, as a size control

- **Kind:** feature
- **Roadmap:** Phase 3 addendum
- **Touches:** `scripts/Panel.js`, `scripts/Params.js`, `scripts/NEllipse.js`
- **Status:** done

**Prompt**

> Right now every focal point carries its own `weight`, editable in its row on
> the Parameters tab, and the n-ellipse target sum `d` is the sum of those
> weights plus `NEllipse.baseD`. Per-point weights are the right model, but they
> are the wrong control for the thing people actually want to do most often:
> **make the whole figure bigger or smaller.** Doing that today means editing
> every row by hand and keeping the numbers in step.
>
> Add a single weight that applies to all focal points at once, in the "Focal
> points" section, above the list:
>
> - A checkbox, **checked by default**, that means "use the default weight".
>   While it is checked, the shared weight input is disabled and every focal
>   point uses `NEllipse.unit_d`, exactly as today.
> - Unchecking it enables the input. Its value is then applied to **every** focal
>   point, including ones added afterwards. Dragging the slider resizes the
>   whole figure live.
>
> The per-row `w` fields must not become a second source of truth. While the
> shared weight is active, disable them and show the shared value; they become
> editable again when the checkbox goes back to its default. Switching back and
> forth should not surprise anyone: when the shared weight is turned off, leave
> each point holding the value it currently has rather than restoring whatever
> it had before — predictable beats clever here.
>
> The new state belongs in `Params` (the checkbox and the shared value), not in
> `Panel` — see the "Every tunable belongs in `Params`" convention in
> `AGENTS.md`. Route the actual writes through `NEllipse.setWeight` so `d` is
> recalculated the one existing way.
>
> **A wart you will meet, and a decision to make.** `recalculateD` computes
> `d = baseD + Σ weights`, and `baseD` is a constant that belongs to no focal
> point — it exists because the original code seeded `NEllipse` with a target
> sum before any point was added. With it in place, a shared weight `W` over `n`
> points gives `d = baseD + n·W`, so the control does not fully determine the
> size, which is exactly what this feature is for. Decide how to handle it and
> write the reasoning into `docs/decisions.md`: folding `baseD` into the points
> is cleaner but changes the look of existing seeds, so if you keep it, add a
> small readout of the resulting `d` to the section so the number is at least
> visible.
>
> Slider or number input is your call; the useful range is roughly a tenth of
> the shorter canvas side up to a couple of times it. Whatever you pick, the
> figure has to resize smoothly while the control is being dragged.

**Done when**

- With the checkbox in its default state, behaviour is identical to today.
- Unchecking it and changing the shared weight resizes the figure live, and
  every focal point — including newly added ones — takes that weight.
- The per-row `w` fields cannot be edited into disagreement with the shared
  weight.
- The new state is in `Params`, and a `docs/decisions.md` entry records the
  `baseD` decision.

---

## T9 — Save PNG burns the focal-point crosses into the image

- **Kind:** bug
- **Roadmap:** Phase 3 addendum
- **Touches:** `scripts/main.js`
- **Status:** done

**Prompt**

> `draw` blits the density image and then, when `showFocalPoints` is on, strokes
> a cross at each focal point directly onto the same canvas. `savePng` calls
> `canvas.toBlob`, so **the crosses end up in the exported PNG.** They are a
> debugging overlay; nobody wants them in the finished image, and the failure is
> silent — you only notice after opening the file.
>
> Make the export contain the density image only, whatever the overlay is doing
> on screen. Note that the exported file must still honour everything that *is*
> part of the image: the tone map, the colours, and the canvas resolution set on
> the Parameters tab.
>
> Do not solve it by forcing `showFocalPoints` off during the save and back on
> afterwards if that produces a visible flicker on screen — the overlay should
> keep working normally while the file is written.

**Done when**

- Saving with `s` on produces a PNG with no crosses.
- The on-screen overlay is unaffected, with no flicker at the moment of saving.
- The saved image is otherwise pixel-identical to what the canvas shows.

---

## T10 — The default focal weight is stuck at the startup canvas size

- **Kind:** bug
- **Roadmap:** Phase 3 addendum
- **Touches:** `scripts/main.js`
- **Status:** done

**Prompt**

> `NEllipse.unit_d` and `baseD` are set once during `window.onload`, from
> `Math.round(Math.min(width, height)/3)` — a third of the shorter canvas side.
> They are recomputed in the second `resizeCanvas` pass on load, and **never
> again**.
>
> Change the aspect or the resolution on the Parameters tab and the canvas gets a
> new pixel size, but the default weight keeps its old value. Switch from a
> fitted window to 4K and every focal point added afterwards is sized for the
> old, much smaller canvas, so the figure comes out proportionally tiny.
>
> Recompute the default in the `canvasChanged` handler the same way it is
> computed on load. Decide deliberately what happens to focal points that
> already exist — rescaling their weights keeps the figure looking the same
> across a resolution change, leaving them alone keeps their explicit values
> intact. Either is defensible; pick one, make it consistent with how T8's
> shared weight behaves if that has landed, and say which you chose in the
> commit.
>
> Watch out for the duplicated three-line "recompute the default" block already
> in `onload`; factor it rather than adding a third copy.

**Done when**

- After switching resolution, a newly added focal point is sized for the current
  canvas, not the startup one.
- The behaviour for already-placed points is deliberate and consistent.

---

## T11 — `AGENTS.md` and the code disagree about what a canvas change clears

- **Kind:** bug (documentation)
- **Roadmap:** Phase 3 addendum
- **Touches:** `AGENTS.md` or `scripts/main.js`
- **Status:** done

**Prompt**

> `AGENTS.md`, under "Gotchas already investigated", states: "Resizing the window
> (or changing aspect/resolution) reallocates every particle; the accumulated
> density survives."
>
> That is true for a window resize — `onresize` calls `spawnParticles` and
> nothing else. It is **false** for aspect and resolution: the `canvasChanged`
> handler passed to `Panel` calls `density.clear()` before respawning, so the
> accumulated image is thrown away.
>
> One of the two is wrong. Decide which — clearing on a resolution change is
> defensible, since the density buffer's contents mean something different at a
> different pixel size, while silently discarding a long accumulation run is a
> harsh thing to do to someone who has been letting an image build for minutes.
> Then make the code and the note agree, and if the behaviour is deliberate,
> give the reason in the note rather than just restating what it does.

**Done when**

- The `AGENTS.md` gotcha matches what the code actually does, for both the
  window-resize and the aspect/resolution paths.

---

## T12 — DOM writes inside the animation loop

- **Kind:** cleanup
- **Roadmap:** Phase 3 addendum
- **Touches:** `scripts/main.js`, `scripts/Panel.js`
- **Status:** done

**Prompt**

> Two things touch the DOM on every animation frame in `main.js`:
>
> - `update` calls `panel.refreshFocalValues()` whenever `followFocalPoint` is
>   on, writing the x and y `<input>` values sixty times a second.
> - `draw` calls `canvas.classList.toggle("recording", ...)` unconditionally,
>   every frame, almost always to the value it already had.
>
> Neither is expensive on its own, and neither is a correctness problem. But the
> render loop is the measured bottleneck of this project (see the
> "Density-to-colour lookup table" entry in `docs/decisions.md`), and per-frame
> DOM work is the kind of thing that quietly grows once a panel exists.
>
> Update the readouts only when the value actually changed, and flip the class
> only on a transition. Keep the displayed numbers correct — a focal point
> dragged with the mouse, or moved by follow mode, must still show live
> coordinates.
>
> While you are in `refreshFocalValues`: it writes `x` and `y` but not `weight`,
> so a weight changed from anywhere but its own input will not show up. Fix that
> too if T8 has landed, since the shared weight makes it reachable.

**Done when**

- No DOM write happens on a frame where nothing displayed has changed.
- Dragging a focal point and follow mode both still show live coordinates.

---

## T13 — The panel assumes it is the only writer of `Params`

- **Kind:** bug (latent)
- **Roadmap:** Phase 3 addendum; **do this before presets are built**
- **Touches:** `scripts/Panel.js`
- **Status:** done

**Prompt**

> `Panel.sync()` exists so the panel can catch up with a `Params` that changed
> underneath it — today only from the keyboard shortcuts. It pulls every
> control's **value** back from `Params`, and that is all it does. Two pieces of
> panel state are not values, and `sync` does not touch either:
>
> - **Enabled state.** `syncWeightControls` decides whether the shared Weight
>   slider or the per-row `w` fields are editable, from `params.manualWeight`.
>   It runs when the Manual checkbox is clicked and when the focal rows are
>   rebuilt — but not from `sync`. Change `manualWeight` any other way and the
>   panel keeps the previous lock state, so both editors can end up live at once
>   on the same number. That is exactly the two-sources-of-truth situation the
>   shared weight was built to avoid.
> - **Range.** `setWeightRange` sets the slider's `min` and `max` from the canvas
>   size, but never constrains `params.sharedWeight` itself. Assigning an
>   out-of-range number to a range input silently clamps what is *displayed*
>   while `Params` keeps the original, so the panel shows one number and the
>   simulation uses another, with nothing on screen admitting it.
>
> Neither can be triggered today: the only outside writer is the keyboard, which
> touches no weight state, and `rescaleFocalPoints` scales `sharedWeight` by the
> same factor as `unit_d`, so it stays inside the range on its own. **The Render
> tab's own hint says presets and saved state are not built yet** — and a preset
> is precisely an outside writer that sets every field at once, from a session
> with a different canvas size. Both problems land the day that feature does.
>
> Make `sync()` total: after it runs, every control must match `Params` in
> value, in range, and in whether it is editable, no matter which fields
> changed or who changed them. Where a `Params` value cannot be represented by a
> control — a `sharedWeight` outside the current range — clamp `Params` itself
> so the two cannot disagree, rather than letting the input clamp the display.
>
> Do not add a change-notification mechanism or make `Params` observable; a
> single method that rereads everything is the right size for this panel. Keep
> `sync()` cheap enough to stay callable from a keyboard handler.

**Done when**

- Setting any combination of `Params` fields from outside the panel and calling
  `sync()` leaves every control correct in value, range, and enabled state.
- Toggling `manualWeight` in `Params` directly and calling `sync()` locks and
  unlocks the same controls as clicking the checkbox does.
- A `sharedWeight` outside the slider's range cannot survive a `sync()` as a
  disagreement between `Params` and what the panel shows.

---

## T14 — The state link is twice as long as it needs to be

- **Kind:** cleanup
- **Roadmap:** Phase 3 addendum
- **Touches:** `scripts/Preset.js`, `scripts/main.js`
- **Status:** done

**Prompt**

> A four-focal-point link is currently 844 characters of base64. Measured on a
> real one, with the payload otherwise unchanged:
>
> | | JSON | base64 |
> | --- | --- | --- |
> | as it stands | 632 B | 844 |
> | coordinates rounded to 2 decimals | 542 B | 724 |
> | + default-valued params and derived weights omitted | 291 B | 388 |
>
> Two causes, both easy.
>
> **Float noise.** `Preset.capture` writes focal-point coordinates at full
> double precision — `"x":792.4822209545541`, sixteen significant digits for a
> pixel position. `DensityBuffer.add` truncates to an integer anyway, so two
> decimals is already below anything visible. Round on capture.
>
> **Everything is written even when it is the default.** In a typical link the
> whole `params` block except a colour or two is at its default value.
> `Preset.apply` iterates over the keys that are *present*, so a missing key
> already leaves `Params` at its constructor value — **omitting them needs no
> schema change and no version bump.** Same for the per-point `weight` while
> `manualWeight` is false: every point holds `sharedWeight`, and `Panel.sync`
> reapplies it on load, so the numbers are derived, not data.
>
> **The trade-off you are making, and it must be deliberate:** a link that omits
> a field inherits whatever that field's default becomes later. For the URL hash
> that is the right call — links are shared, ephemeral, and this project treats
> its defaults as load-bearing anyway. For a **saved preset file** it is the
> wrong call: those are long-lived, a user keeps them to reproduce an image
> months later, and a silently shifting default would be a nasty way to lose
> one. So keep the file export writing everything, and strip only on the way
> into the URL. One capture, two serialisations — do not fork the schema.
>
> **A separate decision while you are in here.** `showFocalPoints` is currently
> saved. It is a debugging overlay, so someone opening a shared link gets an
> image with crosses on it; that looks more like session state, alongside
> `animate` and `followFocalPoint` in `SKIP`, than like part of the picture.
> Decide it deliberately either way and say which in the commit.

**Done when**

- A link with a handful of focal points is roughly half its current length.
- Loading an existing full-length link still restores exactly the same state —
  old links must keep working, since the whole point of them is that they last.
- A saved `.json` preset still contains every field.
- Round-tripping a state through link and file both give back the same `Params`
  and focal points.

---

## T15 — Two gaps in the hash-decoding path

- **Kind:** bug
- **Roadmap:** Phase 3 addendum
- **Touches:** `scripts/Preset.js`, `scripts/main.js`
- **Status:** done

**Prompt**

> `readHash` in `main.js` and `Preset.decode` are the defensive edge of the app —
> everything arriving there is a string a user pasted. Two things get through.
>
> **A newer format silently becomes a seed.** `decode` matches the literal
> prefix `p1.`. A future `p2.…` link fails that test, `decode` returns `null`,
> and the caller falls back to treating the whole string as a **seed** — so
> instead of "this link is from a newer version", you get a perfectly normal run
> from a nonsense seed, with no hint that a saved image was lost. Match the
> prefix as a version pattern rather than a literal, and when the version is one
> this build does not support, fail loudly enough that the caller can report it
> instead of falling through to the seed path.
>
> **`decodeURIComponent` sits outside the `try`.** In `readHash` it runs on the
> line above the guard, so a hand-edited hash containing a stray `%` throws an
> uncaught `URIError` during startup — in the one function whose entire job is to
> survive bad input. Move it inside, and make sure a hash that cannot be decoded
> at all ends up on the same "ignore it and carry on" path as a damaged preset.
>
> Neither changes what a valid link does. Do not tighten anything that would
> reject the bare base-36 seed links from before the preset format existed;
> those still have to load.

**Done when**

- A hash with an unsupported version prefix is reported, not silently used as a
  seed.
- A malformed percent escape in the hash cannot throw out of `readHash`.
- A bare seed link and a current `p1.` link both still load.

---

## T16 — Gradient colormap instead of two colours

- **Kind:** feature
- **Roadmap:** Phase 4.1
- **Touches:** `scripts/Gradient.js` (new), `scripts/DensityBuffer.js`, `scripts/Params.js`, `scripts/Panel.js`, `scripts/Preset.js`, `scripts/main.js`
- **Status:** done

**Prompt**

> `DensityBuffer.buildTable` ends in a lerp between two colours. Replace that
> with a multi-stop gradient, so the black → orange → white grading of the
> reference images under `../imgs/` becomes a setting rather than something done
> afterwards in an image editor.
>
> **The module.** `scripts/Gradient.js`, one default-exported class: a list of
> stops `{ at, color }` with `at` in 0…1 and `color` a `#rrggbb` string, and a
> `sample(t)` returning `[r, g, b]` — linear interpolation between the two
> neighbouring stops, clamped to the end stops outside the range. Stops are
> sorted on construction, not on every sample. It parses hex itself; the `rgb`
> helper in `main.js` exists only to feed the old two-colour path and should end
> up with one owner, not two.
>
> **The parameter.** `backgroundColor` and `foregroundColor` leave `Params` and a
> `gradient` array replaces them, defaulting to exactly today's two colours
> (`#ffffff` at 0, `#000000` at 1) so a fresh start renders the same image. Older
> presets and links are explicitly **not** a concern — this project is
> work-in-progress and nothing shipped needs to keep loading.
>
> **The panel.** The Look tab's two colour rows become a stop list: per row a
> position input, a colour input and a remove button, plus an "Add stop" button
> below. `Panel.syncFocalPoints` is the pattern to copy — same row rebuilding,
> the same `setNumber` guard, the same `touched()` call on every edit. Keep at
> least two stops; a list that can be emptied has no ramp to sample.
>
> **What must not change.** The pixel loop in `render` stays one array index into
> the table. The ramp is evaluated inside `buildTable`, once per density value,
> which is the whole point of "Density-to-colour lookup table" in
> `docs/decisions.md` — do not move colour work into the per-pixel loop.
>
> **Three places that will bite.** `Preset.capture` copies an object field with
> `{ ...value }`, and spreading an array turns it into `{0: …, 1: …}` — arrays
> need their own branch there, in `Preset.strip` (compare a whole array against
> the default as one value, do not diff it key by key) and in `Preset.apply`
> (validate it as an array of well-formed stops and ignore it otherwise, the same
> way every other untrusted field is handled). Second, `draw` in `main.js`
> strokes the focal-point crosses in `params.foregroundColor`, which will not
> exist — take the colour of the highest stop. Third, the panel's `sync` has to
> rebuild the stop rows the way it rebuilds the focal rows, or a preset load will
> leave the old list on screen.

**Done when**

- With the default gradient, the rendered `ImageData` is byte-identical to the
  current build for the same seed and parameters.
- Adding a middle stop changes the mid-tones and leaves black and white ends
  alone.
- A preset saved with four stops reloads with four stops, and so does the URL
  link.
- The focal-point crosses are still visible against the image.

---

## T17 — Vignette and grain, in one RGB pass

- **Kind:** feature
- **Roadmap:** Phase 4.2
- **Touches:** `scripts/PostProcess.js` (new), `scripts/Params.js`, `scripts/Panel.js`, `scripts/main.js`
- **Status:** done
- **Blocked by:** T16 (both belong on the Look tab, and the tab's layout settles there)

**Prompt**

> Two effects that work on finished RGB, after the tone map: a vignette and film
> grain. They are cheap and they do most of the "photographic" work in the
> reference images under `../imgs/`.
>
> **One module, one pass.** `scripts/PostProcess.js`, default-exported class,
> given the `Uint32Array` view of the `ImageData` plus the canvas size and the
> settings. Vignette first, grain last — grain applied before anything that
> blurs or shades it stops reading as grain. If both effects are off the pass
> must not run at all: today's frame cost is the baseline and has to survive
> this task untouched.
>
> **Vignette.** A per-pixel multiplier from the distance to the centre, with
> `amount`, `radius` and `softness`. Precompute the multiplier into a
> `Float32Array` and rebuild it only when the size or one of the three settings
> changes — recomputing a distance and a smoothstep per pixel per frame is the
> obvious version and the wrong one. It would be cheaper still to apply the
> falloff to the density before the tone map, and that is deliberately not the
> plan: the density index into the colour table has to stay an integer.
>
> **Grain.** Do not draw from the simulation's `Random`. Everything random in the
> simulation comes from that one seeded stream, and a seed only reproduces an
> image because the stream is consumed in a fixed order; a render effect pulling
> from it would make the picture depend on how many frames were drawn. Generate a
> 256×256 noise tile once, from a `Random` of its own, and index it with a
> per-frame offset when animated grain is on, a fixed offset when it is off.
> Settings: `amount`, monochrome or per-channel, animated or static.
>
> Both go in `Params` as nested objects with their own `enabled` flag — `step` is
> the existing example of a nested field, and `Preset` already handles that shape,
> so presets and links carry them for free. Controls go on the Look tab under
> `Effects`, replacing the placeholder hint there.

**Done when**

- With both effects disabled, the `ImageData` is bit-identical to before this
  task, and no extra pass over the pixels runs.
- The same seed produces the same particle positions after a hundred frames with
  grain on and with grain off.
- Dragging the vignette sliders rebuilds the multiplier; holding them still does
  not.

---

## T18 — Bloom, added to the density before the tone map

- **Kind:** feature
- **Roadmap:** Phase 4.3
- **Touches:** `scripts/Bloom.js` (new), `scripts/DensityBuffer.js`, `scripts/Params.js`, `scripts/Panel.js`, `scripts/main.js`
- **Status:** done
- **Blocked by:** T16 (the halo's colour comes from the ramp, so the ramp has to exist first)

**Prompt**

> The orange haze around the bright curves in the reference images is bloom, and
> it belongs in linear space: blur a copy of the density buffer, add it back to
> the density, then tone-map the sum. Blurring the finished 8-bit RGB instead
> spreads values that are already clipped and already quantised, and comes out
> flat and grey. Done in the density, the halo simply lands lower on the ramp
> than the core does and takes the ramp's middle colour on its own — no separate
> colour for it, and nothing to tint.
>
> **The module.** `scripts/Bloom.js`, default-exported class holding its own
> scratch buffers, reallocated only when the size changes. A separable Gaussian —
> horizontal pass, then vertical — at half resolution is enough; upsample
> bilinearly on the way back. Settings: `radius`, `strength`, `threshold`, where
> only density above `threshold` relative to the current white point feeds the
> blur.
>
> **How it reaches the image.** `DensityBuffer.render` gains an optional source
> array, defaulting to `this.data`; with bloom on, the source is the summed
> buffer. The table is indexed by `source[i]|0` — one add and one truncation per
> pixel. Do **not** answer the "density is no longer an integer" problem by going
> back to a per-pixel `log1p`/`pow`; that throws away the measured win in
> "Density-to-colour lookup table" in `docs/decisions.md`, and the quantisation
> error of truncating is far below one step of the ramp anywhere the eye can see
> it.
>
> **The trap that will look like a bug.** `whitePoint` adapts towards
> `this.max`, which is the maximum of the *raw* density. Bloom raises the values
> actually being tone-mapped, so leaving the white point on the raw maximum
> clips the bright core to a flat blob the moment strength goes up. Measure the
> maximum on whatever `render` is actually reading. `clear` and `resize` have to
> invalidate the bloom scratch along with everything else.

**Done when**

- Strength 0, or bloom disabled, renders exactly what the build renders today.
- Raising strength adds a halo that takes its colour from the middle of the ramp,
  and the bright core does not flatten.
- No `Math.pow` or `Math.log1p` call is added to the per-pixel loop.
- A window resize with bloom on does not read a stale scratch buffer.

---

## T20 — Separate the exposure from the redraw

- **Kind:** feature
- **Roadmap:** Phase 4 addendum
- **Touches:** `scripts/main.js`, `scripts/Params.js`, `scripts/Panel.js`, `scripts/Preset.js`, `styles.css`, `README.md`
- **Status:** done

**Prompt**

> **The symptom.** The way this sketch is used is: run it with the buffer
> clearing every frame until the composition looks right, turn clearing off,
> steer the figure with the mouse until the image has built up, then stop — and
> only *then* choose the colours, the bloom and the rest of the look. That last
> step does not work. Turning `animate` off freezes the whole of `draw`, so
> nothing on the Look tab has any visible effect, and the only way to see a change
> is to flick `animate` back on for a frame — which does not redraw, it runs a
> full simulation step and burns another pass of twenty thousand particles into
> the finished image.
>
> **The cause.** `animate` gates two unrelated things at once: stepping the
> particles into the density buffer, and turning the density buffer into pixels.
> There are three states in this program, not two — the simulation steps, the
> image is rendered, and the density either accumulates or is cleared each frame
> — and the second one has no business being tied to the first.
>
> **The change.**
>
> 1. **Rendering is never gated by the run state.** It runs when something that
>    affects the picture has changed, and does nothing when nothing has. Idle and
>    stopped must cost nothing: bloom alone is 23 ms a frame at 1080p and there is
>    no reason to pay it repeatedly for an image that is not moving.
> 2. **What is now `animate` becomes the exposure control**, and stops feeding the
>    image: no clear, no `density.add`, and no particle stepping either — nothing
>    consumes the particle positions while the image is not being fed, so running
>    the loop would be invisible work and would slide the seeded RNG stream by
>    however long the app happened to be open. Everything else keeps working while
>    it is stopped: the look, focal-point dragging, the panel, PNG export.
> 3. **Both buffer modes freeze the same way.** With the exposure stopped, the
>    density buffer is untouched — in the clearing mode too, where it holds the
>    last frame drawn. Do not special-case one mode into clearing itself while
>    stopped; a stopped exposure means the image on screen stays exactly as it is.
>
> **The vocabulary, which is half the point of this task.** The current names are
> implementation words that leaked into the UI.
>
> | now | becomes |
> | --- | --- |
> | `params.animate` (checkbox "Animate") | `params.exposing`, driven by a **button** that reads `Pause` while running and `Resume` while stopped |
> | `params.clearCanvas` (checkbox "Clear") | `params.accumulate` — **inverted**, default `false` — shown as a two-way **Live / Exposure** choice |
> | "Clear image" button, Render tab, "Restart" section | **New exposure**, moved next to the pause button |
> | `.recording` on the canvas | `.exposing`, and it marks the Exposure *mode*; give the stopped state a visibly quieter variant so a held exposure does not look like Live mode |
>
> Live means every frame is drawn from the current particle positions; Exposure
> means the image builds up, like a long exposure. Both keyboard shortcuts stay:
> `space` pauses and resumes the exposure, `c` switches the mode. Put the whole
> run control in one place — the footer strip that already holds the mode toggles
> — so the exposure button, `New exposure` and the Live/Exposure choice sit
> together, and the Render tab keeps only the seed, the PNG and the presets.
>
> **The invariant this stands or falls on.** With rendering driven by a change
> signal, *everything* that alters what is on screen has to raise that signal, or
> the canvas silently shows a stale image. That is: every panel control, a focal
> point dragged on the canvas, every keyboard shortcut, a window resize, an
> aspect or resolution change, a preset load, the parameter reset, and the
> exposure and mode buttons themselves. `markStateChanged` in `main.js` is already
> called from all of those (it is what schedules the URL hash write), so the
> cheapest correct answer is to give that one signal a second consumer rather
> than to invent a parallel set of call sites. Say so in `AGENTS.md`: a per-frame
> path that writes to the DOM has to check first, **and** a change that affects
> the picture has to announce itself.
>
> **One behaviour to fix while you are here.** The tone map's white point walks
> towards the maximum by `adaptation` on every render. While the exposure is
> stopped no new data arrives, so repeated redraws would keep nudging the
> brightness while the user is trying to judge a gamma change. With the exposure
> stopped, take the white point straight to the maximum instead of easing towards
> it.
>
> **Not in this task:** a step-one-frame button, and any "finish the image" action
> that flips several things at once. Both were discussed and turned down.
>
> **`Preset` note.** `exposing` replaces `animate` in `SKIP` — it is session
> state, and a shared link must not hand someone a stopped exposure.
> `accumulate` replaces `clearCanvas` as a saved field. Older presets and links
> do not have to keep working.
>
> ---
>
> **Traps found while reviewing this task. Read these before writing code.**
>
> **1. Two signals, not one — and never mark the stepping path.**
> `markStateChanged` is *debounced*: it sets `hashDueAt = now + HASH_DELAY`, and
> `update` writes the hash once that time passes. Two consequences. First, a
> repaint hung off that timer would arrive 400 ms late, so dragging a slider
> would feel broken; the repaint must happen on the next frame while the hash
> write stays debounced — one call site, two schedules. Second, and worse: if the
> per-frame "the exposure stepped, so the image changed" signal is routed through
> `markStateChanged`, then `hashDueAt` is pushed into the future on every frame
> and **the URL hash stops being written at all**, silently, for as long as the
> exposure runs. The stepping path raises the repaint flag directly and never
> touches `markStateChanged`.
>
> **2. `clearImage` does not announce itself today.** The handler in `main.js` is
> `clearImage: () => density.clear()` with no `markStateChanged()`. It gets away
> with it now because the next frame redraws anyway. Under change-driven
> rendering, `New exposure` would wipe the buffer and leave the old picture on
> screen. Check every handler in that object the same way rather than assuming
> the list in the invariant above is complete.
>
> **3. Resizing the canvas wipes it.** Assigning `canvas.width` in `resizeCanvas`
> clears the bitmap to transparent black. A repaint must *follow* every resize
> that actually changed the size, or the canvas goes blank until the next
> unrelated change. `onresize` already calls `markStateChanged` only when
> `resizeCanvas` returned true, which is the right shape — keep it.
>
> **4. Split `draw`, do not gate it.** `draw` currently does the clear, the
> `density.add` loop, the post-process chain, the blit and the focal-point
> crosses in one function. The split this task needs is exactly: a *step* path
> (clear, step particles, add) and a *render* path (bloom, tone map, blit,
> crosses). Two functions with one caller each is much easier to keep honest than
> one function with flags sprinkled through it.
>
> **5. Keep the animation loop running.** Make its body conditional rather than
> cancelling and restarting `requestAnimationFrame`. `architecture.md` records
> that nothing cancels the loop any more, and that is a property worth keeping —
> a loop that has to be restarted is a loop that can stay stopped.
>
> **6. "The maximum" is ambiguous now that bloom exists.** `AGENTS.md` states
> that `render`'s white point follows the maximum of *what `render` is reading* —
> with bloom on, that is the summed buffer's maximum returned by `Bloom.apply`,
> not `density.max`. When you snap the white point instead of easing it, snap it
> to that same value, or a stopped exposure will grade against a different white
> point than a running one and every judgement made while stopped will be wrong.
>
> **7. Follow mode keeps steering while stopped, and that breaks the workflow
> this task exists to fix.** The `followFocalPoint` branch sits at the top of
> `update`, outside the run-state check, so it tracks the cursor regardless. The
> intended use is "stop the exposure, then move the mouse over to the panel to
> grade" — and on the way to the panel the cursor drags focal point 0 across the
> canvas. Worse, under change-driven rendering that moved point is a picture
> change, so it repaints, and the figure visibly wanders while the user is trying
> to judge a colour. Decide this deliberately: either a stopped exposure also
> stops follow tracking, or the button that stops the exposure clears
> `followFocalPoint`. Say which in the commit.
>
> **8. `README.md` is in scope and is not in the `Touches` list.** Its controls
> table still says "pause / resume the simulation" and "toggle buffer clearing",
> and the paragraph under it tells the reader to "turn clearing off with `c`".
> The requirement that no user-facing string says "animate" or "clear canvas"
> covers the README as much as the panel.
>
> **9. Dropping `clearCanvas` flips old links silently rather than loudly.**
> `accumulate` is the inverse of `clearCanvas` and defaults to `false`, and
> `Preset.apply` ignores keys it does not know — so an old link saved in
> accumulating mode loads as Live, with no error and no hint that the mode
> changed. It is fine for old links to stop working; it is not fine for them to
> load as something else. Either bump the preset `version` so they are rejected
> with a message, or translate the old key on load. T15 is about exactly this
> class of silent fallback — do not add a new instance of it while fixing the
> old one.

**Done when**

- With the exposure stopped, moving any Look control repaints the canvas
  immediately, and the density buffer is bit-identical before and after.
- With the exposure stopped and nothing touched, no frame is rendered at all.
- Stopping and resuming the exposure adds no more hits than running for the same
  number of frames without stopping — no burned-in extra pass.
- Toggling the focal-point crosses, dragging a point, resizing the window and
  loading a preset all repaint while the exposure is stopped.
- The panel says Live / Exposure / Pause / Resume / New exposure, and no user
  facing string says "animate" or "clear canvas" any more — `README.md`'s
  controls table included.
- A saved preset carries the buffer mode and not the exposure state.
- The URL hash keeps updating while the exposure runs, at the same rate as
  before.
- `New exposure` repaints immediately when pressed with the exposure stopped.
- Moving the mouse to the panel with the exposure stopped does not move a focal
  point.

---

## T19 — Measure the render cost with the whole chain on

- **Kind:** measurement
- **Roadmap:** Phase 4.4
- **Touches:** none — measurement only
- **Status:** done
- **Blocked by:** T18, which has landed

> **Partly answered already.** Bloom's own cost was measured when T18 landed and
> the figure sits in its `docs/decisions.md` entry — do not re-measure it from
> scratch. What is still missing is the whole chain together, at both resolutions,
> and the effect of T20: rendering is change-driven now, so the honest question is
> no longer "what does a frame cost" but "what does a frame cost **while the
> exposure is running**, and how often is one drawn at all while it is stopped".
> Answer that shape of question, not T4's.

**Prompt**

> T4 measured the render cost when `draw` was a table lookup and a blit. Phase 4
> adds a separable Gaussian over the density, an extra pass over the pixels, and
> a wider colour table. Measure the same way T4 did, at 1080p and at 4K, with the
> effects off, with vignette and grain on, and with bloom on, and write the
> numbers into `docs/decisions.md`.
>
> The decision that hangs on it: T7 (repaint only the pixels that changed) was
> parked as premature, and bloom is the thing that would un-park it — though a
> blur reads a neighbourhood, so a dirty-rectangle scheme has to grow the rectangle
> by the blur radius before it is correct. The alternative is splitting live from
> export: a cheaper preview while the look is being tuned, full quality only on
> save. Recommend one, with the measurement behind it.
>
> Change no behaviour in this task. If the numbers say nothing needs doing, that
> is the result — record it and close it.

**Done when**

- Frame times for the three configurations at two resolutions are in
  `docs/decisions.md`.
- T7's status carries a recommendation backed by a number rather than a guess.

---

## T22 — Check the benchmark into the repo

- **Kind:** measurement
- **Roadmap:** infrastructure
- **Touches:** `bench/`, `package.json`, `AGENTS.md`, `README.md`
- **Status:** done

**Prompt**

> T19 exists because T4's numbers went stale and its harness was a throwaway that
> no longer existed. T19's harness was also a throwaway, so **its numbers are
> already as unreproducible as T4's were** — the next change to the render chain
> will need a third measurement task written from scratch. Stop the cycle: check
> the harness in.
>
> **One benchmark, not a folder of scripts.** A directory of per-task harnesses
> rots: in six months none of them run, and a benchmark that does not run is
> worse than none because it looks like a fixture. One file, extended when a new
> measurement is needed. Put it in **`bench/`** — `scripts/` is the sketch's own
> source directory and must not be reused for tooling. Add an `npm run bench`
> script, and name it in `AGENTS.md` under "Verifying changes" alongside
> `npm run build`, so it is something that gets run and therefore stays working.
>
> It must reproduce T19's method, because comparability across time is the entire
> point:
>
> - the real modules, a fixed seed, 20 000 particles, two focal points
> - both resolutions (1920×1080 and 3840×2160) and both fill states — early, and
>   after 3000 accumulated frames
> - each stage timed separately: `step`, `Bloom.apply`, `DensityBuffer.render`,
>   `PostProcess.apply` — and the whole frame
> - **discarded warm-up iterations before the timed runs.** V8 runs the first
>   iterations in baseline; without warm-up the absolute numbers are wrong and
>   the ratios are noisy. T19 reported 30-run averages without saying whether it
>   warmed up — decide it here and write the number down.
> - **the timed loop's result must be consumed** (a checksum over the output
>   buffer is enough), or the JIT can eliminate the work and hand you an
>   impossibly good number.
>
> The fake DOM this needs (an `ImageData` stand-in) is about twenty lines written
> by hand. **No packages** — the dependency rule in `docs/decisions.md` applies to
> tooling as much as to the sketch.
>
> Print the numbers in the same table shape the decisions entries use, so a
> result can be pasted in without reformatting.
>
> **A discrepancy to resolve while you are here.** In T19's table the "bloom"
> column exceeds `DensityBuffer.render` plus `Bloom.apply` by 3.4 ms at 1080p and
> **15.9 ms at 4K** — a systematic gap that grows with resolution, not noise. The
> likely cause is that bloom raises the summed buffer's maximum, so `top` grows
> and `buildTable` refills more entries per frame. Confirm it or find the real
> cause, and record it: an unexplained systematic gap in a measurement is how a
> methodology bug hides.

**Done when**

- `npm run bench` runs from a clean checkout and prints the full table.
- Re-running it reproduces T19's figures within noise, or the difference is
  explained in `docs/decisions.md`.
- The warm-up and consumption strategy is stated in the file itself, not only in
  a commit message.
- The bloom-column discrepancy is explained.
- No new dependency was added.

---

## T21 — Make the post-process pass cheaper per pixel

- **Kind:** performance
- **Roadmap:** Phase 4 addendum
- **Touches:** `scripts/PostProcess.js`
- **Status:** done

> **Two corrections from T22, which landed after this was written.** The
> figures below are T19's; the benchmark's are slightly higher — **57.9 ms of an
> 84 ms frame at 1080p and 168.0 ms at 4K** — because T19 timed the post pass on
> its own output and it measured cheaper than it is. Work from
> `npm run bench` and the entry "The benchmark is checked in, and T19's bloom gap
> was the harness", and **do not write another harness**: extend `bench/bench.js`.
>
> And the vignette-versus-grain split quoted below **does not reproduce**. It came
> from a difference of two timings in a throwaway. Re-measure it with the bench
> before optimising against it — it is the number that says which half to attack.

**Prompt**

> T19 measured `PostProcess.apply` at **52.5 ms of a 79 ms frame at 1080p**, and
> 140.3 ms at 4K — three times what bloom costs at 1080p, and the only stage
> whose cost grows with fill. The numbers and the method are in "The post-process
> pass is the expensive one, not bloom" in `docs/decisions.md`.
>
> **Why this comes before T7, which looks like the bigger win.** T7's
> dirty-pixel scheme only applies while the render parameters are unchanged.
> Grading a held image changes exposure, gamma, the ramp or the vignette — and
> every one of those alters every pixel's output, so the dirty set is the whole
> canvas and T7 saves nothing. Since T20, grading a paused image is where the
> user actually spends time, and it costs one full frame per adjustment. **This
> task is the only one that makes that faster**, and unlike T7 it helps the
> running exposure too.
>
> The per-pixel work to attack, from the T19 report: two integer divisions
> (`y/cell`, `x/cell`), a luma computation, and a `Math.abs`, on every pixel.
> Divisions by a value that changes once per frame are the obvious candidates —
> reciprocal multiply, or step the tile indices along the scan rather than
> recomputing them per pixel, since x advances by one and y is constant across a
> row. Measure each change; do not assume any of them helps.
>
> **The structural cost, which may matter more than the arithmetic.** T19 also
> found that the vignette and the grain together cost *less* than the sum of
> their individual costs, and that `DensityBuffer.render` does two million
> unclamped 32-bit stores in 8.5 ms while this pass does two million clamped
> read-modify-writes in 52. That points at the memory access pattern, not the
> maths: three byte-wide read-modify-writes per pixel through a
> `Uint8ClampedArray`. Whether a `Uint32Array` view can be used here is **not**
> obvious and `AGENTS.md` explicitly forbids unifying the two paths on the
> Uint32 side — that rule exists because the clamping and the byte order come
> free on the byte path. If you want to revisit it, measure first and put the
> number in the decisions entry; do not change it on principle.
>
> **Output must stay pixel-identical** at the same seed and parameters, verified
> by comparing buffers rather than by eye. This is an optimisation, not a change
> to the look.
>
> **Not in this task:** the dirty-pixel scheme (T7), and any live-versus-export
> quality split. Both were considered here and belong elsewhere.

**Done when**

- `PostProcess.apply` is measurably faster at 1080p and 4K, at both fill levels
  T19 used, with the numbers in `docs/decisions.md`.
- Output is byte-identical to the current implementation at the same seed and
  parameters.
- Every change that did **not** help is named in the entry, so it is not retried.

---

## T23 — The timeline, and the shape animation data takes

- **Kind:** feature
- **Roadmap:** Phase 5.1
- **Touches:** `scripts/Animation.js` (new), `scripts/Params.js`, `scripts/Panel.js`, `scripts/main.js`, `scripts/Preset.js`
- **Status:** done

**Prompt**

> Phase 5 gives focal points motion that is **data rather than a gesture**, so a
> good movement can be edited and re-run instead of being burned into an exposure
> by one pass of the cursor. This first task builds none of the motion. It builds
> the clock everything else reads and the data shape everything else writes — get
> those wrong and the two tasks after it inherit the mistake.
>
> **The timeline.** One animation: a duration, a current time, and a transport —
> play, pause, loop or one-shot, and a scrub. It lives on the Playback tab, which
> is a placeholder today.
>
> **Two clocks, and this is the part to get right.** The animation's time is
> advanced by **simulation steps**, not by wall-clock milliseconds — a fixed
> number of steps per animation frame. Wall-clock time makes the result depend on
> how fast the machine ran, which throws away the reproducibility the seeded
> `Random` exists for and which a later export task depends on. A real-time scrub
> for interaction is fine, but the authoritative advance is counted in steps. T20
> already separated stepping from rendering, so this is a counter in the step
> path, not a new loop.
>
> **The data.** A new `scripts/Animation.js`, default-exported like every other
> class here. It owns the duration, the transport state, and a per-focal-point
> track; a track holds nothing yet beyond an identity. Two constraints the shape
> has to respect from the start:
>
> - **The focal-point set is fixed for the length of an animation.** Points are
>   never added or removed on the timeline, so a track can assume a stable list.
>   Do not build an appear/disappear mechanism, and **do not treat weight 0 as
>   one** — see "Settled: focal points do not appear or disappear" in
>   `docs/roadmap.md` for why weight 0 is the opposite of absent.
> - **Tracks will later carry position, weight and a stack of modulators.**
>   Adding those should be an extension rather than a rewrite — but do not build
>   them here.
>
> **Where the state lives.** Every tunable belongs in `Params`, reached through
> the panel's existing `read`/`write` closures, and `Panel.sync()` must restore
> the transport like anything else. Non-tunable runtime state — the current time
> while playing — stays in `main.js` or the `Animation` instance. `AGENTS.md` has
> the rule.
>
> **Presets.** The animation shapes the image, so it is saved. Follow what
> `Preset.js` already does: validate on load, ignore what does not match. Old
> files and links do not have to keep working — see the project state above.
>
> **Not in this task:** paths, dwells, modulators, export. A timeline that plays
> and scrubs while nothing moves is the correct outcome here.

**Done when**

- The Playback tab plays, pauses, loops, scrubs and reports a time.
- The animation advances in simulation steps, and the same seed with the same
  transport input produces the same step count.
- `Panel.sync()` restores the transport, and a saved preset round-trips it.
- Nothing moves yet, and no focal point is added or removed by the animation.

---

## T23b — Two corrections to the timeline

- **Kind:** fix
- **Roadmap:** Phase 5.1
- **Touches:** `scripts/Preset.js`, `scripts/Animation.js`
- **Status:** done
- **Blocked by:** —

**Prompt**

> Two defects found reviewing T23. Both are small, and both get harder to fix
> once paths exist, so they come first.
>
> **1. The transport's run state is being saved.** `Preset.capture` walks every
> key in `Params` except the three in `SKIP` — `exposing`, `followFocalPoint`,
> `showFocalPoints` — and `params.animation` is not one of them, so
> `animation.playing` goes into saved files and into the URL hash. `strip` keeps
> it too, since `true` differs from the default. The result: **opening a link
> saved mid-playback starts the timeline immediately**, because `exposing`
> defaults to `true`. That is exactly the behaviour `exposing` is in `SKIP` to
> prevent, and the README already promises it ("whether the simulation is running
> … is not saved").
>
> `duration` and `loop` are settings and must keep being saved. Only `playing` is
> run state. `SKIP` is a flat set of top-level keys and this one is nested, so it
> needs a small extension — a nested skip list, or moving the flag out of the
> group. Pick whichever leaves `Preset` easier to read, and say which in the
> commit.
>
> **2. Track identities are not reproducible across a load.** `nextId` only ever
> counts up, and `syncTracks` mints fresh ids, so the same preset gives `t1…tN`
> in a fresh tab and `t7…` in a tab where points were added first. `Animation.js`
> says in its own comment that the identity is what will seed a modulator's
> `Random` — so as written, T25 would make the same preset produce a different
> film depending on what the user did before loading it, which is the whole
> property the step-counted clock exists to protect.
>
> Reset the counter when the track list is replaced wholesale: after
> `syncTracks(n)` the ids should be the same every time. That is enough here.
> Carrying identity through the file itself is T24's problem, since T24 is what
> gives a track content worth saving.
>
> **Also worth a line, not worth a fix on its own:** `advance` in loop mode
> wraps `span → 0`, so the clock never reads `span`; but `seek` clamps *to*
> `span`, and advancing from there lands on 1 rather than 0, skipping a step.
> Clamp `seek` to `span - 1` in loop mode, or note why it does not matter.

**Done when**

- Saving a preset while the timeline plays, then loading it, leaves the
  transport stopped; `duration` and `loop` still round-trip.
- `syncTracks(n)` produces the same track ids every time it is called with the
  same `n`.
- No behaviour change while nothing is animated yet.

---

## T24 — Stations, legs and dwells

- **Kind:** feature
- **Roadmap:** Phase 5.2
- **Touches:** `scripts/Animation.js`, `scripts/Panel.js`, `scripts/main.js`, `scripts/Preset.js`
- **Status:** done
- **Blocked by:** T23, T23b

**Prompt**

> Make a focal point move. **Read "The words this phase uses" in
> `docs/roadmap.md` first and use exactly those words** — the parts are easy to
> confuse, and a dwell in particular is the *opposite* of movement, not a kind of
> it:
>
> - **station** — a position and a weight, at one time on the timeline
> - **leg** — the transition between two stations; position and weight
>   interpolate across it, along a straight line or a Bézier curve
> - **dwell** — time spent held at a station; nothing interpolates
> - **track** — one focal point's whole plan, a sequence of stations
>
> A track alternates `dwell → leg → dwell → leg → dwell`, always. Position and
> weight both animate; weight is not the lesser half, because changing `d` makes
> the figure breathe in place rather than travel, which is a different family of
> images. **Dwell is not padding** — a track without holds draws an even smear,
> and the stations are where density accumulates and the bright structure comes
> from.
>
> **The station list *is* the track. A leg is not separately creatable.** One
> ordered list; each entry carries what happens *at* the station (position,
> weight, dwell) and how it reaches the *next* one (straight or curve, and how
> many steps). The last station has no "to next"; in loop mode it joins back to
> the first. Modelling legs as their own addable objects lets the UI hold
> nonsense — a leg with one endpoint, a gap, an ambiguous order — and every one
> of those becomes a validation branch. Do not.
>
> **Times are absolute steps inside the one global `params.animation.duration`.**
> There is no per-track duration. A track whose last station comes early holds
> there to the end. Station times **snap to other tracks' station times**, so
> points can be made to arrive together without typing matching numbers.
>
> **The UI lives in the right-hand panel, on the Playback tab. Do not add a
> timeline strip along the bottom of the window** — that shape is for showing
> proportions across many tracks, and what this needs is an ordered list, which
> reads better in a narrow tall column. The full layout is under "The Playback
> tab" in `docs/roadmap.md`; the parts that constrain the code:
>
> - **One track open at a time**, chosen by a selector *and* by clicking the
>   point on the canvas — `pickFocalPoint` in `main.js` already does the hit
>   test, so reuse it rather than inventing a second scheme. That selection is
>   **interface state, not `Params`**, the same category as `showFocalPoints`.
> - **A per-track mini time bar** in the track header: ~16px, dwells as blocks,
>   legs as lines, a marker at the current time, click to seek. A list shows
>   sequence but not proportion, and this is what gives the proportion back.
> - **The canvas shows the track**: the curve, markers at the stations, a dot at
>   the current time, and draggable Bézier handles.
> - **No track is the normal state.** Most points will never be animated, and a
>   point without a track simply stands where it is. The existing by-hand
>   workflow must be unchanged.
>
> **Two editing rules, both decided, both with a reason — see "Editing rules on
> the Playback tab" in `docs/roadmap.md`:**
>
> 1. **Editing only while the timeline is stopped.**
> 2. **A station the clock has already passed cannot be edited.** To change one,
>    scrub back to it.
>
> The second is not fussiness: the exposure accumulates, so what is burned into
> the image cannot be un-burned, and a panel that let a past station be rewritten
> would state one thing while the image showed another. Four things follow:
>
> - **The lock is in the interface, not in the data.** `Animation` has no notion
>   of a past, and a preset restores every station regardless. Only the panel
>   refuses the edit.
> - **A leg in progress is half locked** — origin frozen, destination editable.
>   Keep that; re-aiming a point mid-flight falls out of the rule for free.
> - **Scrubbing back does not clear the image.** Re-running a stretch draws over
>   what is there, sometimes deliberately. Say so in the panel; clearing stays a
>   separate action.
> - **This settles the two-writers trap.** `followFocalPoint` steers point 0 from
>   the cursor and dragging steers whichever point was grabbed; a point under a
>   track *and* under the hand would be two writers of one position, with the last
>   one in the frame winning silently. With editing confined to a stopped
>   timeline there is only ever one writer. The single gap is dragging while the
>   clock sits mid-leg, where there is no station to move: refuse it and say to
>   scrub onto a station.
>
> **Seeking must mark the image dirty.** Rendering is change-driven
> (`needsRender` in `main.js`), and moving the clock now moves the figure. T23
> could leave `seek` alone because nothing moved; this task cannot.
>
> **Tracks go into the preset, identity included.** T23b makes ids stable across a
> `syncTracks`; the file has to carry them, or the same saved animation will
> produce different modulator noise once T25 seeds from them. Follow `Preset`'s
> existing rule — copy only what is present and type-checks, ignore the rest.
>
> **Do not change `NEllipse.calcDistance`.** Weight changes go through
> `setWeight` so `d` is recalculated the one existing way, and the distance term
> is not touched — that is the constraint keeping appearing and disappearing
> points out of scope. Weight 0 is a legitimate setting, **not** an off switch:
> a point at weight 0 still pulls at full strength and shrinks the figure. Do not
> treat it as removal anywhere.
>
> **Not in this task:** modulators of any kind, and export.

**Done when**

- A focal point moves along its stations, interpolating position and weight
  across legs and holding through dwells, driven by T23's clock.
- Stations are editable by dragging on the canvas and by typing in the panel,
  and the two agree.
- Editing is refused while the timeline plays, and refused for a station the
  clock has passed; scrubbing back re-enables it.
- A hand on a point and a track driving it cannot both write its position.
- Seeking repaints.
- A track with no stations leaves its point exactly where the old by-hand
  workflow put it.
- Tracks survive a preset round-trip, ids included.
- The same seed, animation and step count produce the same image twice, verified
  by comparing buffers rather than by eye.

---

## T25 — Modulators on a dwell

- **Kind:** feature
- **Roadmap:** Phase 5.3
- **Touches:** `scripts/Animation.js`, `scripts/Panel.js`, `scripts/Preset.js`, `scripts/main.js`
- **Status:** done — see "Modulators are functions of phase time" in `docs/decisions.md`
- **Blocked by:** T24

**Prompt**

> A track gives a plan; a **modulator** gives it character. It is an offset
> added on top of what `Animation.at` says, never a replacement, so every kind
> vanishes at amplitude zero. **This task puts modulators on dwells only.** Legs
> are T26, and the split is deliberate: the mechanism is the same for both, the
> dwell is where it matters most, and building the mechanism once on the simpler
> phase keeps this task small. Build it so T26 is a second read site, not a
> second implementation.
>
> Use the vocabulary in "The words this phase uses" in `docs/roadmap.md`. A
> **dwell** is time held at a station; a point held perfectly still burns a dead
> spot into the exposure, and a point held still while it trembles or pulses
> keeps drawing structure in one place — which is where the bright detail comes
> from. That is what this task buys.
>
> **The kinds, on a dwell:**
>
> | kind | parameters | on a dwell |
> | --- | --- | --- |
> | sine | amplitude, frequency, phase | up and down along the screen's y axis — a predictable bob |
> | orbit (two sines, x and y) | amplitude, two frequencies, phase | circles and Lissajous figures around the station |
> | drift (smooth random) | amplitude, wander speed | organic wandering that never repeats and is not twitchy |
> | tremor | amplitude | the actual shake: small, fast, least predictable |
> | weight pulse | amplitude, frequency | the figure breathes on a timer |
>
> The sine's direction is **screen-vertical on a dwell** because a dwell has no
> direction of its own; on a leg (T26) it turns perpendicular to the leg. No
> direction parameter — this is a derived property of the phase.
>
> **Every modulator is a pure function of `(τ, seed, parameters)`, where τ is
> time since the phase began.** This is the trap of the task. A drift written as
> a random *walk* — integrate a random step each frame — cannot be seeked: landing
> the clock on step 300 would need the 299 steps before it replayed, and the same
> seed would give a different film depending on how the clock got there. Write
> drift as value noise or a sum of a few sines with seeded random phases, and
> tremor as a hash of `(seed, τ)` per step — `Random.hash` already exists for
> exactly this shape. Nothing here holds state between steps.
>
> **Seeding.** Each modulator's randomness comes from the run's seed, the track's
> `id`, the station's index and the slot — never from the simulation's `Random`.
> That rule is the same one grain follows and it is not negotiable: the seed
> reproduces an image only because the simulation's stream is consumed in a
> fixed order, and a modulator pulling from it would make the particles depend
> on how long the animation ran. Two tracks with identical settings must not move
> identically, which is what the track id in the seed is for.
>
> **`Animation.at` has to say which phase it is in.** Today it returns
> `{x, y, weight}` or `null`. The modulator needs the phase kind, the station
> index and τ, and T26 will need the leg's direction. Put that on the return
> value rather than writing a second walk of the station list that has to agree
> with the first. Keep `at` pure and keep `null` meaning "no track".
>
> **Where it composes.** `applyTracks` in `main.js` is the one place the plan
> becomes a point's position; the modulated result goes onto the point there.
> Two readers must **not** see the modulated position:
>
> - **`addStation`** copies `point.x, point.y` today. With a tremor running that
>   would freeze a shaking instant into a station. It must read the unmodulated
>   `at()` when the clock is on a track, and the plain point only when there is
>   no track.
> - **The canvas overlay's station markers** draw the plan, not the wobble; the
>   moving dot may show either, but say which.
>
> **Amplitude is in pixels**, so it is a canvas coordinate and belongs in
> `Animation.rescale` along with the station's position — `AGENTS.md` states the
> rule. **Weight pulse lives in Manual weight mode**, exactly as station weights
> do; in shared mode it is locked with them.
>
> **Storage and UI.** A modulator hangs off a station in a **dwell slot**, and
> the track carries a **default that stations inherit** and can override — so a
> twenty-station track is not twenty forms. New station fields must be added to
> `animationTracks` in `Preset.js` or they will be validated away silently. In
> the panel, a track-level Modulation block above the station list, and a
> collapsed per-station override under the station's `hold` field; leave room in
> the layout for T26's leg slot without building it.
>
> **One modulator per dwell for now.** Stacking a drift with a tremor is an
> obvious want; if it costs more UI than it is worth, ship one and say so in the
> entry rather than half-doing it.
>
> **Not in this task:** legs (T26), export, and animating the step-curve
> constants — the last is the strongest remaining knob and the one most likely
> to wreck the look, and it is its own decision.

**Done when**

- Each kind runs during a dwell, composes with the station's position, and
  vanishes at amplitude zero.
- Seeking to any step gives the same modulated position as playing to it.
- A station added while a tremor runs lands on the unmodulated position.
- Two tracks with identical modulator settings do not move identically.
- The same seed and animation reproduce the same image, verified by comparing
  buffers rather than by eye.
- Modulator amplitude follows a canvas rescale.
- A preset round-trips the track default and a per-station override.

---

## T25b — Waves per dwell, not cycles per 100 steps

- **Kind:** feature
- **Roadmap:** Phase 5.3
- **Touches:** `scripts/Animation.js`, `scripts/Panel.js`, `scripts/Preset.js`
- **Status:** done — see "Waves per dwell" in `docs/decisions.md`
- **Blocked by:** T25, which has landed

**Prompt**

> Found in use: the sine modulator's three parameters are hard to drive, and
> the reason is the unit. Frequency is "cycles per 100 steps", which is tied to
> nothing the user is looking at, and `phase` — the wave's starting angle — is
> the kind of number that is only ever right at zero.
>
> **Re-express the periodic modulators in waves per dwell.** Replace
> `frequency` with `waves`: the number of full cycles that fit in the phase the
> modulator is running on, so the argument is `2π · waves · τ / length`. At an
> integer `waves` the point ends the dwell exactly where it started it, however
> long the hold is — which is the property the user is reaching for and cannot
> get from a per-step frequency. `orbit` takes two (`waves`, `waves2`), `pulse`
> takes one. **Drop `phase`**: with the wave anchored to the dwell, zero is the
> only value at which the point both starts and ends at the station, so the
> parameter has nothing left to say. `drift` and `tremor` are untouched — they
> do not return anywhere and their `speed` stays per step.
>
> **`Animation.at` has to report the phase's length**, not only τ. Every dwell
> has a finite one inside a span: the hold before the first station is
> `first.time` long (τ runs from `-first.time` to 0 there, and an integer wave
> count still lands on zero at the station), a station's own hold is its
> `dwell`, and the terminal hold of a one-shot is `span - time`. A zero-length
> dwell has no time to modulate in: return no offset rather than dividing by it.
> T26 will want the leg's length the same way, so put it on the return value
> once, for both phase kinds.
>
> **Fix the orbit's start while here.** `x = A·cos(0)` puts the point a full
> amplitude away from the station in the first step of the dwell, and it jumps
> back at the end. The circle is currently *around* the station; a point holding
> at a station wants a circle *through* it: `x = A·sin(θ₁)`, `y = A·(cos(θ₂) − 1)`
> or the equivalent, so τ = 0 is the station, integer waves return to it, and
> nothing jumps. Say in the entry that the station is a point on the circle,
> not its centre.
>
> **Defaults that show something.** A slot switched to a kind with amplitude 0
> is invisible, and the first thing a user does is wonder whether it works. New
> defaults: amplitude 15 px, waves 1. `kind: none` stays the off state; the
> numbers are for when a kind is chosen.
>
> Rename the fields in `Preset.js`'s validation and in the panel's `FIELDS` with
> the model — there is no saved state to keep, per Project state. Frequencies
> and phases in existing files stop meaning anything; that is fine.

**Done when**

- A sine with `waves: 2` on a 200-step dwell crosses the station four times and
  is on it at τ = 0 and τ = 200; the same settings on a 50-step dwell do the
  same in 50 steps.
- An orbit is on the station at τ = 0 and back on it at the end of the dwell
  for integer waves, with no jump at either end.
- `phase` is gone from the model, the preset validation and the panel.
- Choosing a kind on a fresh slot moves the point visibly without touching a
  number.
- Seeking still gives the same position as playing to it.

---

## T26 — Modulators on a leg

- **Kind:** feature
- **Roadmap:** Phase 5.3
- **Touches:** `scripts/Animation.js`, `scripts/Panel.js`, `scripts/Preset.js`
- **Status:** done — see "A modulator belongs to a phase, so a leg has its own slot" in `docs/decisions.md`
- **Blocked by:** T25 and T25b, both landed — the units are waves per phase, and
  `at` already carries the leg's `length`

**Prompt**

> T25 built the modulators and put them on dwells. This task puts the same
> modulators on **legs**, so a modulator belongs to a phase in full — a dwell
> and the leg leaving the same station each carry their own, because they want
> different numbers: a held point wants to tremble in place, a moving point
> wants its *trajectory* shaped.
>
> Two kinds change meaning on a leg and the rest do not:
>
> - **sine** turns **perpendicular to the leg** — offset along the leg's normal
>   at the current point, so a curved leg weaves along its own curve. Offsetting
>   along the screen's y axis instead is easier to write and fights the leg's
>   direction; T25's vertical bob was the dwell's answer, not the general one.
> - **orbit** rides along the leg: the circle's centre is where the plan says the
>   point is, and moves with it.
>
> Drift, tremor and weight pulse are unchanged: an offset is an offset whether
> the centre is standing or moving.
>
> **τ restarts at the phase boundary.** A modulator on the leg starts from zero
> when the leg starts, not from wherever the dwell's modulator left off. The two
> are different phases with different settings and there is nothing to be
> continuous with. That means the *position* can step at the boundary by up to
> the two amplitudes combined — a tremor does not vanish at τ = 0 and a sine
> with a phase offset does not either. That step is inherent to independent
> phases and small at sensible amplitudes; if it shows, ramp each modulator's
> amplitude over a few steps at both ends of its phase, and say so. A jump
> *larger* than the amplitudes is a different thing: a bug in the phase
> information `at` returns, not in the modulators.
>
> **The leg's direction comes from `at`.** T25 was told to leave room for it on
> the return value; if it is not there, add it — the tangent of the leg at the
> current parameter, which for a quadratic Bézier is one line.
>
> **Storage and UI** follow T25 exactly: a **leg slot** beside the dwell slot on
> the station, inheriting the track default, validated in `Preset.js`, and shown
> under the station's leg row where T25 left the space.
>
> **Not in this task:** export, and the step-curve constants.

**Done when**

- Each kind runs during a leg, composes with the interpolated position, and
  vanishes at amplitude zero.
- The sine offsets perpendicular to the leg's tangent, on straight and curved
  legs both.
- A dwell and the leg leaving it can carry different settings, and the position
  is continuous at the station.
- Seeking to any step on a leg gives the same position as playing to it.
- A preset round-trips both slots.

---

## T27 — Timelapse export

- **Kind:** feature
- **Roadmap:** Phase 5.4
- **Touches:** `scripts/main.js`, `scripts/Panel.js`, `scripts/Params.js`
- **Status:** done — see "Timelapse export is a special play, not a mode" in `docs/decisions.md`
- **Blocked by:** T26, which has landed

**Prompt**

> Record the image building up while the timeline plays, as a video file.
> Watching a figure form is at least as good as the still it ends in, and with
> tracks it is repeatable: the same link gives the same film.
>
> **It is one button, and it is a special play — not a mode.** Pressing
> **Export timelapse** does, in order: switch to Exposure, clear the density,
> seek the clock to 0, restart the seeded stream (`spawnParticles`, the way a
> new exposure does), then play the timeline from the start and record, and
> **stop at the end** — `loop` is ignored, a film has an end. When it stops the
> exposure is paused, the file downloads, and the finished image stays on the
> canvas exactly as a normal run would leave it: gradeable, saveable as a PNG.
> Nothing about the panel changes state permanently; whatever was on before the
> export is restored after it, except that the exposure is now paused with a
> finished picture in it, which is the point.
>
> **Steps per frame, not frames per second.** The clock counts simulation steps,
> so the natural control is how many steps one video frame gets — a
> `stepsPerFrame` in `Params`, default 2. Each frame of the export runs that many
> `step()`s (the clock advances with them, as it already does), renders once,
> and captures once. This is the fixed-step mode T20's split was made for; do
> not add a second stepping loop, drive the existing one with a count. The
> Playback tab shows the resulting film length next to the control:
> `duration / stepsPerFrame` frames, and the seconds at the recorder's rate.
>
> **Record a hidden canvas, not the visible one.** The visible canvas carries
> the track, the station markers and the focal-point crosses, drawn after the
> blit; a film of the image must not have them. Give the export its own
> offscreen canvas that receives `putImageData(imageData)` per frame — the same
> trick `savePng` uses — and record *that* with `canvas.captureStream(0)` and a
> `MediaRecorder`. `captureStream(0)` means frames are pushed only when you call
> `requestFrame()` on the video track, so the recorder gets exactly one frame
> per export frame and nothing between.
>
> **Two traps in `MediaRecorder`, both known, neither worth a dependency:**
>
> - **It timestamps frames by wall clock.** If a 4K frame with bloom takes
>   250 ms to step and render, the video plays slower than the steps-per-frame
>   arithmetic says, because that is how long the frames really arrived. The
>   content is still complete and correct — every frame, in order, nothing
>   dropped. Per-frame timestamps would need WebCodecs plus a muxer, which is a
>   library; not now. Say so in the panel hint, in one sentence.
> - **Its default bitrate is low and the result looks smeared.** Set
>   `videoBitsPerSecond` explicitly and high — tens of megabits — and prefer a
>   VP9 `mimeType` when `MediaRecorder.isTypeSupported` says so, falling back to
>   whatever `video/webm` the browser gives. The file is `.webm`; name it like
>   the PNG, `n-ellipse-<seed>-<w>x<h>.webm`.
>
> **The live/export split does not happen here.** The roadmap expected this
> task to force it. It does not: the export renders at the canvas resolution
> with the current look, which is exactly what the live render does, so there
> are no different settings to pass and no reason to refactor `render` into a
> function of arguments. Leave it. If a *preview-quality* export is ever wanted
> that is its own task with its own reason.
>
> **While exporting, the panel is locked the way playing locks it**, and the
> Playback status line shows progress (`frame 340 of 600`). A second press
> during an export cancels it: recorder stopped, no file, state restored.
> Keyboard shortcuts that would start a new exposure (`r`, `e`) are refused
> during an export rather than silently wrecking it.
>
> **Not in this task:** a preview-resolution export, a PNG sequence, MP4,
> WebCodecs, and recording Live mode (nothing accumulates there, so there is
> nothing to watch build).

**Done when**

- One press produces a `.webm` whose first frame is an empty canvas and whose
  last frame is the finished image, with no overlay in any frame.
- The density buffer after an export is byte-identical to the one after playing
  the same timeline from a fresh exposure without recording — the recorder
  observes the run, it does not change it.
- Exporting twice from the same link gives the same final frame.
- The panel shows the film's frame count from `duration` and `stepsPerFrame`,
  and progress while it runs.
- Cancelling mid-export leaves no file and restores the previous state.
- `loop` on does not make the export run forever.

---

## T27b — Lock the whole Parameters tab during an export, and land the last frame

- **Kind:** bug
- **Roadmap:** Phase 5.4
- **Touches:** `scripts/Panel.js`, `scripts/main.js`
- **Status:** done — see the T27b paragraphs of "Timelapse export is a special play, not a mode" in `docs/decisions.md`
- **Blocked by:** T27, which has landed

**Prompt**

> Two things found reviewing T27.
>
> **1. The film can be wrecked from the Parameters tab.** The canvas refuses a
> `mousedown` during an export and the keyboard refuses every key but `s`, on
> the stated grounds that a hand on the figure would steer the film. The panel
> does not: `exportLocked` covers Aspect, Resolution, Particles, Reset, the
> transport, the seed, Load and the Playback controls, and nothing else. **Add
> focal point**, every station's `×`, the per-point `x`/`y`/`w` fields, the
> shared Weight slider, the Manual toggle, tolerance and the step-curve
> constants are all live. Any of them changes the simulation the recorder is
> observing — and adding a point runs `insertTrack(0)`, which shifts every
> track under the running export.
>
> Stop enumerating. Lock the **whole Parameters tab** while an export runs: walk
> the tab body's `input`, `select` and `button` elements and set `disabled`,
> restoring what each had before (the per-point `w` fields are already disabled
> in shared mode and must come back that way, not enabled). `exportLocked` can
> stay for the controls outside that tab. **The Look tab stays live on
> purpose**: the film is graded per frame, and changing the ramp or the bloom
> while it records is a legitimate thing to do, not an accident to prevent. Say
> that in the entry so nobody locks it later out of symmetry.
>
> **2. The last frame may not be in the file.** `finishExport` calls
> `recorder.stop()` in the same tick as the final `requestFrame()`. A frame
> requested from a `captureStream(0)` reaches the recorder asynchronously, and
> stopping immediately can drop it — a film whose last frame is one step short
> of the finished image on the canvas. **Check before fixing**: export, scrub
> the `.webm` to its very end, compare with the canvas. If it is short, defer
> the `stop()` by one animation frame (or a short timeout) after the last
> capture; if it is not, record in the entry that it was checked and how, so
> the question does not come back.

**Done when**

- With an export running, nothing on the Parameters tab accepts input, and when
  it ends or is cancelled every control is back in the state it was in — the
  per-point `w` fields still disabled in shared mode.
- The Look tab still works during an export.
- The exported file's last frame is the image left on the canvas, verified by
  scrubbing to the end, and the entry says so.

---

## T28 — One selected focal point, and three fixes to the Playback tab

- **Kind:** feature
- **Roadmap:** Phase 5 addendum
- **Touches:** `scripts/main.js`, `scripts/Panel.js`, `styles.css`
- **Status:** done — see "One selected focal point, and the hand wins over the track" in `docs/decisions.md`
- **Blocked by:** —

**Prompt**

> Four changes from using the Playback tab. The first is the substantial one and
> the other three are small; the first is also the only one that changes
> behaviour outside the tab.
>
> **1. A selected focal point, shared by the whole app.** Clicking a point on
> the canvas should select it, and that one selection should drive both **follow
> mode** and the **open track** on the Playback tab.
>
> Today the selection is `Panel.selectedTrack` — panel state, only set when the
> clicked point already *has* a track, because a point with no track falls
> straight through to plain dragging. And follow mode does not consult it at
> all: `update` in `main.js` writes `nEllipse.focalPoints[0]` from the cursor,
> hard-coded. So the two ideas have to be joined, and the selection has to move
> to where both readers can see it. It stays **interface state, not `Params`** —
> the same category as `showFocalPoints`, deliberately not saved.
>
> Clicking a point selects it whether or not it has a track; clicking empty
> canvas is the existing no-op (do not clear the selection on it — a
> mis-click would lose the open track). `s`-mode crosses should show which point
> is selected.
>
> **The existing bug this uncovers, confirmed in use:** follow mode writes point
> 0's position every frame in `update`, and `applyTracks` writes every animated
> point's position every `step` — which runs after it, in the same frame. So on a
> point that has stations, follow mode already does nothing at all, silently.
>
> **The resolution: while follow mode is on, the hand owns the selected point
> completely, and the track lets go of it.** Freehand steering is the feature
> this project is actually for, and it has to keep working on any point. So
> `applyTracks` **skips the selected point entirely** while `followFocalPoint`
> is on and the exposure is running — not apply-then-overwrite, which would
> leave a half-state where the position came from the cursor and the weight from
> the plan. The hand takes the whole point: position from the cursor, weight left
> where it was, modulators not applied either, since a modulator is part of the
> plan.
>
> Four rules that go with it:
>
> - **Only the selected point.** Every other animated point keeps following its
>   own track while you steer this one.
> - **Nothing is written into the track.** Follow mode overrides the output, not
>   the data, so switching it off restores the plan exactly and the film stays
>   reproducible. Do not "helpfully" record the gesture into stations — that is
>   T24's job and the user's decision.
> - **Switching follow off snaps the point back** to wherever the plan puts it at
>   the current step, and that snap draws a line into a running exposure. It is
>   expected rather than a bug; say so where the toggle is, in a sentence.
> - The station edit lock is untouched: follow mode does not edit stations.
>
> **This is deliberately not symmetric with T24's dragging rule**, where a track
> wins and the hand is refused. Dragging is a click that could be a mis-click;
> follow mode is a toggle the user turned on for one point on purpose. The
> asymmetry is the point — record it in the entry so it is not "fixed" later.
>
> **Do not give every point a track with one station at time 0 instead.** It
> looks like it would simplify this and it does the opposite: `Animation.at`
> returning `null` for an empty track is what means "this point stands where you
> left it", so a station at 0 would have `applyTracks` write that position back
> over every plain drag; a station is only editable with the clock sitting on it,
> so dragging would be refused at every step but 0; `animation.animated` would be
> true always, so every link and preset would carry one meaningless station per
> point and `applyTracks` would always run. **No track is the normal state** —
> `AGENTS.md` and `README.md` both promise it.
>
> **2. The mini bar sticks to the top of the Track section.** It is the one
> control that stays useful while the station list is scrolled, and right now it
> scrolls away with everything else. `position: sticky` with a background that
> covers the rows passing under it.
>
> **3. The mini bar scrubs on drag, not only on click.** It has a `mousedown`
> that seeks once. Add the `mousemove`/`mouseup` half so holding the button
> drags the playhead — pointer capture on the window, not on the element, or
> the drag dies the moment the cursor leaves the 16-pixel strip. It goes through
> the same seek path, so it stays snapped to stations and still repaints.
>
> **4. A whole station row is the click target for going to it.** Having to hit
> the small `station-time` button in the head is the most-reported annoyance.
> Make a click anywhere in the row seek to that station — and make it *look*
> clickable: a left border on the row, accented for the station the clock is on
> and dim otherwise, with a pointer cursor. The row already carries a `locked`
> class; a `current` class alongside it is the natural place for the accent.
>
> The trap: the row is full of controls. A click that lands on an `input`, a
> `select`, a checkbox, a label or the `×` must **not** seek — check the event
> target and return, the way the keyboard handler already skips events from
> inside `.panel`. Typing in a field must not move the clock, and removing a
> station must not seek to the station being removed.
>
> **Not in this task:** any other Playback layout change. More are coming from
> use and will be their own tasks.

**Done when**

- Clicking any focal point on the canvas opens its track on the Playback tab,
  whether or not it has stations.
- Follow mode follows the selected point, not point 0, and works on a point
  that has stations — the cursor drives it and the track does not fight back.
- Switching follow off puts that point back exactly where its plan says, with
  the track's data unchanged.
- The selection survives a mis-click on empty canvas and is not written to a
  preset or the URL.
- The mini bar stays visible while the station list scrolls, and dragging on it
  scrubs continuously, including when the cursor leaves the strip.
- Clicking anywhere in a station row that is not a control seeks to that
  station; clicking its fields, its checkboxes and its `×` does not.
- A station row looks clickable, and the row the clock is on is marked.

---

## T29 — A help icon, and far fewer standing hints on the Playback tab

- **Kind:** feature
- **Roadmap:** Phase 5 addendum
- **Touches:** `scripts/Panel.js`, `styles.css`
- **Status:** done — see "Help icons, and the Playback and Look tabs lose their standing hints" in `docs/decisions.md`. The premise that a status line already sat under the export button was false; one was added.
- **Blocked by:** —

**Prompt**

> The Playback tab explains itself at length and the explanations have become
> the noise. Every `p.hint` under a control is permanent, so text written once
> to teach a feature is then read a hundred times by someone who already knows
> it. Two changes: a way to put an explanation behind a hover, and a cull.
>
> **1. A help icon.** A small `?` beside a heading or a control; the explanation
> appears on hover as a tooltip. Build it as one helper on `Panel` — something
> like `help(parent, text)` appending a `<span class="help" title="…">?</span>`
> — so it is one call per use and the styling lives in one rule. `title` is
> enough: it needs no JavaScript, it is reachable by keyboard focus if the
> element is focusable, and this panel is built from native inputs on purpose.
> Do not build a custom hover-panel with positioning logic for this.
>
> Size it so it reads as an affordance and not as content: the hint colour, a
> circled or bracketed `?`, `cursor: help`. It goes on the same line as the
> heading it belongs to, not on a line of its own — a help icon that takes a row
> has saved nothing.
>
> **2. What to remove from the Playback tab**, named exactly:
>
> - **The Timelapse section's hint** — the paragraph starting "Starts a new
>   exposure and plays the timeline from the start" — goes entirely. The button
>   says what it does and the status line reports what happened.
> - **"While the shared Weight slider is in charge…"** goes. It answers a
>   question nobody has while looking at this tab; the shared-weight rule is
>   already enforced by the locked `w` fields, and the Parameters tab is where
>   weight is set.
> - **"A station can only be edited while the timeline is stopped and the clock
>   sits exactly on it…"** goes from its standing place. It is real and worth
>   keeping — move it behind a help icon on the **Track** heading, shortened.
> - **"Scrubbing back does not clear the image…"** goes from its standing place
>   too, the same way — it belongs with the same help icon or the Timeline
>   heading's.
> - **"Duration is counted in simulation steps rather than seconds…"** *stays*
>   where it is. It explains the unit of the control right above it, which is the
>   one case a standing hint earns its row.
> - **The two modulation paragraphs** ("Added on top of the plan while the point
>   holds…" and "The same, while the point travels…") go behind help icons on
>   the **Dwell modulation** and **Leg modulation** headings, and get **shorter**
>   — one sentence each. The unit facts (amplitude in pixels, waves per phase)
>   are worth keeping; the rest can go.
>
> **The file name belongs under the button that writes the file.** The Presets
> section's standing text names the JSON's contents, and `presetStatus` doubles
> as that line — the same paragraph is both the explanation and the "Saved
> as …" report. Leave Presets alone, but make the **Timelapse** section report
> its file the same way: the status line under the export button is where the
> `.webm`'s name shows up, not in a sentence written before anything was
> exported.
>
> **Leave the other tabs alone.** Parameters, Look and Render have their own
> hint density and are not the complaint. If a help icon obviously wants to
> replace one of those later, that is a separate task with its own list.
>
> **Do not delete an explanation that has no other home.** Everything above is
> either being moved behind an icon or is genuinely redundant with a control,
> a status line, or another tab. A rule that exists only in a hint — and the
> station edit lock is one — has to end up somewhere a user can still find it.

**Done when**

- A `?` icon next to a heading shows its explanation on hover and takes no
  extra row.
- The Playback tab has at most two standing hint paragraphs left: the duration
  unit, and the status line.
- The station edit rule and the scrub-does-not-clear rule are both still
  readable from the tab, behind an icon.
- The exported `.webm`'s name appears in the Timelapse status line, and the
  section has no paragraph before the first export.
- The other tabs' hints are unchanged.

---

## T30 — The colour ramp as a gradient strip with draggable stops

- **Kind:** feature
- **Roadmap:** Phase 4 addendum
- **Touches:** `scripts/Panel.js`, `styles.css`
- **Status:** done — see "The colour ramp is edited on a strip" in `docs/decisions.md`. The premise that the CSS fill is exact held to within one 8-bit level, measured, not bit-exact.
- **Blocked by:** —

**Prompt**

> Replace the Colours section's list of rows with a **horizontal strip showing
> the ramp itself, and a dot per stop that is dragged along it.** Grading is the
> thing done most on this tab, and a column of numbers is the wrong instrument
> for it: the ramp is a picture, so the control should be one.
>
> **The data does not change.** `params.gradient` stays an array of
> `{at, color}`, sorted, with the same meaning. This is a new editor for an
> existing model — do not touch `Gradient`, `Preset`'s array handling, or the
> base-colour read in `main.js`. An array in `Params` has its own branch in all
> three of `Preset.capture`, `strip` and `apply`; leave them alone.
>
> **The strip's fill is a CSS `linear-gradient` built from the stops, and it is
> exact rather than approximate** — worth knowing so nobody replaces it with a
> canvas later. `Gradient.sample` interpolates between 8-bit sRGB values
> linearly, and CSS `linear-gradient` interpolates in the same space by default,
> so the same stop positions and hex colours give the same colours. The flat
> holds outside the first and last stop match too. Verify it once by eye against
> a rendered image and say so in the entry.
>
> **The layout:**
>
> - The strip, with the gradient as its background and a dot per stop sitting on
>   it at `at × 100%`. The selected dot is marked (ring, or larger).
> - **Under it, one row for the selected stop only**: a colour input, its `at`
>   as a number for exact entry, and a remove button. Not a row per stop — the
>   strip is the list now. Removal keeps the existing floor: **two stops is a
>   ramp, one is a flat fill**, so the button is disabled at two.
> - **Double-clicking the strip adds a stop there**, in the colour the ramp
>   already has at that position — so adding one changes nothing until it is
>   moved, which is the property the current **Add stop** button has and must
>   keep. That button stays, with its existing widest-gap behaviour, because it
>   is the discoverable route and a double-click is not.
>
> **The trap, and it is the whole risk of this task: the stops are sorted, so
> dragging one past its neighbour changes its index under the cursor.** Anything
> holding an index — the drag, the selection, the fields below — silently
> switches to the neighbour mid-gesture. **Hold the stop object, not its index**,
> and re-find the index after each sort when one is needed. This is the same
> class of bug as retiming a station, which is why a station's `t` is applied on
> `change`; here the drag has to stay live, so identity is the answer instead of
> deferral.
>
> Two smaller ones:
>
> - **Capture the drag on the window, not on the dot.** The strip is a few
>   pixels tall and the cursor leaves it immediately. The mini bar on the
>   Playback tab does this already — same shape, and the same
>   `removeEventListener` care about holding the listener references.
> - **Every edit still goes through `touched()`**, or the image does not repaint
>   and the URL stops following the state. A drag fires continuously; that is
>   fine, the hash write is debounced by design.
>
> **What not to do:** do not add colour-space interpolation, easing between
> stops, a colour picker of your own, or presets of ramps. The section is being
> given a better instrument for the same model, nothing more.

**Done when**

- The Colours section shows the ramp as a strip, with one dot per stop.
- Dragging a dot moves that stop, and dragging one past another keeps moving
  **the same stop** — its dot does not swap with its neighbour, and the fields
  below keep describing the dot being dragged.
- The strip's colours match the rendered image's ramp.
- The selected stop's colour and position are editable below the strip, and the
  position can be typed exactly.
- Double-clicking the strip adds a stop that changes nothing until it is moved;
  **Add stop** still works.
- Removal is refused at two stops.
- The image repaints and the URL follows, during a drag as well as after it.
- `params.gradient` has the same shape as before, and a preset saved by the old
  panel still loads.
