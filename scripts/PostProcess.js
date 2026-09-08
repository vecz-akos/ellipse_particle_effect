import Random from "./Random.js"

// One tile, wrapped over the canvas. Big enough that the repeat is invisible at
// grain strengths anyone would use, small enough to stay in cache.
const TILE = 256,
    TILE_MASK = TILE - 1

const smoothstep = (t) => t*t*(3 - 2*t)

// Everything that happens to the finished RGB, after the tone map: the vignette
// then the grain, in one pass over the bytes. Nothing here touches the
// simulation, and with both effects off it does not run at all — see "Vignette
// and grain on the bytes" in docs/decisions.md.
export default class PostProcess {
    constructor() {
        this.mask = null
        this.maskKey = ""
        this.noise = null
        this.frame = 0
    }

    // data is the ImageData's Uint8ClampedArray: R, G, B, A per pixel, in that
    // order whatever the machine's endianness — which is why this works on the
    // bytes rather than the Uint32 view DensityBuffer writes through.
    apply(data, width, height, { vignette, grain, base=[0, 0, 0] }) {
        const shade = vignette && vignette.enabled && vignette.amount > 0,
            speckle = grain && grain.enabled && grain.amount > 0
        if (!shade && !speckle) return

        const mask = shade ? this.vignetteMask(width, height, vignette) : null
        let noise = null, offset = 0, step = 0
        if (speckle) {
            noise = this.noiseTile()
            // An animated tile is the same noise read from somewhere else, so
            // there is nothing to regenerate per frame.
            offset = grain.animated ? Math.imul(this.frame++, 2654435761) >>> 0 : 0
            // Colour grain reads three different places in the tile; monochrome
            // reads one, which is what keeps it looking like film.
            step = grain.mono ? 0 : 7919
        }
        const strength = speckle ? grain.amount*255 : 0
        // The edge fades towards the colour the ramp has at density 0 — the
        // empty canvas — not towards black. On a light look that is a light
        // vignette, and it reduces to the plain multiply when the ramp starts
        // at black.
        const [baseR, baseG, baseB] = base

        for (let y = 0, i = 0, p = 0; y < height; y++) {
            for (let x = 0; x < width; x++, i++, p += 4) {
                if (shade) {
                    const m = mask[i]
                    data[p] = baseR + (data[p] - baseR)*m
                    data[p + 1] = baseG + (data[p + 1] - baseG)*m
                    data[p + 2] = baseB + (data[p + 2] - baseB)*m
                }
                if (speckle) {
                    const base = ((y + offset) & TILE_MASK)*TILE + ((x + offset) & TILE_MASK)
                    const n = noise[base]*strength
                    data[p] += n
                    data[p + 1] += step === 0 ? n : noise[(base + step) & (noise.length - 1)]*strength
                    data[p + 2] += step === 0 ? n : noise[(base + step*2) & (noise.length - 1)]*strength
                }
            }
        }
    }

    // A distance falloff and a smoothstep per pixel per frame is the obvious
    // version and the wrong one: the multiplier only changes when the canvas or
    // one of the three settings does.
    vignetteMask(width, height, { amount, radius, softness }) {
        const key = `${width}x${height}|${amount}|${radius}|${softness}`
        if (this.mask && this.maskKey === key) return this.mask

        const mask = new Float32Array(width*height),
            // Distance is measured against the half-diagonal, so radius 1 is the
            // corner whatever the aspect ratio.
            norm = 1/Math.hypot(1, 1),
            soft = Math.max(softness, .001)

        for (let y = 0, i = 0; y < height; y++) {
            const dy = (y + .5)/height*2 - 1
            for (let x = 0; x < width; x++, i++) {
                const dx = (x + .5)/width*2 - 1
                const d = Math.hypot(dx, dy)*norm
                let t = (d - radius)/soft
                t = t < 0 ? 0 : t > 1 ? 1 : t
                mask[i] = 1 - amount*smoothstep(t)
            }
        }

        this.mask = mask
        this.maskKey = key
        return mask
    }

    // Its own Random, never the simulation's: that stream only reproduces an
    // image because it is consumed in a fixed order, and a render effect
    // pulling from it would make the picture depend on the frame count.
    noiseTile() {
        if (this.noise) return this.noise
        const random = new Random("grain")
        const noise = new Float32Array(TILE*TILE)
        for (let i = 0; i < noise.length; i++) noise[i] = random.between(-1, 1)
        this.noise = noise
        return noise
    }
}
