// The timeline, and where every focal point is on it.
//
// **Time is counted in simulation steps, never in milliseconds.** Wall-clock
// time would make a run depend on how fast the machine happened to be, which
// throws away the reproducibility the seeded Random exists for. See "The
// animation clock counts steps" in docs/decisions.md.
//
// The settings live in Params (duration, loop) and are passed in, the way Bloom
// and PostProcess take theirs. What lives here is the runtime state a preset
// must not carry: whether the transport is running, where the playhead sits, and
// the tracks. Preset walks Params, so anything kept off Params cannot be saved
// by any future code path — see "Run state stays off Params" in
// docs/decisions.md.
import Random from "./Random.js"

// The vocabulary is fixed and worth using exactly — see "The words this phase
// uses" in docs/roadmap.md. A **track** is one focal point's whole plan: an
// ordered list of **stations**. A station is a position and a weight at one
// absolute time, plus a **dwell** it is held for and how the point travels to
// the *next* station. The **leg** between two stations is not a separate object:
// modelling it as one lets the list hold a leg with one endpoint, a gap, or an
// ambiguous order, and every one of those becomes a validation branch.
//
// The identity is what seeds a modulator's noise, so two tracks do not tremble
// in lockstep. `modulation` holds the track's defaults, one per phase kind, that
// its stations inherit.
export const SLOTS = ["dwell", "leg"]
const track = (id) => ({ id, stations: [], modulation: { dwell: modulator(), leg: modulator() } })

// `curve` bends the leg to the next station through the single control point
// (cx, cy) — a quadratic Bézier, so one handle to drag rather than two. `dwell`
// is time held *at* this station, and it eats into the leg that follows.
// `modulation.dwell` is this station's own modulator for that hold and
// `modulation.leg` for the leg it departs on, each null to take the track's.
export const station = ({ time=0, x=0, y=0, weight=0, dwell=0, curve=false, cx=0, cy=0, modulation=null }) =>
    ({ time, x, y, weight, dwell, curve, cx, cy,
        modulation: {
            dwell: modulation && modulation.dwell ? modulator(modulation.dwell) : null,
            leg: modulation && modulation.leg ? modulator(modulation.leg) : null
        } })

// ---- modulators ---------------------------------------------------------
//
// A modulator is an offset added on top of what the plan says, never a
// replacement — at amplitude zero exactly the stations remain. Every kind is a
// **pure function of (τ, seed, parameters)**, τ being time since the phase
// began: nothing here holds state between steps, so seeking to step 300 gives
// the same answer as playing to it. A drift written as a random walk could not
// do that — see "Modulators are functions of phase time" in docs/decisions.md.
//
// The periodic kinds count **waves per phase**: `waves` full cycles fit in the
// dwell the modulator runs on, however long it is, so at an integer count the
// point ends the hold exactly where it began it. A per-step frequency could not
// promise that, and the starting angle it needed was only ever right at zero —
// see "Waves per dwell" in docs/decisions.md. Amplitude is pixels (weight
// pixels for the pulse); drift's `speed` is per step, since it returns nowhere.
// The parameters each kind reads:
export const KINDS = {
    none: [],
    sine: ["amplitude", "waves"],
    orbit: ["amplitude", "waves", "waves2"],
    drift: ["amplitude", "speed"],
    tremor: ["amplitude"],
    pulse: ["amplitude", "waves"]
}

// One flat shape for every kind, so a slot can change kind without losing the
// numbers it had, and a preset validates one set of fields. The numbers default
// to something visible: a kind chosen on a fresh slot should move the point
// before anyone touches a field. `none` is the off state.
export const modulator = ({ kind="none", amplitude=15, waves=1, waves2=1, speed=1 }={}) =>
    ({ kind: kind in KINDS ? kind : "none", amplitude, waves, waves2, speed })

const TAU = Math.PI*2
const angle = (waves, tau, length) => TAU*waves*tau/length

// A hash of (seed, τ) mapped to -1…1: the shake is different every step and the
// same on every replay.
const unit = (seed, tau, axis) => Random.hash(`${seed}:${tau}:${axis}`)/4294967296*2 - 1

// Drift is a sum of three sines per axis with seeded frequencies and phases: it
// wanders without repeating within any run of sensible length, and it is a
// function, not a walk. The frequencies spread around `speed`.
const drift = (m, tau, seed) => {
    const own = new Random(seed)
    let x = 0, y = 0
    for (let k = 0; k < 3; k++) {
        x += Math.sin(TAU*m.speed*(.5 + own.next())/100*tau + own.angle())
        y += Math.sin(TAU*m.speed*(.5 + own.next())/100*tau + own.angle())
    }
    return { x: m.amplitude*x/3, y: m.amplitude*y/3, weight: 0 }
}

