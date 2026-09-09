// The timeline. Nothing moves yet: this owns the clock and the shape the motion
// data will take, and both of those are decisions the rest of Phase 5 inherits.
//
// **Time is counted in simulation steps, never in milliseconds.** Wall-clock
// time would make a run depend on how fast the machine happened to be, which
// throws away the reproducibility the seeded Random exists for. See "The
// animation clock counts steps" in docs/decisions.md.
//
// The settings live in Params (duration, loop, playing) and are passed in, the
// way Bloom and PostProcess take theirs. What lives here is the runtime state
// the user does not edit and a preset does not carry: the current time, and the
// tracks.

// A track per focal point. It holds an identity and nothing else — T24 adds a
// path and a weight to it, T25 a stack of modulators, and the identity is what
// seeds a modulator's own Random so two tracks do not tremble in lockstep.
const track = (id) => ({ id })

export default class Animation {
    constructor() {
        this.time = 0
        this.tracks = []
        this.nextId = 1
    }

    // Ids are handed out once and never reused, so a track keeps its identity
    // while points are added and removed around it.
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
    syncTracks(count) {
        this.tracks = []
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

    seek(time, duration) {
        const span = Animation.span(duration)
        this.time = Math.min(span, Math.max(0, Math.round(time)))
    }

    progress(duration) {
        return this.time/Animation.span(duration)
    }

    // A one-shot sitting on its last step is finished, and pressing play again
    // should start it rather than do nothing.
    finished(duration, loop) {
        return !loop && this.time >= Animation.span(duration)
    }
}
