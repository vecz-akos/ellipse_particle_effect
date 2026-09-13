# How to use this log

Newest entry first. Each entry records **why** something is the way it is —
especially the things that were tried, broke, and got replaced, so nobody
rediscovers the same failure.

Rules:

- **Entries are never edited after the fact.** If a decision changes, add a new
  entry at the top that says what it supersedes. The old entry stays as the
  record of what was true at the time.
- Big architectural calls get detail. Small ones (a rename, a moved file) get a
  few lines — this file grows forever, so keep the small stuff small.
- **No line numbers.** Refer to files, exported constants, functions and
  components by name; line references drift within a release.

Entry format:

```markdown
# Topic title

Date: YYYY-MM-DD

Paragraphs, tables, lists.
```

---

# Timelapse export is a special play, not a mode

Date: 2026-09-13

T27. One button on the Playback tab records the image building up while the
timeline plays, as a `.webm`. Watching a figure form is at least as good as the
still it ends in, and with tracks it is repeatable: the same link gives the same
film.

**It is a special play.** Pressing **Export timelapse** switches to Exposure,
clears the density, seeks the clock to 0, restarts the seeded stream
(`spawnParticles`, as a new exposure does), turns loop off — a film has an end —
and plays from the start, recording. When the one-shot reaches its end the
exposure is paused with the finished image on the canvas, gradeable and saveable
like any other, the file downloads, and the settings the export overrode (loop,
follow) go back. There is no export *mode* anywhere in `Params`: `exportRun` in
`main.js` is session state, an export is not something a link restores, and the
only trace it leaves is a finished picture.

**Steps per frame, not frames per second.** The clock counts steps, so the pace
is `params.animation.stepsPerFrame` (default 2): each export frame runs that
many `step()`s, renders once, and captures once. This is the fixed-step mode
T20's split was made for, and there is no second stepping loop — `update()`
calls `exportFrame()` instead of `step()` while an export runs, and
`exportFrame` drives the one existing `step()` with a count. The harness checks
what that has to mean: stepping in groups of 1, 2 or 7 with a render between
groups leaves the density **byte-identical** to stepping singly with a render
each time — the recorder observes the run, it does not change it. The empty
canvas is captured as the first frame before any step, so the film has
`ceil(span / stepsPerFrame) + 1` frames, which the tab shows with the seconds
that makes at 60 fps — the best case, see below.

**A hidden canvas is recorded, not the visible one.** The visible canvas has the
track, the station markers and the crosses drawn after the blit, and a film of
the image must not have them. The export owns an offscreen canvas that receives
`putImageData(imageData)` per frame — the same copy `savePng` makes — recorded
through `captureStream(0)` and a `MediaRecorder`. Zero frame rate means a frame
reaches the recorder only on `requestFrame()`, so it gets exactly one per export
frame and nothing in between.

**Two `MediaRecorder` traps, both accepted.** It timestamps frames by wall
clock: a 4K frame with bloom that takes 250 ms to step and render makes a film
that plays slower than the steps-per-frame arithmetic says, because that is how
long the frames really took. The content is complete and in order — nothing is
dropped. Per-frame timestamps would need WebCodecs plus a muxer, a dependency;
the tab's hint says so in one sentence. And its default bitrate smears a film of
fine traces, so `videoBitsPerSecond` is 40 Mbit/s and VP9 is asked for first,
VP8 then plain `video/webm` as fallbacks.

**One difference from a live run, on purpose.** `whitePoint` eases towards the
peak once per *render*, and an export renders once per frame rather than once
per step, so the tone map's white point lags differently during a film than
during a live run. The density is identical; only the intermediate frames'
normalisation differs slightly. When the export finishes the exposure is held,
`adaptation` snaps to 1 on the next render, and the picture on the canvas is
the one a live run would have left.

**Locked while it runs, cancellable with a second press.** The transport, the
duration, the scrub, the pace, the footer's Pause and Exposure buttons, the
seed, Load and Reset are disabled through one `exportLocked` list in `Panel`;
the keyboard refuses everything but the overlay toggle, and the canvas refuses
a hand on the figure. A second press stops the recorder without a file and puts
everything back — including the image that was on the canvas, from a copy of
the density taken at the start. The Playback status line shows `frame N of M`.

**The whole Parameters tab is locked, not a list of its controls** (T27b).
The first version enumerated — Aspect, Resolution, Particles, Reset — and left
Add focal point, the per-point fields, the shared Weight, Manual, tolerance and
the step-curve constants live, every one of which changes the simulation the
recorder is observing; adding a point even runs `insertTrack(0)` under the
running export. So `setExporting` walks the tab body's inputs, selects and
buttons, disables them all, and restores each to the state it had — the
per-point `w` fields are disabled in shared mode and come back that way, not
enabled. The snapshot is taken before the listed locks touch anything, since
some of those sit on this tab and a snapshot taken after would restore them
locked. **The Look tab stays live on purpose**: a film is graded per frame, and
changing the ramp or the bloom while it records is a legitimate thing to do —
watching the colour shift through the film turned out to be a feature. Do not
lock it later out of symmetry.

**The last frame, and a one-frame delay before `stop()`.** A frame requested
from a `captureStream(0)` reaches the recorder asynchronously, so stopping in
the same tick as the final `requestFrame()` could leave the finished image out
of the file. Checked in the browser by scrubbing an export to its end against
the canvas: the two looked "very similar", which at 600 steps and two per
frame is not a verdict either way — one missing step is invisible at that
length. The delay costs nothing, so `finishExport` stops the recorder one
animation frame after the last capture rather than leave the question open.

**Not done here, on the roadmap's own correction:** the live/export split. The
export renders at the canvas resolution with the current look, which is what
the live render already does; a preview-quality export would be its own task.

---

# A modulator belongs to a phase, so a leg has its own slot

Date: 2026-09-13

T26. The modulators T25 built now run on legs as well as dwells, and the
roadmap's structural call — a modulator belongs to a *phase*, not to a track —
is what the data does: a station carries `modulation.dwell` for its hold and
`modulation.leg` for the leg it departs on, each `null` to inherit the track's
default of the same name, and `Animation.modulatorFor` picks the slot by the
phase `at` reports. `SLOTS` is the list, so `rescale`, the preset and the panel
loop over it rather than naming each. A one-shot's last station has no leg and
the panel offers it no leg slot.

**Two kinds change meaning on a leg; three do not.** The sine swings across the
**leg's normal** — `at` now carries the leg's unit `tangent`, the chord for a
straight leg and the quadratic Bézier's derivative for a curved one, and
`modulate` takes a `normal` that is that tangent turned a quarter. On a dwell
the normal is screen-vertical, the T25 answer, since a dwell has no direction.
A curved leg therefore weaves along its own curve; the harness checks the
offset is perpendicular to the local tangent at every step. The orbit rides
along the leg with nothing changed: its circle is drawn relative to wherever
the plan says the point is, and after T25b the plan point is *on* the circle —
so the orbit starts on the station, leaves with the leg and arrives on the next
station, which is what makes the position continuous at the boundary for free.
Drift, tremor and pulse are offsets and do not care whether the centre stands
or moves.

**τ restarts at the boundary and the position does not jump — for the
periodic kinds.** A leg's τ counts from the end of the dwell, its `length` is
the time to the next station, and integer waves on both phases mean the dwell
ends on the station, the leg starts on it and the next dwell starts on it
again. The harness checks all three. A tremor or a drift does step at the
boundary by up to the two amplitudes combined; that is inherent to two
independent phases and small at sensible amplitudes, and no ramp was added — it
was not visible in use. A leg between two coincident stations has no direction
and takes the x axis, so the sine falls back to vertical there.

**The panel** adds a Leg modulation form under the Dwell one in the track's
block, and an "own leg modulation" checkbox under each station's leg row, the
dwell's under its hold — one `stationSlot` helper builds both.

---

# Waves per dwell

Date: 2026-09-13

T25b, found in use the same day T25 landed: the sine's three numbers were hard
to drive, and the reason was the unit. This supersedes the units paragraph of
"Modulators are functions of phase time" below.

**The periodic kinds now count waves per phase, not cycles per 100 steps.**
`frequency` became `waves`, the number of full cycles that fit in the phase the
modulator runs on, so the argument is `2π · waves · τ / length`. At an integer
count the point ends the dwell exactly where it began it, however long the hold
is — the property a user reaches for and a per-step frequency cannot promise.
`orbit` takes `waves` and `waves2`, `pulse` one. **`phase` is gone**: with the
wave anchored to the dwell, zero is the only value at which the point both
starts and ends on the station. Drift and tremor keep per-step behaviour — they
return nowhere, and drift's `speed` stays what it was.

**`Animation.at` reports the phase's `length`**, for dwells and legs alike so T26
does not have to add it. Every dwell has a finite one inside a span: the hold
before the first station is `first.time` long (τ runs from `−first.time` to 0
there, and an integer wave count still lands on zero at the station), a
station's own hold is its dwell, and a terminal hold — a one-shot's last
station, or a loop's whose dwell reaches the span — runs to the span. The
station itself opens its own dwell: `time === first.time` reports the dwell's
length, not the pre-hold's. **A zero-length phase gets no offset** rather than a
division by zero; a station with no hold has no time to wobble in.

**The station is a point on the orbit's circle, not its centre.** `A·cos(0)` put
the point a full amplitude away from the station in the first step and jumped it
back at the end. Now `x = A·sin(θ₁)`, `y = A·(cos(θ₂) − 1)`: τ = 0 is the
station, integer waves return to it, nothing jumps.

