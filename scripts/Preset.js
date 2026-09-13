import FocalPoint from "./FocalPoint.js"
import Params from "./Params.js"
import Animation from "./Animation.js"

const VERSION = 1

// Marks a hash that carries a whole preset. A bare seed is base 36, so it can
// never collide with this, and old seed-only links keep working. Matched as a
// version pattern, so a link from a newer build is refused rather than mistaken
// for a seed.
const LINK = /^p(\d+)\./

// Session state, not image state: a preset should not pause the run, hand a
// focal point to the mouse, or drop a debugging overlay on a shared image.
const SKIP = new Set(["exposing", "followFocalPoint", "showFocalPoints"])

// Pixel positions at full double precision are sixteen digits of noise —
// DensityBuffer.add truncates to an integer anyway.
const round = (value) => Math.round(value*100)/100

const HEX = /^#[0-9a-f]{6}$/i

// The one array-valued parameter, so it gets its own check rather than a
// general-purpose deep validator. All or nothing: a half-read ramp is a colour
// scheme nobody chose, and the default is a better answer than that.
const gradientStops = (value) => {
    if (!Array.isArray(value) || value.length < 2) return null
    const stops = []
    for (const stop of value) {
        if (!stop || typeof stop !== "object") return null
        if (!Number.isFinite(stop.at) || !HEX.test(String(stop.color))) return null
        stops.push({ at: Math.min(1, Math.max(0, stop.at)), color: stop.color })
    }
    return stops
}

// The animation's tracks, validated whole. All or nothing, the way the gradient
// is: a half-read track is a movement nobody planned, and no tracks at all is a
// better answer than that. The identity travels with the stations because T25
// seeds a modulator's Random from it — restoring the plan but not the id would
// give the same saved animation different noise.
const animationTracks = (value, count) => {
    if (!Array.isArray(value) || value.length !== count) return null
    const tracks = [],
        // Identity is the whole reason the id exists — two tracks sharing one
        // would seed the same modulator noise and tremble in lockstep.
        seen = new Set()
    for (const track of value) {
        if (!track || typeof track !== "object") return null
        if (typeof track.id !== "string" || !Array.isArray(track.stations)) return null
        if (seen.has(track.id)) return null
        seen.add(track.id)
        const stations = []
        for (const station of track.stations) {
            if (!station || typeof station !== "object") return null
            const numbers = ["time", "x", "y", "weight", "dwell", "cx", "cy"]
            if (numbers.some(key => !Number.isFinite(station[key]))) return null
            stations.push({
                time: Math.max(0, Math.round(station.time)),
                x: station.x, y: station.y, weight: station.weight,
                dwell: Math.max(0, station.dwell),
                curve: station.curve === true,
                cx: station.cx, cy: station.cy
            })
        }
        tracks.push(Animation.normalise({ id: track.id, stations }))
    }
    return tracks
}

// A saved image is the seed, the parameters, the focal points and their tracks —
// plus the canvas the points were placed on, so they can be scaled into a
// different one. Files are user-supplied, so `apply` copies only keys that
// already exist in Params and whose type matches; anything else is ignored
// rather than trusted.
export default class Preset {
    static capture(params, nEllipse, animation, seed, width, height) {
        const saved = {}
        for (const [key, value] of Object.entries(params)) {
            if (SKIP.has(key)) continue
            // Arrays are objects, and spreading one gives {0: …, 1: …} — a
            // document that no longer round-trips.
            if (Array.isArray(value)) saved[key] = value.map(item => ({ ...item }))
            else if (value !== null && typeof value === "object") saved[key] = { ...value }
            else saved[key] = value
        }

        const document = {
            version: VERSION,
            seed,
            canvas: { width, height },
            params: saved,
            focalPoints: nEllipse.focalPoints.map(({ x, y, weight }) =>
                ({ x: round(x), y: round(y), weight }))
        }

        // Omitted entirely while nothing is animated, which is the normal state
        // — a link should not carry one empty track per focal point.
        if (animation && animation.animated) {
            document.tracks = animation.tracks.map(({ id, stations }) => ({
                id,
                stations: stations.map((at) => ({
                    time: Math.round(at.time),
                    x: round(at.x), y: round(at.y), weight: at.weight,
                    dwell: Math.round(at.dwell),
                    curve: at.curve,
                    cx: round(at.cx), cy: round(at.cy)
                }))
            }))
        }
        return document
    }

