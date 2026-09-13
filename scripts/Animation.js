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

// The vocabulary is fixed and worth using exactly — see "The words this phase
// uses" in docs/roadmap.md. A **track** is one focal point's whole plan: an
// ordered list of **stations**. A station is a position and a weight at one
// absolute time, plus a **dwell** it is held for and how the point travels to
// the *next* station. The **leg** between two stations is not a separate object:
// modelling it as one lets the list hold a leg with one endpoint, a gap, or an
// ambiguous order, and every one of those becomes a validation branch.
//
// The identity is what seeds a modulator's own Random in T25, so two tracks do
// not tremble in lockstep.
const track = (id) => ({ id, stations: [] })

// `curve` bends the leg to the next station through the single control point
// (cx, cy) — a quadratic Bézier, so one handle to drag rather than two. `dwell`
// is time held *at* this station, and it eats into the leg that follows.
export const station = ({ time=0, x=0, y=0, weight=0, dwell=0, curve=false, cx=0, cy=0 }) =>
    ({ time, x, y, weight, dwell, curve, cx, cy })

const lerp = (from, to, t) => from + (to - from)*t

// Quadratic, evaluated the long way rather than through a helper: this runs once
// per animated point per step.
const bezier = (from, control, to, t) => {
    const u = 1 - t
    return u*u*from + 2*u*t*control + t*t*to
}

const sample = (at) => ({ x: at.x, y: at.y, weight: at.weight })

// Where the point is partway along the leg out of `from`. The control point
// belongs to the station the leg leaves, so a curve is a property of the leg
// rather than of either endpoint.
const travel = (from, to, t) => from.curve
    ? {
        x: bezier(from.x, from.cx, to.x, t),
        y: bezier(from.y, from.cy, to.y, t),
        weight: lerp(from.weight, to.weight, t)
    }
    : {
        x: lerp(from.x, to.x, t),
        y: lerp(from.y, to.y, t),
        weight: lerp(from.weight, to.weight, t)
    }

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
    static at(track, time, duration, loop) {
        const stations = track.stations
        if (stations.length === 0) return null

        const first = stations[0]
        if (stations.length === 1 || time <= first.time) return sample(first)

        const span = Animation.span(duration)
        for (let i = 0; i < stations.length; i++) {
            const from = stations[i],
                held = from.time + Math.max(0, from.dwell)
            // Standing at this station: the dwell is the opposite of movement,
            // and it is where the exposure builds its bright structure.
            if (time <= held) return sample(from)

            const next = stations[i + 1]
            if (next) {
                // A dwell that runs past the next station leaves the leg no
                // room; the loop then falls through to that station instead.
                if (time < next.time) return travel(from, next, (time - held)/(next.time - held))
                continue
            }
            // The last station. A one-shot holds here to the end; a loop joins
            // back to the first, arriving exactly as the clock wraps.
            if (!loop || held >= span) return sample(from)
            return travel(from, first, (time - held)/(span - held))
        }
        return sample(stations[stations.length - 1])
    }

    // A deliberate canvas change takes the whole figure with it, and a track's
    // stations are figure: positions, control points and weights follow the
    // same factors the focal points do. Without this, applyTracks would write
    // the old canvas' coordinates straight back over the rescaled points, and an
    // animated point would ignore the resize entirely.
    static rescale(track, scaleX, scaleY, scaleWeight) {
        for (const at of track.stations) {
            at.x *= scaleX
            at.y *= scaleY
            at.cx *= scaleX
            at.cy *= scaleY
            at.weight = Math.round(at.weight*scaleWeight)
        }
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
