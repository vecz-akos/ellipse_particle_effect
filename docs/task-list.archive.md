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