// The offset a modulator adds at τ into a phase `length` steps long. `seed`
// already carries the run, the track, the station and the slot, so two tracks
// with the same settings differ. A phase with no length has no time to
// modulate in, so it gets no offset rather than a division by zero. `normal`
// is the direction the sine swings in: screen-vertical on a dwell, which has
// no direction of its own, and the leg's normal on a leg, so a curved leg
// weaves along its own curve rather than fighting it.
const NONE = { x: 0, y: 0, weight: 0 }
const VERTICAL = { x: 0, y: 1 }
export const modulate = (m, tau, length, seed, normal=VERTICAL) => {
    if (!m || m.kind === "none" || m.amplitude === 0 || !(length > 0)) return NONE
    switch (m.kind) {
        case "sine": {
            const swing = m.amplitude*Math.sin(angle(m.waves, tau, length))
            return { x: swing*normal.x, y: swing*normal.y, weight: 0 }
        }
        // The station is a point *on* the circle, not its centre: τ = 0 is the
        // station, integer waves bring the point back to it, and nothing jumps
        // at either end of the hold. A circle around the station would put the
        // point a full amplitude away in the first step.
        case "orbit":
            return {
                x: m.amplitude*Math.sin(angle(m.waves, tau, length)),
                y: m.amplitude*(Math.cos(angle(m.waves2, tau, length)) - 1),
                weight: 0
            }
        case "drift":
            return drift(m, tau, seed)
        case "tremor":
            return { x: m.amplitude*unit(seed, tau, "x"), y: m.amplitude*unit(seed, tau, "y"), weight: 0 }
        case "pulse":
            return { x: 0, y: 0, weight: m.amplitude*Math.sin(angle(m.waves, tau, length)) }
    }
    return NONE
}

const lerp = (from, to, t) => from + (to - from)*t

// Quadratic, evaluated the long way rather than through a helper: this runs once
// per animated point per step.
const bezier = (from, control, to, t) => {
    const u = 1 - t
    return u*u*from + 2*u*t*control + t*t*to
}

// What `at` returns: the plan's position and weight, plus which phase the point
// is in — the station index it belongs to, τ, time since the phase began, and
// `length`, how long the phase is — so a modulator can be read off the same
// walk of the list rather than a second one that has to agree with it. A dwell
// before the first station or after the last is still a dwell: the point is
// standing.
const sample = (at, index, tau, length) =>
    ({ x: at.x, y: at.y, weight: at.weight, phase: "dwell", station: index, tau, length })

// The leg's direction at `t`, unit length: the derivative of the quadratic
// Bézier, 2(1−t)(C−P₀) + 2t(P₂−C), or the chord when the leg is straight. A
// leg between two coincident stations has no direction; it takes the screen's
// x axis so the sine's normal falls back to vertical, the dwell's answer.
const heading = (from, to, t) => {
    let x, y
    if (from.curve) {
        const u = 1 - t
        x = 2*u*(from.cx - from.x) + 2*t*(to.x - from.cx)
        y = 2*u*(from.cy - from.y) + 2*t*(to.y - from.cy)
    } else {
        x = to.x - from.x
        y = to.y - from.y
    }
    const size = Math.hypot(x, y)
    return size > 0 ? { x: x/size, y: y/size } : { x: 1, y: 0 }
}

// Where the point is partway along the leg out of `from`. The control point
// belongs to the station the leg leaves, so a curve is a property of the leg
// rather than of either endpoint — and so is the leg's modulator, which is why
// the leg is reported under the departing station's index. `tangent` is the
// leg's direction here, for a modulator that wants to know which way is along.
const travel = (from, to, t, index, tau, length) => ({
    ...(from.curve
        ? { x: bezier(from.x, from.cx, to.x, t), y: bezier(from.y, from.cy, to.y, t) }
        : { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) }),
    weight: lerp(from.weight, to.weight, t),
    phase: "leg", station: index, tau, length,
    tangent: heading(from, to, t)
})

export default class Animation {
    constructor() {
        this.time = 0
        this.playing = false
        this.tracks = []
        this.nextId = 1
    }

