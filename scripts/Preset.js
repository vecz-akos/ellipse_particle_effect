import FocalPoint from "./FocalPoint.js"

const VERSION = 1

// Session state, not image state: a preset should not pause the run or hand a
// focal point to the mouse on load.
const SKIP = new Set(["animate", "followFocalPoint"])

// A saved image is the seed, the parameters and the focal points — plus the
// canvas the points were placed on, so they can be scaled into a different one.
// Files are user-supplied, so `apply` copies only keys that already exist in
// Params and whose type matches; anything else is ignored rather than trusted.
export default class Preset {
    static capture(params, nEllipse, seed, width, height) {
        const saved = {}
        for (const [key, value] of Object.entries(params)) {
            if (SKIP.has(key)) continue
            saved[key] = value !== null && typeof value === "object" ? { ...value } : value
        }

        return {
            version: VERSION,
            seed,
            canvas: { width, height },
            params: saved,
            focalPoints: nEllipse.focalPoints.map(({ x, y, weight }) => ({ x, y, weight }))
        }
    }

    // Writes into the given Params and NEllipse, and returns what the caller has
    // to act on: the seed, and the canvas the coordinates belong to.
    static apply(data, params, nEllipse) {
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

            if (current !== null && typeof current === "object") {
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

        nEllipse.focalPoints = data.focalPoints
            .filter(p => p && [p.x, p.y, p.weight].every(Number.isFinite))
            .map(p => new FocalPoint(p.x, p.y, p.weight))
        nEllipse.recalculateD()

        const canvas = data.canvas || {}
        return {
            seed: typeof data.seed === "string" ? data.seed : null,
            width: Number.isFinite(canvas.width) && canvas.width > 0 ? canvas.width : null,
            height: Number.isFinite(canvas.height) && canvas.height > 0 ? canvas.height : null
        }
    }
}
