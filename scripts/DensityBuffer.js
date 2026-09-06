export default class DensityBuffer {
    constructor(width=0, height=0) {
        this.width = 0
        this.height = 0
        this.data = null
        this.max = 0
        this.whitePoint = 0
        this.resize(width, height)
    }

    // Keeps the accumulated image: the overlapping region is copied row by row.
    resize(width, height) {
        const next = new Float32Array(width*height)
        if (this.data) {
            const w = Math.min(this.width, width),
                h = Math.min(this.height, height)
            for (let y = 0; y < h; y++) {
                next.set(this.data.subarray(y*this.width, y*this.width + w), y*width)
            }
        }
        this.data = next
        this.width = width
        this.height = height
    }

    clear() {
        this.data.fill(0)
        this.max = 0
    }

    add(x, y) {
        const ix = x|0, iy = y|0
        if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return
        const v = ++this.data[iy*this.width + ix]
        if (v > this.max) this.max = v
    }

    // Log density + gamma, normalised to a white point that follows this.max
    // with a lag so the per-frame mode does not flicker.
    render(imageData, { exposure=1, gamma=2.2, adaptation=.1, background=[255, 255, 255], foreground=[0, 0, 0] } = {}) {
        this.whitePoint += (this.max - this.whitePoint) * adaptation
        const pixels = imageData.data,
            scale = this.whitePoint > 0 ? 1/Math.log1p(this.whitePoint*exposure) : 0,
            invGamma = 1/gamma,
            [br, bg, bb] = background,
            [fr, fg, fb] = foreground

        for (let i = 0, p = 0; i < this.data.length; i++, p += 4) {
            const d = this.data[i]
            let t = d > 0 ? Math.log1p(d*exposure)*scale : 0
            if (t > 1) t = 1
            if (t > 0) t = Math.pow(t, invGamma)
            pixels[p]     = br + (fr - br)*t
            pixels[p + 1] = bg + (fg - bg)*t
            pixels[p + 2] = bb + (fb - bb)*t
            pixels[p + 3] = 255
        }
    }
}