**Defaults show something.** A slot switched to a kind at amplitude 0 was
invisible, and the first thing anyone did was wonder whether it worked. A fresh
modulator has amplitude 15 px and one wave; `kind: none` stays the off state.

Presets saved with `frequency` and `phase` stop meaning anything — pre-release,
no saved state to keep.

---

# Modulators are functions of phase time

Date: 2026-09-13

T25. A track gives the plan; a **modulator** adds an offset on top of it — a
tremble, a bob, an orbit, a wander, a pulse of weight — and at amplitude zero
exactly the stations remain. This entry puts them on **dwells only**; T26 puts the
same mechanism on legs. The dwell came first because it is where a modulator
earns the most: a point held perfectly still burns a dead spot into the
exposure, and a point held still while it trembles keeps drawing structure in
one place.

**Every kind is a pure function of `(τ, seed, parameters)`, where τ is time since
the phase began.** This is the decision the rest follows from. A drift written
the obvious way — integrate a random step each frame — cannot be seeked: landing
the clock on step 300 would need the 299 steps before it replayed, and the same
seed would give a different film depending on how the clock got there. So drift
is a sum of three sines per axis with seeded frequencies and phases, and tremor
is a hash of `(seed, τ)` per step through `Random.hash`. Nothing in
`Animation.js` holds state between steps, and the harness checks the point
directly: for every kind, the value after evaluating 0…300 in order equals a cold
evaluation at 300.

**The seed is the run's seed, the track's id, the station's index and the slot,
never the simulation's `Random`.** Same rule grain follows. The simulation's
stream has to be consumed in a fixed order for a seed to reproduce an image; a
modulator drawing from it would make the particles depend on how long the
animation ran. The track's id is in the seed so two tracks with identical
settings do not move identically — which is the reason ids exist at all, and why
T24 went to the trouble of keeping them unique.

**`Animation.at` reports the phase.** It now returns `{x, y, weight, phase,
station, tau}`: which kind of phase the point is in, the station the phase
belongs to (a leg's is the station it leaves — the leg's control point already
lives there, and its modulator will too), and τ. Reading the modulator off the
same walk of the station list is what keeps it from disagreeing with a second
walk. `null` still means "no track". **τ on a dwell counts from the station's
time, so it is negative in the hold before the first station** — the point is
already standing, and a modulator that restarted at the station would stitch two
unrelated wobbles together there. A one-shot's hold to the end is the last
station's dwell, still counting. On a leg τ counts from the end of the dwell,
where the movement began.

**Where it composes.** `applyTracks` in `main.js` is the one place the plan and
the modulation become a point's position. Everything else reads the plan: the
station list, the canvas markers, and — the case the task named —
`Panel.addStation`, which used to copy `point.x, point.y` and would have frozen
one shaking instant into a station. It now reads `Animation.at` and falls back to
the point only for a track with no stations. On the canvas the moving dot shows
the *plan* and the cross shows the point; with a tremor running the two
disagree, which is the modulation made visible.

**The weight pulse lives in Manual weight mode**, exactly as station weights do
after "The shared weight is one number for every point and every station" below.
`applyTracks` adds the pulse only while `manualWeight` is on, and the panel locks
the pulse's numbers and greys the `pulse` option while the shared slider is in
charge. A pulse is a weight that differs from step to step; that is what Manual
means.

**Amplitude is pixels, so it rescales** with the stations in
`Animation.rescale`, by the shorter-side factor — the one isotropic number
available, since a wobble has no axis to pick between the two. Frequencies are
cycles per 100 steps and phases are degrees, because the clock counts steps and
those are the units a person can type.

**Storage and UI.** A modulator is one flat shape for every kind, so a slot can
change kind without losing the numbers it had and `Preset.js` validates one set
of fields. The track carries a default in `track.modulation.dwell` that every
station inherits; a station's own lives in `station.modulation.dwell`, `null` to
inherit — a separate key because `station.dwell` is already the hold's length,
and the `leg` slot goes beside it in T26. A preset carries the default always and
a station's slot only when it overrides, so an inheriting station comes back
inheriting; a slot that is present and malformed refuses the whole track list,
like every other damaged shape. On the Playback tab a **Dwell modulation** block
sits above the station list, and each station has an "own dwell modulation"
checkbox under its hold that reveals the same form, copying the track's default
as a starting point. The track default is editable whenever the timeline is
stopped — it is a track edit, not a station edit; a station's own form locks with
the station.

**One modulator per dwell.** Stacking a drift with a tremor is an obvious want;
the extra list-of-forms UI it would cost is not worth it until the single one has
been used, and the flat shape does not prevent it later.

---

# Stations are the track; a leg is what falls between two of them

Date: 2026-09-09

T24, Phase 5.2. Focal points move now, along a plan that is data rather than a
gesture.

**One ordered list, not two.** A track is a list of stations; each carries what
happens *at* it — position, weight, dwell — and how the point leaves it for the
next one. A **leg** is therefore never a separate object, and cannot be
half-made: no leg with one endpoint, no gap, no ambiguous order, and no second
list to keep in step. Deleting a station rejoins its neighbours by itself.

**A quadratic Bézier, not a cubic.** One control point per leg means one handle
to drag and two numbers to save, and it draws every arc this needs. The handle
belongs to the station the leg *leaves*, which is what makes "the curve is a
property of the leg" true without a leg object to hang it on. A new station's
control point sits on the station itself, so switching `curve` on changes
nothing until the handle is moved.

**The dwell clamp is what keeps motion continuous.** A dwell allowed to run past
the next station leaves the leg negative room, and the point then jumps from
where it is holding to somewhere along a leg it never started. Rather than teach
the evaluator to interpret that, `Animation.normalise` clamps every dwell to the
gap before the next station, on every edit and on every load — a hand-edited
preset gets the same treatment. A dwell that exactly *fills* the gap is left
alone: that is a deliberate hard cut, the panel shows the leg as `0 steps`, and
it is the user's to make.

**Editing is locked to the clock, and the lock is in the panel.** A station can
be edited only while the timeline is stopped *and* the clock sits exactly on it;
clicking a station's step number is what takes you there. The reason is honesty
rather than caution — the exposure accumulates, so a panel that let a past
station be rewritten would state one thing while the image showed another.
`Animation` has no notion of a past and a preset restores every station
regardless: only the panel refuses. One consequence, found in use: typing a new
`t` moves the station away from the clock, and the rule as stated would lock it
under the cursor mid-edit. So the clock follows — committing a `t` seeks to it,
and `snapTime` clamps to where the clock can actually stand (one short of the
span in a loop), or a station typed past the end would be unreachable for good.
*Committing*, not typing (T24c): applied per keystroke, 150 typed over a 5
passes through 1 and 15, and each would snap the station onto a neighbour, let
`normalise` clamp a dwell to zero that never comes back, and burn the figure's
detour into a running exposure — "the timeline is stopped" does not pause the
exposure. The other fields stay live; a wrong x for one keystroke is harmless.

That rule also settles the two-writers problem for free. A point under a track
and a point under the cursor would both write its position, with the last one in
the frame winning silently. Now there is only ever one writer: a point with no
stations is dragged exactly as before, a point with stations is dragged only
through the station the clock is on, and dragging one mid-leg is refused with a
message rather than ignored.

**Times are absolute, and snap to other tracks.** There is no per-track
duration; a station's time is a step inside the one global `duration`, and a
track whose last station comes early holds there to the end. Typing a time near
another *track's* station lands on it exactly, which is how two points are made
to arrive together. A station does not snap to itself or to its own neighbours —
that would make nudging a time one step at a time impossible.

**Tracks travel in the preset, ids included**, validated whole the way the
gradient is: one malformed station and the whole track list is refused, because
a half-read plan is a movement nobody chose. The ids matter because T25 seeds a
modulator's `Random` from them. Nothing is written when no track has a station,
so an un-animated figure's link stays the length it was.

**Two ways an id could stop being unique, both closed.** Caught in review before
this landed, and worth recording because the failure would have surfaced only in
T25, as two tracks trembling in lockstep — the one thing the identity exists to
prevent. First, the id counter is now raised past the **largest numeric suffix in
the file** rather than set from the number of tracks: a document numbered `t3,
t1` has two tracks and a highest suffix of three, so a counter set to three would
hand the next point a `t3` that is already taken. Second, a document that repeats
an id is refused whole, alongside the other malformed shapes — an untrusted file
is exactly where a duplicate comes from. The invariant the counter owes, stated
where it is minted: **`nextId` is greater than every numeric suffix currently in
the list.**

**Stations are figure, so they rescale with it.** Also caught in review.
`rescaleFocalPoints` takes a figure into a different canvas — a preset loaded
from another resolution, or the aspect and resolution dropdowns — by scaling
every point's position and weight. Stations were not scaled with them, and
because `applyTracks` runs straight afterwards, it wrote the *old* canvas'
coordinates back over the freshly rescaled points: for an animated point the
resize did nothing at all. `Animation.rescale` now applies the same three
factors to every station's position, control point and weight, and
`rescaleFocalPoints` calls it. This rarely showed, because a preset restores its
own aspect and resolution and the canvas usually matches — which is exactly why
it needed a check rather than a look.

