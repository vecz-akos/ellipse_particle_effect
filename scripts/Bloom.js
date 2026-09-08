// Three box blurs approximate a Gaussian well enough for a halo, and each one
// costs the same per pixel whatever the radius — a real Gaussian kernel would be
// hundreds of taps wide at the radii this effect is interesting at. Three boxes
// of half-width r have a combined standard deviation of sqrt(r² + r) ≈ r + ½,
// which is where the inverse below comes from.
const PASSES = 3

const boxRadius = (sigma) => Math.max(1, Math.round(sigma - .5))

const clamp = (value, max) => value < 0 ? 0 : value > max ? max : value

// Running sum, so the window costs one add and one subtract per pixel. Edges
// repeat the outermost value rather than fading to zero: a curve running off the
// canvas should not grow a dark rim.
const boxHorizontal = (src, dst, width, height, r) => {
    const scale = 1/(2*r + 1),
        last = width - 1
    for (let y = 0; y < height; y++) {
        const row = y*width
        let sum = 0
        for (let i = -r; i <= r; i++) sum += src[row + clamp(i, last)]
        // Written out rather than calling a clamp helper: this is the innermost
        // loop of the whole effect, and two calls per pixel showed up in the
        // measurements.
        for (let x = 0; x < width; x++) {
            dst[row + x] = sum*scale
            const add = x + r + 1,
                drop = x - r
            sum += src[row + (add > last ? last : add)] - src[row + (drop < 0 ? 0 : drop)]
        }
    }
}

// Every column at once, one row at a time: walking a column with a stride is
// what makes the obvious version of this several times slower than the
// horizontal pass. `sums` holds one running total per column.
const boxVertical = (src, dst, width, height, r, sums) => {
    const scale = 1/(2*r + 1)
    sums.fill(0)

    for (let i = -r; i <= r; i++) {
        const row = clamp(i, height - 1)*width
        for (let x = 0; x < width; x++) sums[x] += src[row + x]
    }

    for (let y = 0; y < height; y++) {
        const out = y*width,
            add = clamp(y + r + 1, height - 1)*width,
            drop = clamp(y - r, height - 1)*width
        for (let x = 0; x < width; x++) {
            dst[out + x] = sums[x]*scale
            sums[x] += src[add + x] - src[drop + x]
        }
    }
}

// Light spilling, so it happens in linear space: blur the density, add it back
// to the density, and let the tone map see the sum. See "Bloom belongs in the
// density" in docs/decisions.md.
export default class Bloom {
    constructor() {
        this.width = 0
        this.height = 0
        this.small = null       // half-resolution, blurred in place
        this.temp = null        // the other half of each separable pass
        this.columns = null     // one running sum per column, for the vertical pass
        this.blended = null     // one upsampled row, vertically interpolated
        this.sum = null         // full resolution: density + bloom
    }

    // Everything is recomputed from the density every frame, so there is no
    // stale state to invalidate on a clear — only the buffers have to follow the
    // canvas.
    resize(width, height) {
        if (this.width === width && this.height === height) return
        this.width = width
        this.height = height
        this.halfWidth = Math.max(1, Math.ceil(width/2))
        this.halfHeight = Math.max(1, Math.ceil(height/2))
        this.small = new Float32Array(this.halfWidth*this.halfHeight)
        this.temp = new Float32Array(this.halfWidth*this.halfHeight)
        this.columns = new Float32Array(this.halfWidth)
        this.blended = new Float32Array(this.halfWidth)
        this.sum = new Float32Array(width*height)
    }

    // reference is the density the image is currently normalised to — the
    // threshold is a fraction of it, so a bloom setting keeps meaning the same
    // thing as the image gets brighter.
    apply(density, width, height, { radius, strength, threshold }, reference) {
        this.resize(width, height)
        this.downsample(density, threshold*reference)

        const r = boxRadius(radius/2)
        for (let pass = 0; pass < PASSES; pass++) {
            boxHorizontal(this.small, this.temp, this.halfWidth, this.halfHeight, r)
            boxVertical(this.temp, this.small, this.halfWidth, this.halfHeight, r, this.columns)
        }

        return this.combine(density, strength)
    }

    // Half resolution: a blur this wide has nothing left to say about single
    // pixels, and it makes every pass a quarter of the work.
    downsample(density, cut) {
        const { halfWidth, halfHeight, width, height, small } = this
        for (let y = 0, i = 0; y < halfHeight; y++) {
            const y0 = Math.min(y*2, height - 1)*width,
                y1 = Math.min(y*2 + 1, height - 1)*width
            for (let x = 0; x < halfWidth; x++, i++) {
                const x0 = Math.min(x*2, width - 1),
                    x1 = Math.min(x*2 + 1, width - 1)
                const a = density[y0 + x0] - cut,
                    b = density[y0 + x1] - cut,
                    c = density[y1 + x0] - cut,
                    d = density[y1 + x1] - cut
                small[i] = ((a > 0 ? a : 0) + (b > 0 ? b : 0)
                    + (c > 0 ? c : 0) + (d > 0 ? d : 0))*.25
            }
        }
    }

    // Bilinearly back to full resolution and added to the density. The maximum
    // of the sum comes out of the same loop, because that is what the tone map
    // has to normalise to — using the raw density's maximum here is what flattens
    // the bright core.
    //
    // The mapping is exactly 2:1, so the general bilinear form collapses: two
    // source rows blend into one row first, and every output pixel is then three
    // quarters of its own column and one quarter of the neighbour it leans
    // towards. No per-pixel floor, clamp or min survives that.
    combine(density, strength) {
        const { halfWidth, halfHeight, width, height, small, blended, sum } = this
        const last = halfWidth - 1
        let max = 0,
            i = 0

        for (let y = 0; y < height; y++) {
            const sy = clamp(y*.5 - .25, halfHeight - 1),
                row0 = sy|0,
                ty = sy - row0,
                upper = row0*halfWidth,
                lower = Math.min(row0 + 1, halfHeight - 1)*halfWidth

            for (let c = 0; c < halfWidth; c++) {
                const a = small[upper + c]
                blended[c] = a + (small[lower + c] - a)*ty
            }

            for (let c = 0, x = 0; x < width; c++) {
                const current = blended[c]*.75
                let value = density[i] + strength*(current + blended[c > 0 ? c - 1 : 0]*.25)
                sum[i] = value
                if (value > max) max = value
                i++
                if (++x >= width) break

                value = density[i] + strength*(current + blended[c < last ? c + 1 : last]*.25)
                sum[i] = value
                if (value > max) max = value
                i++
                x++
            }
        }

        return { data: sum, max }
    }
}
