const HEX = /^#[0-9a-f]{6}$/i

const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
]

// The stop list changes when someone edits it, which is far less often than
// once a frame — so the parsed form is rebuilt only when the text actually
// differs. See "A colour ramp instead of two colours" in docs/decisions.md.
let cached = null,
    cachedKey = null

// A colour ramp over 0…1, sampled by the tone map's normalised density. Stops
// are sorted here rather than in the panel, so the stored order is whatever the
// user typed and the ramp is still monotonic.
export default class Gradient {
    constructor(stops=[]) {
        this.stops = stops
            .filter(stop => stop && Number.isFinite(stop.at) && HEX.test(String(stop.color)))
            .map(stop => ({
                at: Math.min(1, Math.max(0, stop.at)),
                color: stop.color,
                rgb: parse(stop.color)
            }))
            .sort((a, b) => a.at - b.at)
    }

    static hex([r, g, b]) {
        return "#" + [r, g, b].map(v => Math.min(255, Math.max(0, Math.round(v)))
            .toString(16).padStart(2, "0")).join("")
    }

    static key(stops) {
        let key = ""
        for (const stop of stops) key += `${stop.at}${stop.color}|`
        return key
    }

    static from(stops) {
        const key = Gradient.key(stops)
        if (key !== cachedKey) {
            cached = new Gradient(stops)
            cachedKey = key
        }
        return cached
    }

    // The colour the densest part of the image gets — what a marker drawn on top
    // of the image has to stand out against.
    get top() {
        const stops = this.stops
        return stops.length > 0 ? stops[stops.length - 1].color : "#000000"
    }

    // Writes into `out` instead of returning a fresh array: this runs once per
    // density value while the colour table is being built.
    sample(t, out=[0, 0, 0]) {
        const stops = this.stops
        if (stops.length === 0) {
            out[0] = out[1] = out[2] = 0
            return out
        }

        let index = 1
        while (index < stops.length && stops[index].at < t) index++
        if (t <= stops[0].at || index === stops.length) {
            const rgb = (t <= stops[0].at ? stops[0] : stops[stops.length - 1]).rgb
            out[0] = rgb[0]
            out[1] = rgb[1]
            out[2] = rgb[2]
            return out
        }

        const from = stops[index - 1],
            to = stops[index],
            span = to.at - from.at,
            k = span > 0 ? (t - from.at)/span : 0
        out[0] = Math.round(from.rgb[0] + (to.rgb[0] - from.rgb[0])*k)
        out[1] = Math.round(from.rgb[1] + (to.rgb[1] - from.rgb[1])*k)
        out[2] = Math.round(from.rgb[2] + (to.rgb[2] - from.rgb[2])*k)
        return out
    }
}