**The shared weight is one number for every point and every station.** The third
review finding was a quiet contradiction rather than a bug: `applyTracks` writes a
station's weight onto its point every step, and with Manual off
`applySharedWeight` writes the slider's value onto every point — so on an
animated point the two overwrote each other and the Weight slider visibly did
nothing. Worse, the station's `w` field was editable in shared mode while the
per-point `w` on the Parameters tab was not, so a weight could be typed in
through the back door that the front door refused. Two resolutions were on the
table: make a point with stations leave the shared weight, or make the station's
weight live only in Manual mode. The first silently kills a slider for some
points and not others. The second is what landed, but stated the other way
round: the shared weight is not *ignored* by stations, it *reaches* them.
`applySharedWeight` writes the stations as well as the points, so the slider
sizes an animated figure exactly as it sizes a still one, `applyTracks` has
nothing different to say, and switching to Manual afterwards finds every station
holding the shared value — the same hand-over the per-point weights already had.
The station's `w` field is locked together with the per-point one, so the two
tabs agree about who may write a weight. The cost is that a figure cannot
breathe in shared mode; breathing is the figure's weights *differing*, which is
what Manual mode means, and the Track section says so.

**What the panel had to learn.** Derived values go stale on a keystroke: a leg's
length is two stations' times minus a dwell, so it is refreshed in place while
typing, and the list is only *rebuilt* on `change` — reordering under a cursor is
what the colour ramp's stops already avoid. The station locks are re-evaluated
every frame and written only when the set of unlocked stations changes.

**Verified** — the model against 27 checks (dwell, leg, curve, the loop's
join back to the first station, sorting, the clamp, and 600 samples proving the
evaluation is pure), the preset against 18 (round trip with ids, a fresh id for a
point added after a load, a document whose numbering skips a value, and six kinds
of damaged document each refused whole),
and the real `Panel` against 44 driven through a hand-rolled DOM: adding
stations, the lock behind the clock, refusing to remove a locked one, snapping,
the mini bar's click-to-seek, and the dwell clamp. The image itself: two runs at
the same seed and animation produce identical density buffers, an animated run
differs from a still one, and the point without a track ends exactly where the
by-hand workflow left it.

---

# Run state stays off `Params`

Date: 2026-09-09

T23b, correcting two things T23 got wrong and one it left rough.

**`Params.animation` holds settings only.** `playing` has moved to the
`Animation` instance, next to `time`. T23 put it in `Params` and argued that an
animation is part of the image rather than of the session; that was wrong for a
plain reason the entry below did not weigh — `Preset.capture` walks every key of
`Params`, so **a link saved mid-playback started the timeline on open**, which is
exactly what `exposing` sits in `SKIP` to prevent.

The fix could have been a nested skip list. It is not, because the division that
actually holds is *settings versus run state*, and expressing it as "run state is
not in `Params`" makes it structural: there is no code path in `Preset` that can
reach a field that is not there, so no future key has to be remembered and added
to a list. `Preset` is untouched by this change, which is the strongest form of
"easier to read".

The consequence is that loading a preset has to stop the transport explicitly,
which `applyPreset` and `resetParams` now do — along with seeking to 0, so a
loaded animation starts at its beginning. `exposing` keeps its old arrangement:
moving it would be a second change with its own risk, and `SKIP` already covers
it.

**Track ids restart with the track list.** `syncTracks` resets the counter, so
the same preset gives `t1…tN` however many points were added before it was
loaded. T23 left the counter monotonic, which meant the identity a modulator will
seed its `Random` from depended on what the user happened to do earlier in the
session — the same preset would have produced a different film in a fresh tab
than in a busy one. Carrying identity in the file itself is T24's problem, since
T24 is what gives a track content worth saving.

**A loop's clock runs 0…span-1.** `advance` wraps `span` back to 0, so `span` is
a step a looping timeline never occupies — but `seek` clamped *to* `span`, and
advancing from there landed on 1, silently skipping the first step of the run.
`seek` now takes the loop flag and clamps to `span - 1` for a loop; a one-shot
still ends on `span`, because that is what `finished` recognises. The scrub
slider's maximum follows the same rule, so the UI cannot offer a position the
transport will not hold.

Verified by extending T23's two suites rather than writing new ones: 36 model
checks and 27 panel checks, including that a captured document contains no
`playing` anywhere, that a `playing` hand-edited into a preset file finds nothing
to write to, that `syncTracks(3)` gives the same ids in a fresh instance and a
busy one, and that scrubbing a loop to its far right then advancing lands on 0.

---

# The animation clock counts steps

Date: 2026-09-09

T23, Phase 5.1. The timeline exists and nothing moves along it yet, which is the
intended outcome: this task fixes the clock and the shape of the data, and the
two tasks after it inherit both.

**Time is counted in simulation steps, never in milliseconds.** One step, one
unit. `Animation.advance` is called at the end of `step` in `main.js`, so after
N steps the clock reads N. Wall-clock time would make a run depend on how fast
the machine happened to be, which throws away exactly the reproducibility the
seeded `Random` exists for and which timelapse export will need — a film has to
come out the same twice.

**The consequence is visible, and it will look like a bug: pausing the exposure
pauses the animation.** Stepping is what drives the clock, and `space` stops
stepping. That is correct rather than incidental — while the exposure is held
nothing is being drawn, so an animation that kept running would advance past
frames that never reached the image. Say so in the UI rather than fixing it; the
Play button's tooltip does.

**Where the state lives.** `Params.animation` holds `duration` (in steps), `loop`
and `playing` — the tunables, edited through the panel's usual `read`/`write`
closures and restored by `Panel.sync()`. The current time is runtime state on the
`Animation` instance and is deliberately *not* in `Params`: it is not something a
user sets, and a preset that restored a half-played position would be restoring a
moment rather than an animation.

**`playing` is saved in a preset, unlike `exposing`.** The SKIP list exists so a
shared preset does not start burning an image or hand a point to the mouse.
Whether the timeline is running is a different kind of thing — it is part of the
animation someone authored, not of their session — so it travels. Worth a second
look if it turns out that opening a preset and having it immediately play is
unwelcome; the change would be one entry in `Preset`'s `SKIP`.

**Tracks are bound to focal points by position, and that is a trap.**
`NEllipse.addFocalPoint` **unshifts** — a new point takes index 0 and pushes
every existing one down. So the animation cannot rebuild its tracks from a count;
`addFocalPoint` inserts a track at 0 and `removeFocalPoint` removes the one at
the same index. Rebuilding by count alone compiles, runs, and silently hands
every track to its neighbour. Only the paths that replace the whole figure at
once — a preset, a reset — call `syncTracks`, where there is no order to
preserve.

A track holds an identity and nothing else. T24 adds a path and a weight, T25 a
stack of modulators; the identity is there because a modulator has to seed its
own `Random` from something stable, or two tracks tremble in lockstep. Ids are
handed out once and never reused.

**Verified**, since none of this is visible on screen: the model against 25
checks — the clock, looping, one-shot end, seek clamping, track insertion and
removal, identity uniqueness, and the preset round-trip including hostile input
— and the real `Panel` built against a hand-rolled DOM and driven through 24
more: play, pause, loop, scrub, duration, the readout's text, a finished
one-shot releasing its button, and `sync()` restoring all of it. And the claim
that nothing moves yet is a measurement rather than an assertion: 500 steps with
the timeline running produce a density buffer identical to 500 steps with it
stopped, while the clock reads 500 against 0.

---

# T21's negative results, re-measured — two of them were wrong

Date: 2026-09-09

Raised in review of T21: the negative results in "The post pass does the work it
cannot skip" are the weakest-supported numbers in it, and they are the ones
recorded as "do not retry". A false negative there closes a door permanently.
The objection was right. **Two of the five were wrong.**

The method was the fault. Those figures came from separate runs of a harness,
compared across runs. Timed properly — every variant once per round, nine
interleaved rounds of twenty iterations in one process — the spread within a
run is **1–4%**, not the "over 10%" that entry claims. The 10% is the spread
*between* runs, and comparing across runs is what made a 6% effect look like
noise.

| claim in the T21 entry | median vs the old code | spread | verdict |
| --- | --- | --- | --- |
| hoisting the two per-pixel `if`s | +0% | 4% | **holds** — genuinely nothing |
| removing the two divisions on their own | **+6%** | 2% | **wrong, it helps** |
| one noise value per cell without the skip | −1% | 2% | **holds** — genuinely nothing |
| folding `/256` and `/255` into the strength | **+27%, the fastest of all** | 2% | **wrong, it is not slower** |
| raw `Uint8Array` with the clamping written out | 11.8 ms against 11.0 | 3–4% | **holds** — 7% slower |

**Removing the divisions does help, and the shipped code already has it.** What
was recorded as a null result is a 6% one; it is invisible in the entry only
because the version that ships steps the column index along the scan instead of
dividing, so the gain arrived inside another change rather than as its own line.
No code changes here — the record does.

**Folding the divisions is the fastest thing measured**, 35.7 ms against the
37.0 of what ships, and the entry calling it slower was reading noise. **It is
still not adopted, for a reason that is not speed:** the folded form is not
bit-for-bit the same arithmetic, so its byte-identity rests on having checked a
few images rather than on an argument that holds for every image. Three and a
half percent does not buy out a provable invariant on a sketch whose whole point
is the picture. Recorded so the option stays open and priced, rather than
buried under a wrong number.

The general lesson, which is the part worth keeping: **a negative result needs
tighter measurement than a positive one**, because it is the one that gets
written down as permanent. Compare variants inside one process, interleaved, and
quote the spread next to the number.

---

# The browser is not slow, and that is the answer T7 was waiting for

Date: 2026-09-09

