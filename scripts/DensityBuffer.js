const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

// One packed pixel, written through a Uint32Array view of the ImageData.
const pack = littleEndian
    ? (r, g, b) => (255 << 24 | b << 16 | g << 8 | r) >>> 0
    : (r, g, b) => (r << 24 | g << 16 | b << 8 | 255) >>> 0

export default class DensityBuffer {
    constructor(width=0, height=0) {
        this.width = 0
        this.height = 0
        this.data = null
        this.max = 0
        this.whitePoint = 0
        this.table = null
        this.view = null
        this.resize(width, height)
    }

    // Keeps the accumulated image: the overlapping region is copied row by row.
    // max is recomputed while copying — cropping away the densest region has to
    // lower it, or the white point stays high and the image never recovers.
    resize(width, height) {
        const next = new Float32Array(width*height)
        let max = 0
        if (this.data) {
            const w = Math.min(this.width, width),
                h = Math.min(this.height, height)
            for (let y = 0; y < h; y++) {
                const from = y*this.width, to = y*width
                for (let x = 0; x < w; x++) {
                    const v = this.data[from + x]
                    next[to + x] = v
                    if (v > max) max = v
                }
            }
        }
        this.data = next
        this.max = max
        this.width = width
        this.height = height
    }

    clear() {
        this.data.fill(0)
        this.max = 0
        this.whitePoint = 0
    }

    add(x, y) {
        const ix = x|0, iy = y|0
        if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return
        const v = ++this.data[iy*this.width + ix]
        if (v > this.max) this.max = v
    }

    // Log density + gamma, normalised to a white point that follows this.max
    // with a lag so the per-frame mode does not flicker. The curve itself lives
    // in buildTable; the pixel loop is only an array index.
    render(imageData, { exposure=1, gamma=2.2, adaptation=.1, background=[255, 255, 255], foreground=[0, 0, 0] } = {}) {
        this.whitePoint += (this.max - this.whitePoint) * adaptation

        const top = Math.ceil(this.whitePoint),
            table = this.buildTable(top, exposure, gamma, background, foreground),
            ceiling = table[top]

        if (!this.view || this.view.buffer !== imageData.data.buffer) {
            this.view = new Uint32Array(imageData.data.buffer)
        }
        const pixels = this.view

        for (let i = 0; i < this.data.length; i++) {
            const d = this.data[i]
            pixels[i] = d < top ? table[d] : ceiling
        }
    }

    // Density is always an integer (add only ever does += 1), so the whole tone
    // curve fits in a table indexed by density — a few thousand entries instead
    // of millions of log1p/pow calls. Phase 4's colormap replaces the body of
    // this loop; see "Density-to-colour lookup table" in docs/decisions.md.
    buildTable(top, exposure, gamma, background, foreground) {
        if (!this.table || this.table.length <= top) this.table = new Uint32Array(top + 1)

        const scale = this.whitePoint > 0 ? 1/Math.log1p(this.whitePoint*exposure) : 0,
            invGamma = 1/gamma,
            [br, bg, bb] = background,
            [fr, fg, fb] = foreground

        for (let d = 0; d <= top; d++) {
            let t = d > 0 ? Math.log1p(d*exposure)*scale : 0
            if (t > 1) t = 1
            if (t > 0) t = Math.pow(t, invGamma)
            this.table[d] = pack(
                Math.round(br + (fr - br)*t),
                Math.round(bg + (fg - bg)*t),
                Math.round(bb + (fb - bb)*t)
            )
        }
        return this.table
    }
}
