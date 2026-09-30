import Random from "./Random.js"

// One tile, wrapped over the canvas. Big enough that the repeat is invisible at
// grain strengths anyone would use, small enough to stay in cache.
const TILE = 256,
    TILE_MASK = TILE - 1,
    MASK = TILE*TILE - 1

const smoothstep = (t) => t*t*(3 - 2*t)

const luma = (r, g, b) => (r*77 + g*150 + b*29)/256

// Everything quieter than the cut is silence, and what is left is stretched back
// over the full range — so lowering the coverage thins the grain out instead of
// fading all of it towards nothing.
const speck = (value, cut, spread) =>
    value > cut ? (value - cut)*spread : value < -cut ? (value + cut)*spread : 0

// Everything that happens to the finished RGB, after the tone map: the vignette
// then the grain, in one pass over the bytes. Nothing here touches the
// simulation, and with both effects off it does not run at all — see "Vignette
// and grain on the bytes" in docs/decisions.md.
export default class PostProcess {
    constructor() {
        this.mask = null
        this.maskKey = ""
        this.noise = null
    }

    // data is the ImageData's Uint8ClampedArray: R, G, B, A per pixel, in that
    // order whatever the machine's endianness — which is why this works on the
    // bytes rather than the Uint32 view DensityBuffer writes through.
    apply(data, width, height, { vignette, grain, base=[0, 0, 0] }) {
        const shade = vignette && vignette.enabled && vignette.amount > 0,
            speckle = grain && grain.enabled && grain.amount > 0
        if (!shade && !speckle) return

        const mask = shade ? this.vignetteMask(width, height, vignette) : null

        // Grain is sparse, coarse and follows the image:
        //  - cell: one noise value per cell×cell block, so a speck is bigger
        //    than a pixel, the way film grain is;
        //  - cut: only the loudest part of the noise gets through, so most
        //    cells stay clean — that is what "coverage" buys;
        //  - weight: how far the pixel is from the base colour, so the empty
        //    canvas stays empty instead of turning into static.
        let noise = null, step = 0, cell = 1, cut = 0, spread = 1, baseLuma = 0
        if (speckle) {
            noise = this.noiseTile()
            // Colour grain reads three different places in the tile; monochrome
            // reads one, which is what keeps it looking like film.
            step = grain.mono ? 0 : 7919
            cell = Math.max(1, Math.round(grain.size))
            cut = 1 - Math.min(1, Math.max(0, grain.coverage))
            spread = cut < 1 ? 1/(1 - cut) : 0
            baseLuma = luma(base[0], base[1], base[2])
        }
        const strength = speckle ? grain.amount*255 : 0,
            mono = step === 0
        // The edge fades towards the colour the ramp has at density 0 — the
        // empty canvas — not towards black. On a light look that is a light
        // vignette, and it reduces to the plain multiply when the ramp starts
        // at black.
        const [baseR, baseG, baseB] = base

        // Most of this loop's work is skipped rather than done; see "The post
        // pass does the work it cannot skip" in docs/decisions.md. Both skips
        // are exact, not approximations — each one drops a write that would put
        // back the byte that is already there.
        for (let y = 0, i = 0, p = 0; y < height; y++) {
            // One noise value per cell, so the lookup and the speck happen once
            // per cell rather than once per pixel, and a silent cell skips its
            // whole run.
            const rowBase = speckle ? (((y/cell)|0) & TILE_MASK)*TILE : 0
            let cx = 0, held = 0, n = 0, ng = 0, nb = 0, silent = true
            if (speckle) {
                n = ng = nb = speck(noise[rowBase], cut, spread)
                if (!mono) {
                    ng = speck(noise[(rowBase + step) & MASK], cut, spread)
                    nb = speck(noise[(rowBase + step*2) & MASK], cut, spread)
                }
                silent = n === 0 && ng === 0 && nb === 0
            }

            for (let x = 0; x < width; x++, i++, p += 4) {
                if (shade) {
                    const m = mask[i]
                    // Exactly 1 is the whole inside of the vignette, and it
                    // writes each channel back unchanged.
                    if (m !== 1) {
                        data[p] = baseR + (data[p] - baseR)*m
                        data[p + 1] = baseG + (data[p + 1] - baseG)*m
                        data[p + 2] = baseB + (data[p + 2] - baseB)*m
                    }
                }
                // A silent cell adds zero to three bytes that are already
                // clamped integers.
                if (speckle && !silent) {
                    const r = data[p], g = data[p + 1], b = data[p + 2]
                    const weight = Math.abs(luma(r, g, b) - baseLuma)/255
                    if (weight > 0) {
                        const scale = strength*weight
                        data[p] = r + n*scale
                        data[p + 1] = g + ng*scale
                        data[p + 2] = b + nb*scale
                    }
                }
                if (speckle && ++held === cell) {
                    held = 0
                    const at = rowBase + (++cx & TILE_MASK)
                    n = ng = nb = speck(noise[at], cut, spread)
                    if (!mono) {
                        ng = speck(noise[(at + step) & MASK], cut, spread)
                        nb = speck(noise[(at + step*2) & MASK], cut, spread)
                    }
                    silent = n === 0 && ng === 0 && nb === 0
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