Every number in this log is from Node. `putImageData` is in none of them, and
the thing that actually matters — move a slider, see the image change — had
never been measured, because no agent working on this repo can observe it.

Reported from the running app after T21: **grading is real-time.** Changing the
ramp colours and the bloom parameters on a held exposure redraws without
perceptible lag, at the resolutions in use. It was already acceptable before
T21.

That settles what the queue was holding T7 for. T7's dirty-pixel scheme cannot
help grading at all — a render-parameter change dirties every pixel by
definition — so its whole remaining benefit is to the *running* exposure, which
is the part nobody is watching. It is the largest and riskiest change in the
queue, and it is now buying something nobody has asked for. **T7 is parked**,
and what would revive it is Phase 5 (exposures that run much longer) or Phase 6
(where a frame's cost is export time), not a frame-rate complaint.

Worth stating for whoever measures next: the honest limit of this benchmark is
that it cannot see the browser. When a decision turns on felt latency, the
measurement is a person moving a slider, and the task should say so instead of
implying the recorded milliseconds settle it.

---

# The benchmark's parts do not add up across configurations

Date: 2026-09-09

Raised in review of T21. The parts table gives one figure per stage, and it is
tempting to build a frame out of them — but each part is timed in one
configuration, and a stage's cost can depend on the image it is handed. The
benchmark now says so in its own output, under the table, rather than leaving a
reader to discover it by adding numbers that do not match a row.

Measured: `PostProcess.apply` costs 39.8 ms on a plain render and 42.1 ms on a
bloomed one at 1080p, 148.6 against 155.2 at 4K — 4–6% more in a frame that also
runs bloom, which is the configuration its part-time is *not* measured in.

The obvious explanation is wrong and is worth recording as such. T21 made the
pass data-dependent, so a bloomed image having fewer skippable pixels would
explain it — except it has *more*: 44% of pixels sit exactly at the base colour
against 41% at 1080p, 73% against 70% at 4K, and the share of the frame where
the vignette mask is exactly 1 is 57% either way. Fewer writes, more time. What
is left is that a frame with bloom also holds bloom's full-resolution buffers,
so the post pass walks its bytes against a colder cache.

The rule that follows: **compare a row with its own parts — that is what the
residual table is — and never with parts from a different row.**

---

# The post pass does the work it cannot skip

Date: 2026-09-09

T21. `PostProcess.apply` is 19% faster at both resolutions, and the vignette on
its own is 40–51% faster. The output is byte-identical — this is an
optimisation, not a change to the look.

**Two writes were doing nothing, and both are now skipped.** Neither is an
approximation; each one drops a write that would store the byte already there.

- **A vignette mask of exactly 1.** `1 - amount*smoothstep(0)` is exactly 1
  across the whole inside of the vignette, which at the default radius is 57% of
  the frame, and `base + (v - base)*1` returns `v` exactly for integers up to
  255. Three clamped writes per pixel, skipped, over more than half the canvas.
- **A silent grain cell.** At the default coverage 60% of cells produce no
  speck, and adding zero to a byte that is already a clamped integer cannot
  change it. Skipping also drops the luma, which is the grain's real per-pixel
  cost.

**One noise value per cell, not per pixel.** The lookup and the speck move to
the cell boundary, which is what makes the silent-cell test cheap enough to be
worth having. On its own this change is *not* worth having — see below.

Measured in one process, the previous implementation against the new one on the
same pixels, best of three rounds of twenty:

| configuration | 1080p before → after | 4K before → after |
| --- | --- | --- |
| vignette and grain | 45.5 → 36.9 ms (19%) | 144.2 → 117.4 ms (19%) |
| vignette only | 23.0 → 13.7 ms (40%) | 84.0 → 41.1 ms (51%) |
| grain only | 33.5 → 28.9 ms (14%) | 91.0 → 89.9 ms (1%) |
| cell 3, colour grain | 52.9 → 39.9 ms (25%) | 163.4 → 132.4 ms (19%) |

And through `npm run bench`, which also moves the frame it sits in — 1080p
settled goes from 83.8 ms to 62.4 ms with everything on:

| resolution | state | `PostProcess.apply` before → after |
| --- | --- | --- |
| 1920×1080 | early | 41.9 → 35.6 ms |
| 1920×1080 | settled | 43.9 → 35.8 ms |
| 3840×2160 | early | 127.6 → 122.2 ms |
| 3840×2160 | settled | 169.1 → 149.4 ms |

**Byte-identity, verified three ways.** Twelve settings — cell 1 to 4, colour
grain, coverage 0 and 1, a mask that is 1 everywhere and one that reaches the
corner, each effect alone, both off, a light ramp base — compared byte for byte
against the previous implementation at both resolutions. And the benchmark's own
consumption checksums are unchanged from the run before the change, which
exercises the whole chain rather than the pass alone.

**Grain alone barely improves, and that is the interesting part.** At cell 1 the
silent test flips per pixel on random noise, so the branch is unpredictable and
costs about what it saves — 1% at 4K. At cell 3 the same test runs in predictable
runs and the same code gains 19–25%. The skip is worth having because of the
vignette and the larger cells, not because of the default grain.

**What did not help, so it is not retried.** Every one of these was measured, at
1080p, against the same baseline:

- **Hoisting the two per-pixel `if`s into specialised loops.** No reliable gain;
  the difference sat inside the run-to-run spread, which on this machine is over
  10% for this loop.
- **Removing the two integer divisions on their own.** 45.9 ms against a 51.6 ms
  baseline, which is the same as writing `speck` out (39.0) achieved without
  touching them. The divisions are not the cost.
- **One noise value per cell without the skip.** 48.7 ms — worse than doing
  neither. The per-cell bookkeeping only pays for itself once something skips.
- **Folding the `/256` and `/255` into the strength constant.** 35.7 ms against
  28.7 for the version it was built on, so slower as well as inexact — the
  folded arithmetic is not bit-for-bit the same and would have needed the
  byte check to carry it.
- **The raw `Uint8Array` with the clamping written out.** Three writes cost
  12.0 ms that way against 10.9 ms through the `Uint8ClampedArray`. `AGENTS.md`
  forbids unifying the two byte paths on principle; this is the number behind the
  rule, and it says the rule is right.

**T19's structural suspicion was wrong, and this is the correction.** That entry
blamed "three clamped read-modify-writes per pixel" against
`DensityBuffer.render`'s single unclamped store. Timed on their own, three
clamped writes with the vignette's arithmetic cost 10.9 ms over 2.1 Mpx against
2.5 ms for an empty scan of the same loop — real, but nowhere near the 52 ms the
pass was taking. The cost was never the clamping. It was doing the work at all.

One correction to the entry below: it says T19's split of the pass into a
vignette and a grain half "does not reproduce". Measured on the benchmark's
paired footing it does — 22.0 ms and 30.7 ms at 1080p against T19's 26 and 32.
The caution was over-stated; the split is sound, and the bench now prints it.

---

# The benchmark is checked in, and T19's bloom gap was the harness

Date: 2026-09-09

T22. `bench/bench.js`, run with `npm run bench`, replaces the throwaway harnesses
T4 and T19 each wrote and threw away. One file, extended when a new measurement
is needed — a folder of per-task scripts rots into a fixture that looks like it
runs. It is named in `AGENTS.md` under "Verifying changes" so it stays working,
imports only from `scripts/`, and adds no dependency.

**Method, decided here rather than per measurement.** Five discarded warm-up
iterations and thirty timed ones — T19 used the same, which is why its figures
reproduce; it simply never said so. Every timed block is followed by a checksum
over the pixels, printed, so "the JIT removed the work" is ruled out rather than
assumed. And two things the measurement itself forced:

**One context per process.** Each resolution/fill combination runs in a forked
child that measures nothing else. **This is what T19's unexplained bloom column
was.** Its four contexts shared one process, so the configuration rows paid for
allocation and collection that the part timings, taken later in the same
process, did not. The same harness code with one context per process turns a
+3.4 ms gap at 1080p and +15.9 ms at 4K into −2.4 and −1.0.

Two other explanations were tested and are wrong, recorded so they are not
retried. **It is not `buildTable`** — the hypothesis T22 offered: it costs
0.42 ms at `top` 11171 and 0.24 ms at `top` 6158, and `top` is *smaller* at 4K
while the gap was larger, so the sign is wrong as well as the size. **It is not
warm-up**: 0, 1, 5, 20 and 50 warm-up iterations all give 104–105 ms for the same
block. **It is not a polymorphic timing helper**: the same work through a helper
that had seen all four flag combinations cost 104.7 ms against 105.4 ms through a
dedicated one.

**A stage that rewrites its own input is timed as a difference.**
`PostProcess.apply` works in place, so repeating it runs the second pass on its
own output; the image creeps towards the ramp's base colour, the grain's weight
test starts skipping pixels, and the stage measures cheaper than it is. It is now
timed as render-plus-post minus the same render alone. **This corrects T19's
figure upward** — 52.5 → 57.9 ms at 1080p and 140.3 → 168.0 ms at 4K — which
strengthens T21's case rather than weakening it. The bench prints a residual
column, row minus parts, as the standing guard: T19's gap would have been visible
on sight.

The reference numbers, from `npm run bench` on this machine:

| resolution | state | effects off | vignette + grain | bloom | all on |
| --- | --- | --- | --- | --- | --- |
| 1920×1080 | early, 25% fill | 9.2 | 46.9 | 30.3 | 72.5 |
| 1920×1080 | settled, 59% fill | 9.8 | 65.5 | 30.2 | 83.8 |
| 3840×2160 | early, 9% fill | 32.2 | 168.9 | 116.5 | 242.5 |
| 3840×2160 | settled, 30% fill | 32.6 | 201.4 | 111.4 | 272.1 |

| resolution | state | step | Bloom.apply | DensityBuffer.render | PostProcess.apply |
| --- | --- | --- | --- | --- | --- |
| 1920×1080 | early | 1.4 | 20.6 | 9.7 | 41.1 |
| 1920×1080 | settled | 1.2 | 20.5 | 10.5 | 57.9 |
| 3840×2160 | early | 1.4 | 79.3 | 31.7 | 127.0 |
| 3840×2160 | settled | 1.2 | 76.8 | 32.1 | 168.0 |

Residuals are 0.0 to 5.5 ms, against frames of 30 to 272 — the parts sum.

**Nothing in the previous entry's conclusions changes.** The post pass is still
the largest stage by a wide margin, still the only one that grows with fill, and
the ordering of T21 before T7 stands. One thing does not survive: T19's split of
the post pass into a ~26 ms vignette and a ~32 ms grain came from a difference of
two timings in a throwaway and does not reproduce. **T21 should re-measure that
split with the bench before optimising against it.**

---

# The post-process pass is the expensive one, not bloom

Date: 2026-09-09

T19. Measured the whole Phase 4 chain, the way "Density-to-colour lookup table"
measured T4: Node v24.15.0, the real modules, 20 000 particles, two focal
points, accumulating, 30-run averages. **Not the browser** — `putImageData` is
not in any of these numbers, so read the ratios.

Full frame render, milliseconds:

| resolution | state | effects off | vignette + grain | bloom | all on |
| --- | --- | --- | --- | --- | --- |
| 1920×1080 | early, 21% fill | 9.0 | 45.9 | 27.4 | 64.5 |
| 1920×1080 | 3000 frames, 59% fill | 8.5 | 60.8 | 30.3 | 78.9 |
| 3840×2160 | early, 7% fill | 32.6 | 132.2 | 107.7 | 216.2 |
| 3840×2160 | 3000 frames, 30% fill | 35.0 | 184.1 | 124.4 | 260.8 |

The parts, at 3000 frames:

| part | 1080p | 4K |
| --- | --- | --- |
| `step` — 20 000 particles | 1.3 | 1.2 |
| `Bloom.apply` | 18.4 | 74.7 |
| `DensityBuffer.render` | 8.5 | 33.8 |
| `PostProcess.apply` | 52.5 | 140.3 |

**The headline result contradicts what "Bloom belongs in the density" left
behind.** That entry called bloom "the expensive one" and it was, against a tone
map. Since vignette and grain landed, **the post pass costs about three times
what bloom costs**: 52 ms of a 79 ms frame at 1080p. `README.md` said the same
thing about bloom and has been corrected.

Neither half of the post pass is the culprit on its own — timed as a difference
against a bare render, the vignette is ~26 ms and the grain ~32 ms at 1080p, and
turning both on costs less than the sum. What is expensive is the pass itself:
three clamped read-modify-writes per pixel on the `Uint8ClampedArray`, against
`DensityBuffer.render`'s one unclamped 32-bit store — 8.5 ms for two million
stores versus 52 ms for the same two million pixels. It is also the only stage
whose cost **grows with fill** (37 → 52 ms), because the grain's weight test
skips pixels that still sit at the base colour.

Bloom reproduces its T18 figure (18 ms at 1080p against 23 ms measured then,
75 ms at 4K against 78 ms) — nothing regressed there.

**The other half of the question, from T20.** While the exposure is stopped and
nothing is touched, `update` steps nothing and `render` runs only on a raised
`needsRender`, so a held image costs nothing at all and an edit costs at most one
render per frame. That is read from the loop in `main.js`, not measured. So the
frame times above are the cost **while the exposure runs**, which is also when
nobody is grading — and the cost of grading a held image is one of these frames
per change.

**Recommendation: un-park T7, and widen it from the tone map to the post pass.**
Sixty of the seventy-nine milliseconds at 1080p are per-pixel maps whose output
depends only on that pixel and its coordinates — the tone map through the table,
the vignette through its cached mask, the grain through the tile and the pixel's
own luma. A pixel that did not change renders to the same byte it already holds,
so one dirty-pixel list serves both stages, and both drop from two million
pixels to twenty thousand. With bloom off that is a ~62 ms frame becoming ~2 ms.

**Bloom must stay outside that scheme.** A blur reads a neighbourhood, and the
20 000 hits per frame are scattered across the whole canvas rather than
clustered, so a dirty *rectangle* grown by the blur radius degenerates to the
full canvas on the first frame. With bloom on, T7 therefore leaves a floor of
~19 ms at 1080p and ~76 ms at 4K. That floor is what the live/export split on the
roadmap is for; it is not something T7 can fix, and micro-optimising the box
passes further was already ruled out in T18.

---

# Mnemonic keys, and Colours at the top of the Look tab

Date: 2026-09-09

The mode toggle moves from `c` to `e`. `c` was the old `clearCanvas` flag's
letter — see "The `record` mode and the tuned constants" — and named nothing
once that flag became `accumulate`; that entry's mention of "the `c` key" is
superseded here.

Adding and removing a focal point keep `+` and `-` and gain `a` and `x`: the
signs are the far side of the keyboard, the letters are under the left hand
where a repeated shortcut belongs. Both stay bound. Matching is case-sensitive
as everywhere else in the handler, so Shift-A does not add a point.

The Look tab now opens with Colours; Bloom, Tone map, Vignette and Grain keep
their order below it. Grading starts at the ramp, so it should not be the third
section down.

---

# Grain is sparse, coarse and follows the image

Date: 2026-09-08

Revises the grain half of "Vignette and grain on the bytes". The first version
put a noise value on every pixel of every frame, which is sensor noise, not film
grain: 98% of the frame moved, the empty canvas turned into static, and the
effect read as "dirty" at any strength worth having.

Three changes, all of them about *where* the grain is rather than how strong:

- **Cells.** One noise value per `size × size` block, so a speck is bigger than
  a pixel. At `size 2` a 400 px row changes value 80 times instead of 140.
- **Coverage.** Only noise past a cut gets through, and what is left is
  stretched back over the full range — so lowering coverage thins the grain out
  instead of fading all of it. The setting maps almost exactly onto the fraction
  of the frame that gets a speck at all: 0.3 touches 29% of pixels.
- **It follows the image.** Each pixel's grain is scaled by how far it is from
  the ramp's colour at 0 — the same base colour the vignette fades to. Empty
  canvas gets nothing, midtones get the most. This is automatic rather than a
  setting: grain on a blank background is the thing that looked wrong, and no
  amount of it looked right.

**The animated option is gone.** It moved the tile by a per-frame offset, which
under change-driven rendering (see "The exposure is not the redraw") only
happens while the exposure runs anyway — and a shimmering overlay on a still
image is noise about noise. One less thing in `Params`.

Defaults: `amount .15`, `size 1`, `coverage .4`, and `size` tops out at 4 px.
The strongest speck at those settings shifts a midtone by 19 levels out of 255,
and roughly two pixels in five get a speck at all.

---

# The footer is four buttons

Date: 2026-09-08

Revises the panel half of "The exposure is not the redraw" below; the split it
describes is unchanged. The footer is now four toggle buttons in two rows —
pause/resume and the mode, then the two overlays — instead of buttons plus
checkboxes plus a segmented pair. Buttons read better at this size, and the
overlays are the same kind of thing as the mode: a state you flip.

**One button for the mode, not two.** It shows the state it is in (`Live` or
`Exposure`) and switching is a click. That leaves the footer with one naming
inconsistency worth knowing about: the pause button is named for the *action*
(`Pause` while running) and the mode button for the *state*. Both are the
idiomatic choice for their kind of control, and the mode button lights up in the
same red the canvas frame wears in Exposure, so which one is a state is visible
rather than only readable.

**`New exposure` is gone**, commented out in `Panel.buildModes` rather than
deleted. Switching to Live and back throws the buffer away in two clicks, and a
third way to do the same thing earns its place only if that turns out to be
awkward in practice. `clearImage` stays in `main.js`: it is what the button would
call, and the repaint it triggers is the non-obvious half.

---

# The exposure is not the redraw

Date: 2026-09-08

T20. `animate` used to gate two unrelated things: stepping the particles into the
density buffer, and turning that buffer into pixels. The consequence only shows
up in the way the sketch is actually used — build an image up, stop, *then*
choose the colours and the bloom — because with the run stopped nothing on the
Look tab had any visible effect. The only way to see a change was to let it run
for a frame, which does not redraw: it burns another pass of twenty thousand
particles into a finished picture.

There are three states here, not two: the exposure steps, the image is drawn,
and the buffer either accumulates or is cleared each frame. The second one has no
business being tied to the first.

**Rendering is change-driven.** `render` runs when `needsRender` has been raised
and does nothing otherwise, so a paused exposure with nothing touched costs
literally nothing, and every Look control repaints the finished image at once.
The alternative — render unconditionally every frame — pays for bloom's 23 ms at
1080p forever, for an image that is not moving.

**One signal, two schedules.** `markStateChanged` already fired from every panel
edit, every drag, every shortcut, the resize and the preset paths, because it
schedules the URL hash write. It now also raises the repaint flag: the hash write
stays debounced by 400 ms, the repaint happens on the next frame. The stepping
path raises the flag **directly** and never calls `markStateChanged` — that would
push the hash deadline forward on every frame and the URL would silently stop
updating for as long as the exposure ran.

**Pausing stops the particles too.** Nothing consumes their positions while the
image is not being fed, so stepping them would be invisible work, and it would
slide the seeded stream by however long the app happened to be open. Verified:
120 frames straight through and 120 frames with a 250-frame pause in the middle
produce a byte-identical image.

**Follow mode stops with the exposure.** The whole point of pausing is to move
the cursor over to the panel; with follow tracking still live, that drags focal
point 0 across the picture on the way — and under change-driven rendering the
figure visibly wanders while you are trying to judge a colour. The toggle keeps
its state and starts following again when the exposure resumes.

**A held exposure snaps the white point.** `adaptation` exists to keep the
per-frame mode from flickering as the maximum moves. With nothing being added
there is nothing to smooth, and a brightness still drifting under repeated
repaints would make a gamma judgement impossible.

**The vocabulary went with it.** `animate` → `exposing`, driven by a Pause /
Resume button rather than a checkbox; `clearCanvas` → `accumulate`, inverted,
shown as a two-state **Live / Exposure** choice; "Clear image" → **New
exposure**, moved next to the pause button so the whole run control is in one
place; `.recording` → `.exposing`, with a quieter frame for a held exposure. The
old names were implementation words that had leaked into the UI — "clear canvas"
describes a call, not a mode, and nothing in this project has animated since the
density buffer replaced the alpha accumulation.

A **step-one-frame** button was considered and turned down: it is a smaller
version of exactly the manual flicking that caused the problem. So was a single
"finish the image" action that flips several things at once.

---

# Bloom belongs in the density

Date: 2026-09-08

Phase 4.3, T18. `scripts/Bloom.js` blurs a copy of the density buffer and adds it
back to the density; the tone map then sees the sum. `DensityBuffer.render` takes
an optional `source` array and the maximum that goes with it, and indexes the
colour table with `source[i]|0`.

**Linear space, not RGB.** Bloom is light spilling. Blurring the finished 8-bit
pixels spreads values that are already clipped and already quantised and comes
out flat and grey; done in the density, the halo simply lands lower on the ramp
than the core and takes the ramp's middle colour on its own. Nothing tints it,
and it follows the colours automatically.

**Three box blurs, not a Gaussian kernel.** A real separable Gaussian at the
radii this effect is interesting at is hundreds of taps wide, and the cost grows
with the radius. Three box passes approximate a Gaussian closely enough for a
halo and cost the same per pixel at radius 2 as at radius 128 — measured: 19.7 ms
at radius 8 versus 21.0 ms at radius 128, 1080p. Three boxes of half-width `r`
have a combined standard deviation of `sqrt(r² + r) ≈ r + ½`, which is where
`boxRadius` comes from.

**The white point follows the summed buffer.** `whitePoint` adapts towards
whatever `render` is actually reading. Leaving it on the raw density's maximum
clips the bright core to a flat blob as soon as strength goes up — that is the
bug this arrangement exists to avoid, and the reason `max` is returned from the
same loop that writes the sum.

**Truncating the index is fine.** The table is indexed by density because density
is an integer; a blurred float is not. `source[i]|0` costs one truncation and
keeps the table. The quantisation error is far below one step of the ramp, and
the alternative — a `log1p` and a `pow` per pixel — is exactly what
"Density-to-colour lookup table" measured its way out of.

**It is expensive, and the cost was worth chasing.** The first working version
ran 47 ms per frame at 1080p. Three fixes took it to 23 ms: the vertical box pass
now walks rows and keeps one running sum per column (striding down a column is
cache-hostile), the 2:1 upsample collapses to "three quarters of your own column,
one quarter of the neighbour you lean towards" with no per-pixel floor or clamp
left, and the clamp helper is written out inline in the two innermost loops.
4K is 78 ms. That is a preview-quality problem and belongs to T19, not to a
further micro-optimisation: the honest answers are a cheaper preview or an
offline export, both already on the roadmap.

**Nothing to invalidate.** Everything is recomputed from the density every frame,
so a `clear` needs no cooperation from `Bloom`; only the scratch buffers follow
the canvas size, which `resize` handles on its own.

---

# The vignette fades to the ramp's base colour

Date: 2026-09-08

Supersedes the plain multiply in "Vignette and grain on the bytes", the entry
below. Multiplying the channels darkens towards black, which is only right when
the ramp happens to start there — on the default white → black look it put a
grey ring on a white page. The edge now lerps towards `gradient.sample(0)`, the
colour of an empty canvas, so a light look gets a light vignette and a dark one
still gets a dark vignette. With a ramp that starts at black the two are
arithmetically identical, which is the check that was run.

`main.js` passes the colour in; `PostProcess` keeps no opinion about the ramp,
and defaults to black if nobody says otherwise.

---

# Vignette and grain on the bytes

Date: 2026-09-08

Phase 4.2, T17. `scripts/PostProcess.js` runs after the tone map, in one pass:
vignette first, grain last. Both are off by default, and while both are off the
pass does not run — no allocation, no loop, so today's frame cost survives the
feature.

**On `imageData.data`, not the `Uint32Array` view.** `DensityBuffer` writes
packed pixels through a Uint32 view and needs a byte-order-aware `pack` to do it;
a multiply-and-add per channel does not. The bytes are R, G, B, A in that order
on every machine, and `Uint8ClampedArray` rounds and clamps on write, so the
whole endianness question and all the manual clamping disappear. The two modules
touch the same buffer through the view that suits each.

**The vignette multiplier is cached, not computed.** A hypot and a smoothstep per
pixel per frame is the obvious version; the mask only changes when the canvas
size or one of the three settings does, so it is keyed on exactly that. Distance
is measured against the half-diagonal, which makes `radius = 1` the corner at any
aspect ratio.

**It could have been cheaper still and deliberately is not.** Applying the
falloff to the density before the tone map would be one multiply and no second
pass — and it would make the density a non-integer, which is what the colour
table is indexed by. The lookup table stays intact; the vignette pays for it.

**Grain has its own `Random`, seeded `"grain"`.** Everything in the simulation
draws from the one seeded stream, and a seed only reproduces an image because
that stream is consumed in a fixed order — a render effect pulling from it would
make the picture depend on how many frames had been drawn. Verified: a hundred
frames of post-processing leave the simulation's stream identical.

**Animated grain is the same tile read from elsewhere.** One 256×256 tile is
generated once; a per-frame offset moves the read position, so there is nothing
to regenerate. Monochrome grain reads one value for all three channels, colour
grain reads three places in the tile.

**The post-process is inside `draw`'s `animate` branch**, which is the only code
that writes `imageData`. Outside it, a paused sketch would grain the previous
frame's grain, and the image would drift while nothing was happening.

---

# A colour ramp instead of two colours

Date: 2026-09-08

Phase 4.1, T16. `Params.backgroundColor` and `foregroundColor` are gone;
`Params.gradient` is a list of `{ at, color }` stops over 0…1, and
`scripts/Gradient.js` samples it. The black → orange → white grading of the
renders in `../imgs/` was done afterwards in an image editor; it is a setting
now.

**It costs nothing.** The ramp is evaluated inside `buildTable`, once per density
value, and the pixel loop is still a single array index — the property T3 was
built for. `sample` writes into a scratch array the caller owns rather than
returning a fresh one, because it runs a few thousand times per frame.
`Gradient.from` caches the parsed stops against their own text, so hex parsing
happens when someone edits a stop, not sixty times a second.

**The default renders the old image byte for byte.** Two stops, `#ffffff` at 0
and `#000000` at 1, reduce the interpolation to exactly the lerp that was there
— verified over five frames of an adapting white point, every byte equal. That
was the acceptance check, and it is the reason the default is two stops rather
than something prettier.

**Sorting belongs to `Gradient`, not the panel.** The stored order is whatever
was typed; the ramp sorts its own copy. The panel does reorder the rows, but only
on `change` — sorting on every keystroke pulls the row out from under the cursor
while a position is being typed.

**Backward compatibility was explicitly dropped.** Presets and links written
before this entry do not load their colours (the project is work-in-progress and
nothing shipped depends on them); no version bump, since the rest of such a
document still applies and the ramp falls back to the default. `Preset` gained
three array-shaped cases in exchange: `capture` copies arrays with `map` because
spreading one gives `{0: …, 1: …}`, `strip` compares a whole array against the
default instead of diffing it key by key, and `apply` validates the stop list as
a unit — a half-read ramp is a colour scheme nobody chose. A four-stop link is
359 characters; the default ramp does not appear in a link at all.

---

# A Look tab, because grading happens after the image exists

Date: 2026-09-06

Phase 4.0. The tone map (`exposure`, `gamma`, `adaptation`, the two colours) left
the Parameters tab for a new **Look** tab, second of four, between Parameters and
Render. The split is by what a control does, not by how it feels: Parameters
shapes the simulation and most of it restarts the image, while nothing on Look
touches a particle — the density buffer is re-rendered every frame from the same
counts, so a look can be set on an image that finished accumulating an hour ago.
That is the actual workflow: draw first, grade later. Bloom, vignette, grain and
the gradient colormap join it as the rest of the phase.

This step deliberately moves controls and changes no maths. It is the one part of
Phase 4 with no visual consequence, so it is worth having alone in a commit —
anything that looks different afterwards came from the next step, not this one.

`Panel.sync`, `Preset` and the URL hash needed no change at all: a control is a
`read`/`write` pair over `Params` and registers itself in `this.controls`
wherever it is built, and the preset schema is `Params`' own keys. Which tab a
control sits on was never encoded anywhere, which is the point of the design.

Four tabs no longer fit 19rem at the body font size, so `.tab` drops to 12px.
Widening the panel was the alternative and it costs canvas.

---

# Reset means a fresh `Params`, not a stored snapshot

Date: 2026-09-06

The Parameters tab ends with a **Reset parameters** button. It writes a brand new
`Params` instance over the live one, drops the focal points for a single centred
one, clears the image and respawns — the state a first visit without a link
gives. Nothing is remembered anywhere: the constructor already *is* the
definition of a default, and `Preset.strip` compares against a fresh instance for
the same reason. A "factory settings" object next to it would be a second copy to
keep in step.

**The seed is not reset**, because it has no default — it is rolled, not
declared. Resetting the look while keeping the noise is also the useful half:
`r` is right there when a new seed is what you want.

It resets the mode toggles too, `SKIP` notwithstanding. Those are excluded from
presets because a shared link should not pause someone's simulation; a button the
user pressed on purpose is the opposite situation.

---

# The URL hash is a preset

Date: 2026-09-06

The hash used to hold the seed alone, which linked the noise but not the image
— everything else came from whatever the panel happened to be set to. It now
holds the whole preset document: `Preset.encode` writes it as base64url behind a
`p1.` marker, `Preset.decode` reads it back. One schema serves the file and the
link, so a field added to a preset is in the URL for free.

**Old links keep working.** A hash without the marker is treated as a bare seed,
exactly as before. The marker is matched as a version pattern, not a literal, so
a `p2.` link from a future build is *refused with a message* rather than quietly
run as a nonsense seed — losing an image silently is the worse failure. A hash
that claims to be a state link and cannot be read (damaged base64, bad percent
escape, unknown version) is reported to the console and the sketch starts from
its defaults; it is not a seed either.

**The link carries only what the defaults do not.** `Preset.strip` drops every
parameter still at its constructor value, and the per-point weights while the
shared weight is in charge — every point holds it, so they are derived, not
data. `apply` only touches keys that are present, so a missing key restores its
default on its own: no schema change and no version bump. Coordinates are
rounded to two decimals on capture, well below the integer `DensityBuffer.add`
truncates to. Together that took a four-point link from 844 characters to 322.

**The saved file keeps everything.** One capture, two serialisations. A link is
shared and ephemeral, so inheriting a later default is fine — arguably right. A
`.json` preset is long-lived, kept to reproduce an image months later, and a
default that shifts in a future version would quietly rewrite it. Only the URL
strips.

**`showFocalPoints` joined `animate` and `followFocalPoint` in `SKIP`.** The
crosses are a debugging overlay — T9 already kept them out of the exported PNG,
and someone opening a shared link should not get an image with crosses on it.

**The hash follows the state, but on a timer.** Every panel control reports an
edit through `Panel.touched`, dragging a focal point and the keyboard shortcuts
report their own, and each report arms a 400 ms timer that the animation loop
checks. The write goes through `history.replaceState`, so dragging a slider
leaves one URL rather than two hundred history entries.

A link runs about 230 characters with one focal point and 450 with eight. Short
keys or a compressor could shave more, but both mean a second schema to keep in
step with the file, and neither is worth that.

---

# Presets are a JSON file, and the file is not trusted

Date: 2026-09-06

`scripts/Preset.js` captures the seed, every `Params` field, the focal points,
and the canvas size the points were placed on, as one JSON document with a
`version`. The Render tab downloads it and loads it back.

**Three fields do not travel: `animate`, `followFocalPoint` and
`showFocalPoints`.** They are session state, not image state — a preset that
pauses the run, hands a focal point to the mouse, or drops a debugging overlay
on the image the moment it loads would be surprising, and none of them affects
what the image looks like once it is running. (`showFocalPoints` joined them
with the link-shortening work; see the entry above.)

**The canvas size is saved because the coordinates need it.** Focal points are
in pixels, so a preset made at 2560×1440 and loaded into a fitted window would
put the figure off-screen. Loading resizes the canvas from the preset's aspect
and resolution first, then scales the figure in with `rescaleFocalPoints` — the
same path a resolution change takes, so there is one rule for "the canvas
changed under the figure" rather than two.

**A preset file is user input.** `apply` validates the whole document before
writing anything, then copies only keys that already exist in `Params` and whose
type matches, nested objects included; unknown keys, wrong types and malformed
focal points are dropped. `resolution` is the one field allowed to be either a
string (`"fit"`) or a number. An empty focal-point list is legitimate — a
*missing* one means the file is not a preset, and is rejected. Half-applying a
broken file is worse than refusing it, so nothing is written until every check
has passed, and the Render tab reports the reason instead of failing silently.

---

# One weight for every focal point, and the end of `baseD`

Date: 2026-09-06

Per-point weights are the right model, but they are the wrong control for the
thing people do most often: making the whole figure bigger or smaller. That used
to mean editing every row by hand and keeping the numbers in step. The "Focal
points" section now opens with a **Manual** checkbox, **off** by default, and a
**Weight** slider. With Manual off — the normal case — one slider sizes every
point at once, including ones added afterwards, and the per-row `w` fields are
read-only. Tick Manual and each point carries its own weight again: the rows
become editable, a new point takes `NEllipse.unit_d`, and the slider is
disabled. The two are the same number seen twice, so exactly one of them is
editable at a time. Turning Manual off again leaves each point holding the value
it has; restoring what it had before would be cleverer and less predictable.

The slider runs from an eighth of the shorter canvas side to one and a half
times it, and `setWeightRange` moves it with the canvas.

The state (`manualWeight`, `sharedWeight`) lives in `Params`, and every
write goes through `NEllipse.setWeight`, so `d` is recalculated the one existing
way. `main.js` keeps `sharedWeight` equal to `unit_d` while Manual is on, so
switching back starts from the size the canvas suggests, and
`rescaleFocalPoints` scales it with everything else.

**`baseD` is gone.** `d` used to be `baseD + Σ weights`, with `baseD` a constant
belonging to no focal point — a leftover from the original code, which seeded
`NEllipse` with a target sum before any point existed. It made the shared weight
useless as a size control, since `d = baseD + n·W` is not proportional to `W`.

Folding it into the points looked like it would change the look of existing
seeds, and it does not — because the startup point was created with **weight 0**
to compensate for `baseD`. With `baseD = unit_d` and weights `[0]`, `d` is
`unit_d`; with no `baseD` and the startup point taking `unit_d` like every other
point, `d` is `unit_d` again, and the two stay equal for any number of points
(checked for one through four). So `baseD` was the first point's weight wearing
a disguise. `recalculateD` now reduces from zero, the startup point is added
with the ordinary default, and `d = n·W` under a shared weight — which is what
makes the slider a size control at all. A readout under the list shows the
resulting `d`, since with several points the number is no longer obvious.

---

# Recycle margin is symmetric now

Date: 2026-09-06

`particleCorrection` compared against `±tolerance * width`, which is measured
from the canvas origin — so the right and bottom edges were one canvas stricter
than the left and top. Unintended, and invisible until the panel put the number
in front of someone. It now keeps `tolerance` canvases of margin beyond every
edge, and `0` means "recycle as soon as it leaves the visible area".

The default drops from 3 to 1 at the same time, which is a tighter image than
before on all four sides. The old `AGENTS.md` line calling three screens
deliberate is superseded: three was a starting point, not a tuning result.

# Control panel, and the canvas as a render target

Date: 2026-09-06

Roadmap Phase 3, first pass. Three things landed together because they do not
work apart.

**One parameters object.** `Params` holds every tunable — canvas aspect and
resolution, particle count, recycle tolerance, the step-curve constants, the
tone map, the colours, the four mode toggles. The panel and the keyboard handler
both write it, the loop only reads it. This supersedes the "main.js owns all
mutable state as module-level `let`s" rule in `AGENTS.md`, which was right while
there were six flags and wrong the moment two writers appeared.

**The canvas is no longer the window.** It has its own pixel size, chosen from
an aspect ratio and a render resolution, and CSS scales it to fit the space left
next to the panel. `stage.clientWidth/clientHeight` is the available area, not
the canvas size.

The question this settled: should the dropdown offer aspect ratio only, with
resolution left to a later export step? No — **resolution is part of the look,
not an output setting**. The simulation is in pixels: the hand-tuned step curve
is in pixels, focal points are pixel coordinates, and 20 000 particles cover a
4K buffer a quarter as densely as a 1080p one. The same seed at a different
resolution is a *different image*, not a bigger one. So both controls are
exposed, and the panel shows the resulting pixel size.

The alternative — normalising the simulation to a 0..1 space so a seed is
resolution-independent — is the only route to "preview small, re-render at print
size", and it was rejected for now because it changes the meaning of the tuned
constants and therefore the picture. It stays open for the export work.

**Hand-written CSS, no framework.** The panel is native `range`, `select`,
`number`, `color` and `checkbox` inputs; a component library would have styled
none of the parts that actually needed styling. `styles.css` replaces the inline
`<style>` block in `index.html`. The "UI layer may use a library" split from
"Dependencies stay minimal" stands — it was just not worth spending here.

**Focal points became editable.** `FocalPoint extends Point` and carries its own
`weight`, so `NEllipse.d` is the sum of the per-point weights plus a base — a
single point's contribution can now be changed after it was added, which the old
"add a number to a running total" version could not do. `addFocalPoint(point, d)`
keeps its signature and promotes a plain `Point` to a `FocalPoint`. Points are
also draggable on the canvas, with the panel's number fields following the drag.
The empty `scripts/FocusPoint.js` placeholder is gone.

**Not in this pass**, and still open in Phase 3: presets as JSON, the full state
in the URL hash (only the seed is there), and re-render at a resolution
multiplier on export. PNG save writes the canvas at its current resolution.

# Density-to-colour lookup table

Date: 2026-09-06

`DensityBuffer.render` no longer computes the tone curve per pixel. Density is
always an integer (`add` only ever does `+= 1`), so `buildTable` fills a
`Uint32Array` indexed by density with packed RGBA, and the pixel loop is one
array index plus one 32-bit store through a `Uint32Array` view of the
`ImageData`. The curve is unchanged: `log1p(d * exposure)` normalised to the
white point, `pow(t, 1/gamma)`, then a lerp between the colours.

**Measured** (Node, the real modules, 1920×1080, 20 000 particles, two focal
points, 30-run averages — not the browser, so read the ratios rather than the
absolute numbers):

| state | fill | particle loop | render, before | render, after |
| --- | --- | --- | --- | --- |
| early | 16% | 1.6 ms | 24.2 ms | 8.0 ms |
| after 3000 frames | 59% | 1.6 ms | 46.1 ms | 12.5 ms |
| after 10000 frames | 78% | 1.5 ms | 52.4 ms | 11.6 ms |

Two things the measurement settled. The render loop was never close to the
particle loop — it was **fifteen to thirty times more expensive** from the first
frame, so the "dramatically faster" claim in the density-buffer entry was about
dropping the per-particle canvas calls, not about the frame as a whole. And the
cost still grows with fill, just from a much lower base: the remaining work is
the per-pixel store, which the table cannot remove.

Output is pixel-identical to the previous implementation — verified by rendering
both into separate buffers at the same seed and comparing all 8.3 million
channels, at three points in a run. `Math.round` in the table matches what
`Uint8ClampedArray` did on assignment.

**For Phase 4: this table is the colormap.** The black → orange → white grading
of the reference images is a different `buildTable` body, not a new code path.

# Seeded RNG

Date: 2026-09-06

Roadmap Phase 2. `Math.random` is gone from the simulation: `Random`
(mulberry32, seeded through an xmur3 string hash) is created once in `main.js`
and passed to `Particle.update`; particle spawning and `particleCorrection` draw
from the same instance. `init` calls `random.reset()`, so a run restarts the
stream from its seed.

**Why hand-written, when a package was on the table.** The user offered one.
Mulberry32 is six lines and beats the obvious candidate (`seedrandom`) on both
size and maintenance; the whole thing is behind one module, so swapping it for a
package later is a one-file change. This also keeps the "simulation stays
dependency-free" split from "Dependencies stay minimal" intact.

**Seed handling.** The seed is a short base-36 string, read from the URL hash on
load and written back there whenever it changes, so a run is a link. `r` rolls a
new one, which clears the density buffer and re-inits. `Random.randomSeed` is
the one remaining `Math.random` call in the codebase — it picks the seed, it is
not part of the simulation.

**What is reproducible, and what is not.** Seed plus parameters plus **window
size** determine the run: `init` spawns from the stream, so a different canvas
size consumes it differently. Mouse-driven focal points (`f`, `+`) break
determinism too, by design — they are input, not state. Making the render
size-independent is Phase 3/4 work (re-render at resolution from a seed), not
something this phase promised.

# The density buffer, and the fade that came with it

Date: 2026-09-06

Roadmap Phase 1. `draw` no longer draws: it increments a `Float32Array` of
`width * height` hit counts (`DensityBuffer`) and blits one `ImageData` per
frame. This supersedes the per-particle `beginPath` / `arc` / `fill` at alpha
`44` / `16`, and with it the `record` flag — brightness is now `exposure` and
`gamma` in `main.js`. Real-time rendering got dramatically faster, as expected:
the per-particle cost is one array write.

**Tone map.** `log1p(density * exposure)`, normalised to a white point, then
`pow(t, 1/gamma)`, then a lerp from the background to the foreground colour.
Values around `exposure = .9`, `gamma = .5` were the first ones that looked
right; treat them as a starting point, not a result.

**The white point is adaptive, and that is what makes old traces fade.** It is
not the raw running maximum but a value that lags it
(`whitePoint += (max - whitePoint) * adaptation`). The lag was added for a
narrow reason: in per-frame mode the frame maximum jumps around and normalising
by it flickers.

The interesting consequence was unplanned. In accumulating mode nothing in the
buffer ever decreases, but the white point keeps rising as the densest region
grows, so every *older*, no-longer-fed region gets quieter relative to it. The
image behaves like a long exposure with a slowly closing aperture: shapes the
focal points only visited briefly sink back into the background, while the ones
still being fed stay bright. This reads as motion in a way the old fixed-alpha
accumulation never did, so it stays.

Knobs, if it ever needs taming: `adaptation` (lower = slower fade), or dropping
the normalisation entirely for a fixed white point (no fade at all, and
per-frame mode goes back to flickering).

**Resize keeps the image.** `DensityBuffer.resize` copies the overlapping
region row by row. The particles are still reallocated by `init` — only the
accumulated density survives.

# Dependencies stay minimal

Date: 2026-09-06

This is a hobby graphics sketch, not a product. Keep the dependency list short
— but "short" is the goal, not "empty". The split that matters is **which layer**
a package would land in:

**The simulation and the drawing stay dependency-free.** `Point.distance` and
`NEllipse.calcDistance` are the entire math layer; a particle framework or a
vector-math package would trade twenty lines of arithmetic for an API to learn
and a version to track. The planned post-processing (colour grading, bloom,
vignette, grain — currently done by hand in an image editor after the fact) is a
fragment-shader or offscreen-canvas job and needs no package either.

**The UI layer is fair game for a library.** The sketch is heading towards real
controls — an image-export button, a couple of sliders for the tuned constants,
input fields for focal-point coordinates and colours — and hand-rolling styled
form controls is exactly the kind of work worth outsourcing. A CSS framework
(Tailwind, Bootstrap or similar) is a reasonable addition when that UI arrives.

So the test before adding a package is not "can I avoid it" but: does it touch
the canvas loop, or the chrome around it? Chrome, yes; loop, write the fifteen
lines.

# Vite as the only devDependency

Date: 2026-09-06

The project was a bare `index.html` plus `scripts/*.js` opened from the
filesystem. It is now an npm project (`package.json`, `type: "module"`) with
**one** devDependency: Vite.

What it buys, and why the alternatives lost:

| Option | Why not |
| --- | --- |
| Keep it dependency-free, open `index.html` directly | Works, but `file://` blocks some browser APIs and there is no reload loop; also nowhere to hang future tooling |
| A plain static server (`npx serve`, `http-server`) | Solves the origin problem only — no hot reload, no production bundle |
| Webpack / Rollup / Parcel | Configuration cost for a five-module sketch |
| **Vite** | Zero-config for vanilla ES modules, hot reload while tuning constants, `npm run build` for a distributable |

`vite.config.js` sets `base: "./"` so a build in `dist/` still opens straight
from the filesystem — the one property the pre-Vite setup had that was worth
keeping. See also [Dependencies stay minimal](#dependencies-stay-minimal).

# "Simulated annealing" is a name, not an implementation

Date: 2026-09-06 (recorded retroactively; behaviour dates from the first commits)

The repository name says simulated annealing. **The code does not implement
it** — there is no energy function, no acceptance probability, no cooling
schedule, and no per-particle temperature that decays over time.

What `Particle.update` actually does: it takes the particle's error against the
n-ellipse (`NEllipse.calcDistance` — the absolute difference between the sum of
distances to all focal points and the target `d`), maps that error to a step
length, and moves the particle that far in a uniformly random direction.

```
error = |Σ distance(particle, focalPoint) − d|
step  = sqrt(error + 128) * 8 − 90
```

The step length is the only thing carrying the annealing analogy, and it is
governed by **position, not time**: on the curve the error is zero and the step
is about 0.5 px, so particles effectively freeze there; far away the step is
large and they wander. The picture emerges because the slow regions are exactly
the n-ellipse.

This matters because the obvious "fix" — adding a real cooling schedule — would
destroy the effect. The system never converges by design; it stays in permanent
motion and the image is the accumulated trace.

# The `record` mode and the tuned constants

Date: 2026-09-06 (recorded retroactively)

Several magic numbers in `main.js` and `Particle.js` are hand-tuned to the look
in the reference images, not derived from anything. They are not oversights:

| Value | Where | Role |
| --- | --- | --- |
| `128`, `8`, `90` | `Particle.update` | Step-length curve. Chosen so the step at zero error is a sub-pixel ~0.5 px. Changing any one of them changes how tightly particles hug the curve |
| `20_000` | `init` in `main.js` | Particle count. Trades frame rate for density; was 10 000 originally |
| `44` / `16` | `draw` in `main.js` | Per-particle alpha as a hex suffix. `44` for live view, `16` for the low-alpha accumulating pass |
| `3` (`tolerance`) | `particleCorrection` | Particles are recycled only once they are three screens out, so the wandering fringe stays visible |

`record` exists because the interesting output is the **accumulation**: with
canvas clearing off, thousands of near-transparent dots build up the x-ray-like
layering over many frames. It toggles itself inside `draw` in tandem with
`clearCanvas` (the `c` key) so that the first frame after switching still paints
a background, and every frame after that draws on top of the previous one.