    // Ids are handed out once and never reused, so a track keeps its identity
    // while points are added and removed around it.
    //
    // The invariant every writer of `nextId` owes: it is greater than the
    // numeric suffix of every id currently in the list. `syncTracks` restarts it
    // alongside the ids it mints, and `Preset.apply` raises it past whatever the
    // file carried — a counter set from the number of tracks instead would repeat
    // an id the moment a document skipped a number.
    newTrack() {
        return track(`t${this.nextId++}`)
    }

    // The set of focal points is fixed for the length of an animation — see
    // "Settled: focal points do not appear or disappear" in docs/roadmap.md — so
    // these three run when the figure is edited, never from the timeline.
    //
    // Tracks are bound to points by position, and NEllipse.addFocalPoint
    // unshifts, so a new point shifts every existing index. Rebuilding by count
    // alone would silently hand each track to its neighbour.
    insertTrack(index) {
        this.tracks.splice(index, 0, this.newTrack())
    }

    removeTrack(index) {
        if (index >= 0 && index < this.tracks.length) this.tracks.splice(index, 1)
    }

    // For the paths that replace the whole figure at once — a preset, a reset.
    // Order is not preserved because there is no order to preserve: the points
    // that were there are gone.
    //
    // The counter restarts, so the same preset gives the same ids however many
    // points were added before it was loaded. A modulator seeds its Random from
    // the track's identity, so an id that depended on what the user did earlier
    // would make one preset produce different films — the property the
    // step-counted clock exists to protect.
    syncTracks(count) {
        this.tracks = []
        this.nextId = 1
        for (let i = 0; i < count; i++) this.tracks.push(this.newTrack())
    }

    // A duration of zero would divide by zero in `progress` and make `advance`
    // meaningless, and the panel's minimum does not bind a preset.
    static span(duration) {
        return Math.max(1, Math.round(duration))
    }

    // One simulation step, one unit of animation time — so after N steps the
    // clock reads N. Returns true when a one-shot has just reached its end, which
    // is the caller's cue to stop the transport.
    advance(duration, loop) {
        const span = Animation.span(duration)
        this.time += 1
        if (this.time < span) return false
        if (loop) {
            this.time %= span
            return false
        }
        this.time = span
        return true
    }

    // A loop's clock runs 0…span-1, because `advance` wraps span back to 0 — so
    // scrubbing to `span` would put the playhead on a step the loop never
    // occupies, and the next advance would land on 1 rather than 0, skipping the
    // first step of the run. A one-shot does sit on `span`: that is its end, and
    // `finished` is how it is recognised.
    seek(time, duration, loop=false) {
        const span = Animation.span(duration)
        const last = loop ? span - 1 : span
        this.time = Math.min(last, Math.max(0, Math.round(time)))
    }

    progress(duration) {
        return this.time/Animation.span(duration)
    }

    // A one-shot sitting on its last step is finished, and pressing play again
    // should start it rather than do nothing.
    finished(duration, loop) {
        return !loop && this.time >= Animation.span(duration)
    }

    // ---- stations -------------------------------------------------------

    // Sorts, and clamps every dwell to the gap before the next station. `at`
    // walks the list in order and the panel reads it as a sequence, so an edited
    // time re-sorts rather than being rejected: the user is moving a station
    // along the timeline, not making a mistake.
    //
    // The clamp is what keeps `at` continuous. A dwell allowed to run past the
    // next station leaves the leg negative room, and the point then jumps from
    // where it is holding to somewhere along a leg it never started — a teleport
    // out of a configuration that only looks like a typo. Making it
    // unrepresentable is cheaper than teaching `at` to interpret it. A dwell
    // that exactly fills the gap is left alone: that is a deliberate hard cut,
    // and it is the user's to make.
    static normalise(track) {
        const stations = track.stations
        stations.sort((a, b) => a.time - b.time)
        for (let i = 0; i < stations.length; i++) {
            const next = stations[i + 1]
            const room = next ? next.time - stations[i].time : Infinity
            stations[i].dwell = Math.max(0, Math.min(stations[i].dwell, room))
        }
        return track
    }

    addStation(track, fields) {
        const added = station(fields)
        track.stations.push(added)
        Animation.normalise(track)
        return added
    }

    removeStation(track, index) {
        if (index >= 0 && index < track.stations.length) {
            track.stations.splice(index, 1)
            Animation.normalise(track)
        }
    }