    // What a link does not have to carry. `apply` only touches keys that are
    // present, so leaving a default out restores it anyway — no schema change,
    // no version bump. Weights go too while the shared weight is in charge:
    // every point holds it, so they are derived rather than data.
    //
    // Only for links. A saved file keeps every field, because it is long-lived
    // and a default that shifts in a later version would quietly rewrite an
    // image someone saved months ago.
    static strip(preset) {
        const defaults = new Params()
        const params = {}

        for (const [key, value] of Object.entries(preset.params)) {
            const fallback = defaults[key]
            if (Array.isArray(fallback)) {
                // One value, not a set of keys to diff: half a ramp means
                // nothing, so it is carried whole or left out whole.
                if (JSON.stringify(value) !== JSON.stringify(fallback)) params[key] = value
            } else if (fallback !== null && typeof fallback === "object") {
                const nested = {}
                for (const [name, nestedValue] of Object.entries(value || {})) {
                    if (nestedValue !== fallback[name]) nested[name] = nestedValue
                }
                if (Object.keys(nested).length > 0) params[key] = nested
            } else if (value !== fallback) {
                params[key] = value
            }
        }

        const manual = "manualWeight" in preset.params
            ? preset.params.manualWeight
            : defaults.manualWeight

        return {
            ...preset,
            params,
            focalPoints: preset.focalPoints.map(({ x, y, weight }) =>
                manual ? { x, y, weight } : { x, y })
        }
    }

    // The same document as a URL hash: base64url, so nothing needs percent
    // escaping and the link survives being pasted anywhere.
    static encode(preset) {
        const bytes = new TextEncoder().encode(JSON.stringify(Preset.strip(preset)))
        let binary = ""
        for (const byte of bytes) binary += String.fromCharCode(byte)
        return `p${VERSION}.` + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    }

    // null when the hash is not a preset at all (an old seed-only link); throws
    // when it claims to be one and is damaged or from a version we cannot read.
    static decode(hash) {
        const marker = LINK.exec(hash)
        if (!marker) return null
        if (Number(marker[1]) !== VERSION) {
            throw new Error(`Link format p${marker[1]} needs a newer build (this one reads p${VERSION})`)
        }

        const base64 = hash.slice(marker[0].length).replace(/-/g, "+").replace(/_/g, "/")
        const binary = atob(base64)
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        return JSON.parse(new TextDecoder().decode(bytes))
    }

    // Writes into the given Params, NEllipse and Animation, and returns what the
    // caller has to act on: the seed, and the canvas the coordinates belong to.
    static apply(data, params, nEllipse, animation=null) {
        // Validate before writing anything: a half-applied preset is worse than
        // a rejected one, and an empty focal-point list is legitimate while a
        // missing one means the file is not what it claims to be.
        if (!data || typeof data !== "object") throw new Error("Not a preset file")
        if (data.version !== VERSION) throw new Error(`Unsupported preset version: ${data.version}`)
        if (!data.params || typeof data.params !== "object") throw new Error("No parameters in the file")
        if (!Array.isArray(data.focalPoints)) throw new Error("No focal-point list in the file")

        for (const [key, value] of Object.entries(data.params)) {
            if (SKIP.has(key) || !(key in params)) continue
            const current = params[key]

            if (key === "gradient") {
                const stops = gradientStops(value)
                if (stops) params[key] = stops
            } else if (current !== null && typeof current === "object") {
                for (const [nested, nestedValue] of Object.entries(value || {})) {
                    if (nested in current && typeof current[nested] === typeof nestedValue) {
                        current[nested] = nestedValue
                    }
                }
            } else if (typeof current === typeof value) {
                params[key] = value
            } else if (key === "resolution" && (typeof value === "number" || typeof value === "string")) {
                // The only field that is a string ("fit") or a number by design.
                params[key] = value
            }
        }

        // A point without a weight comes from a link that left it out: the
        // shared weight is what every point holds there, and it has just been
        // applied above.
        nEllipse.focalPoints = data.focalPoints
            .filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
            .map(p => new FocalPoint(p.x, p.y,
                Number.isFinite(p.weight) ? p.weight : params.sharedWeight))
        nEllipse.recalculateD()

        // Tracks after the points, because there has to be one per point. A
        // document without them — or with a set that does not match — gets fresh
        // empty tracks, which is the un-animated state rather than a failure.
        if (animation) {
            const count = nEllipse.focalPoints.length
            const tracks = "tracks" in data ? animationTracks(data.tracks, count) : null
            if (tracks) {
                animation.tracks = tracks
                // The counter has to clear every id in the file, not merely
                // count them: a document numbered t3, t1 has two tracks and a
                // highest suffix of 3, and a counter set from the length would
                // hand the next point a t3 that is already taken. Ids that are
                // not of the `tN` shape contribute nothing and cannot collide
                // with one that is.
                animation.nextId = tracks.reduce((highest, track) => {
                    const numbered = /^t(\d+)$/.exec(track.id)
                    return numbered ? Math.max(highest, Number(numbered[1]) + 1) : highest
                }, 1)
            } else {
                animation.syncTracks(count)
            }
        }

        const canvas = data.canvas || {}
        return {
            seed: typeof data.seed === "string" ? data.seed : null,
            width: Number.isFinite(canvas.width) && canvas.width > 0 ? canvas.width : null,
            height: Number.isFinite(canvas.height) && canvas.height > 0 ? canvas.height : null
        }
    }
}