    // Where the track puts its point at `time`, or **null when the track has no
    // stations** — that is the normal state, and it means the point stands
    // wherever it was left by hand. A caller that treats null as (0, 0) throws
    // every un-animated point into the corner.
    //
    // τ on a dwell runs from the station's time, so it is negative in the hold
    // before the first station: that keeps a modulator continuous through the
    // station rather than restarting it there. On a leg it runs from the end of
    // the dwell, where the movement began. Every phase has a finite length
    // inside the span — the hold before the first station is `first.time`
    // long, a station's own hold its dwell, a terminal hold runs to the span —
    // and an integer number of waves over that length lands on the station.
    static at(track, time, duration, loop) {
        const stations = track.stations
        if (stations.length === 0) return null

        const span = Animation.span(duration)
        const first = stations[0]
        // Strictly before: the station itself opens its own dwell.
        if (time < first.time) return sample(first, 0, time - first.time, first.time)
        if (stations.length === 1) return sample(first, 0, time - first.time, span - first.time)

        for (let i = 0; i < stations.length; i++) {
            const from = stations[i],
                held = from.time + Math.max(0, from.dwell)
            const next = stations[i + 1]
            // The last station of a one-shot, or of a loop with no way back,
            // holds to the end: one hold, however long its dwell says.
            const terminal = !next && (!loop || held >= span)
            // Standing at this station: the dwell is the opposite of movement,
            // and it is where the exposure builds its bright structure.
            if (time <= held || terminal) {
                return sample(from, i, time - from.time, terminal ? span - from.time : Math.max(0, from.dwell))
            }

            if (next) {
                // A dwell that runs past the next station leaves the leg no
                // room; the loop then falls through to that station instead.
                if (time < next.time) return travel(from, next, (time - held)/(next.time - held), i, time - held, next.time - held)
                continue
            }
            // The last station of a loop joins back to the first, arriving
            // exactly as the clock wraps.
            return travel(from, first, (time - held)/(span - held), i, time - held, span - held)
        }
        const last = stations.length - 1
        return sample(stations[last], last, time - stations[last].time, span - stations[last].time)
    }

    // The modulator in charge of the phase `at` reports: the station's own slot
    // for that phase if it has one, else the track's default. A dwell and the
    // leg leaving the same station are two phases with two slots — a held point
    // wants to tremble in place, a moving one wants its trajectory shaped.
    static modulatorFor(track, at) {
        const own = track.stations[at.station]
        const slot = own && own.modulation && own.modulation[at.phase]
        return slot || track.modulation[at.phase] || null
    }

    // The offset the plan gets at `at`, with the noise seeded from the run, the
    // track's identity, the station and the slot — never from the simulation's
    // Random, whose stream has to be consumed in a fixed order for a seed to
    // reproduce an image. Same settings on two tracks, different noise. On a leg
    // the sine swings across the leg's normal, the tangent turned a quarter.
    static modulate(track, at, seed) {
        const m = Animation.modulatorFor(track, at)
        if (!m) return NONE
        const normal = at.tangent ? { x: -at.tangent.y, y: at.tangent.x } : VERTICAL
        return modulate(m, at.tau, at.length, `${seed}/${track.id}/${at.station}/${at.phase}`, normal)
    }

    // A deliberate canvas change takes the whole figure with it, and a track's
    // stations are figure: positions, control points and weights follow the
    // same factors the focal points do. Without this, applyTracks would write
    // the old canvas' coordinates straight back over the rescaled points, and an
    // animated point would ignore the resize entirely.
    //
    // A modulator's amplitude is pixels too, so it scales — by the shorter-side
    // factor, the one isotropic number available, since a wobble has no axis to
    // pick between the two.
    static rescale(track, scaleX, scaleY, scaleWeight) {
        for (const at of track.stations) {
            at.x *= scaleX
            at.y *= scaleY
            at.cx *= scaleX
            at.cy *= scaleY
            at.weight = Math.round(at.weight*scaleWeight)
            for (const slot of SLOTS) {
                if (at.modulation[slot]) at.modulation[slot].amplitude *= scaleWeight
            }
        }
        for (const slot of SLOTS) track.modulation[slot].amplitude *= scaleWeight
        return track
    }

    // The shared weight is one number for every point and every station: while
    // it is in charge it is written here too, so the Weight slider still sizes
    // an animated point and applyTracks has nothing different to say. Weight
    // animation is what Manual mode is for.
    static setWeight(track, weight) {
        for (const at of track.stations) at.weight = weight
        return track
    }

    // True when any track has something to say. Cheap enough to ask per frame,
    // and it keeps the un-animated case free.
    get animated() {
        return this.tracks.some(track => track.stations.length > 0)
    }
}
