// The render chain's cost, measured the way T19 measured it, so numbers taken
// months apart can be compared. Run it with `npm run bench`.
//
// This is Node, not the browser: `putImageData` is not in any of these numbers,
// and neither is anything else the compositor does. Read the ratios between
// stages and between runs, not the absolute milliseconds.
//
// Method, fixed here so it does not have to be re-decided per measurement:
//
//  - The real modules out of `scripts/`, a fixed seed, 20 000 particles and two
//    focal points. Changing any of those makes a number incomparable with the
//    ones already in `docs/decisions.md`.
//  - WARMUP discarded iterations before every timed block. V8 runs the first
//    iterations in baseline; T19 used 5 and so does this, which is why its
//    figures reproduce.
//  - RUNS timed iterations, averaged.
//  - **One context per process.** Each resolution/fill combination is measured
//    in a forked child that measures nothing else. T19 measured four contexts in
//    one process and its bloom column came out 3.4 ms high at 1080p and 15.9 ms
//    high at 4K — the rows paid for buffers the later part-timings did not. See
//    "The benchmark is checked in, and T19's bloom gap was the harness" in
//    docs/decisions.md. The residual table below is the guard: if the parts stop
//    summing to the whole again, the method has drifted, not the code.
//  - **Comparing two implementations is a different measurement, and this
//    benchmark is the wrong footing for it.** Run-to-run spread here is over
//    10%; interleaved inside one process — every variant once per round, many
//    rounds — it is 1-4%. Comparing a variant in one run against the baseline in
//    another buries any effect smaller than the between-run spread, which is how
//    two of T21's five "does not help" results came to be wrong. Optimising
//    something? Interleave the variants in one process and quote the spread next
//    to the number. See "T21's negative results, re-measured" in
//    docs/decisions.md.
//  - A stage that rewrites its own input is timed as a difference, not on its
//    own. `PostProcess.apply` is the one: repeated in place it converges towards
//    the base colour and measures cheaper than it is.
//  - **The parts are not additive across configurations**, and the output says
//    so. A stage's cost can depend on the image it is handed, so a part timed in
//    one configuration is not the same part in another. Compare a row with its
//    own parts — that is the residual table — never with parts from a different
//    row.
//  - The output is consumed. Every timed block is followed by a checksum over
//    the pixels it produced, printed at the end — the buffers outlive the loop,
//    so V8 cannot drop the stores, and the checksum makes that visible rather
//    than assumed.
//
// `--quick` runs a fraction of the work. It is for checking that the benchmark
// still runs; its numbers are not comparable with anything.
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"

import DensityBuffer from "../scripts/DensityBuffer.js"
import NEllipse from "../scripts/NEllipse.js"
import FocalPoint from "../scripts/FocalPoint.js"
import Particle from "../scripts/Particle.js"
import Random from "../scripts/Random.js"
import Params from "../scripts/Params.js"
import Gradient from "../scripts/Gradient.js"
import Bloom from "../scripts/Bloom.js"
import PostProcess from "../scripts/PostProcess.js"

const SEED = "t19"          // T19's seed; the figures on record are this image
const WARMUP = 5
const RUNS = 30

const quick = process.argv.includes("--quick")

// label, and the fill state the frame count produces
const CONTEXTS = [
    { label: "early", width: 1920, height: 1080, frames: 30 },
    { label: "settled", width: 1920, height: 1080, frames: 3000 },
    { label: "early", width: 3840, height: 2160, frames: 30 },
    { label: "settled", width: 3840, height: 2160, frames: 3000 }
]

// The one piece of browser the render path needs: `DensityBuffer.render` takes a
// Uint32Array view of `data.buffer`, and `PostProcess.apply` walks the bytes.
const makeImageData = (width, height) => ({
    width, height, data: new Uint8ClampedArray(width*height*4)
})

// Cheap and strided: enough to observe the buffer without costing more than the
// render being measured.
const checksum = (data) => {
    let sum = 0
    for (let i = 0; i < data.length; i += 997) sum = (sum + data[i]*(i + 1)) >>> 0
    return sum
}

const buildContext = ({ width, height, frames }) => {
    const params = new Params()
    params.accumulate = true
    params.exposing = true

    const random = new Random(SEED)
    const density = new DensityBuffer(width, height)
    const nEllipse = new NEllipse(0)
    const bloom = new Bloom()
    const post = new PostProcess()

    nEllipse.unit_d = Math.round(Math.min(width, height)/3)
    params.sharedWeight = nEllipse.unit_d
    nEllipse.addFocalPoint(new FocalPoint(width*.5 - width*.12, height*.5), params.sharedWeight)
    nEllipse.addFocalPoint(new FocalPoint(width*.5 + width*.12, height*.5), params.sharedWeight)

    random.reset()
    const particles = []
    for (let i = 0; i < params.particleCount; i++) {
        particles.push(new Particle(random.between(0, width), random.between(0, height)))
    }

    const ctx = { params, random, density, nEllipse, bloom, post, particles,
        width, height, imageData: makeImageData(width, height) }

    for (let f = 0; f < frames; f++) step(ctx)
    return ctx
}

// main.js' step and particleCorrection. Kept in step with them by hand: this
// file is not imported by the sketch, so a change there does not break it here.
const step = (ctx) => {
    const { params, particles, nEllipse, random, density, width, height } = ctx
    const marginX = params.tolerance*width,
        marginY = params.tolerance*height
    for (const p of particles) {
        p.update(nEllipse, random, params.step)
        if (p.x > width + marginX || p.x < -marginX) p.x = random.between(0, width)
        if (p.y > height + marginY || p.y < -marginY) p.y = random.between(0, height)
    }
    if (!params.accumulate) density.clear()
    for (const p of particles) density.add(p.x, p.y)
}

// main.js' render, minus the canvas calls it cannot make here.
const render = (ctx, bloomOn, postOn) => {
    const { params, density, bloom, post, imageData, width, height } = ctx
    const gradient = Gradient.from(params.gradient)

    const glow = bloomOn && params.bloom.strength > 0
        ? bloom.apply(density.data, width, height, params.bloom, density.whitePoint || density.max)
        : null

    density.render(imageData, {
        exposure: params.exposure,
        gamma: params.gamma,
        adaptation: params.exposing ? params.adaptation : 1,
        gradient,
        source: glow && glow.data,
        max: glow && glow.max
    })

    if (postOn) {
        post.apply(imageData.data, width, height, {
            vignette: params.vignette,
            grain: params.grain,
            base: gradient.sample(0, [0, 0, 0])
        })
    }
}

const time = (fn) => {
    const runs = quick ? 5 : RUNS
    for (let i = 0; i < (quick ? 2 : WARMUP); i++) fn()
    const start = performance.now()
    for (let i = 0; i < runs; i++) fn()
    return (performance.now() - start)/runs
}

const fill = (density) => {
    let hit = 0
    for (let i = 0; i < density.data.length; i++) if (density.data[i] > 0) hit++
    return hit/density.data.length
}

// Everything one context contributes to the tables. Runs in a child process with
// nothing else in its heap; see the note at the top of this file.
const measure = (spec) => {
    const ctx = buildContext(spec)
    const { params, density, bloom, post, imageData, width, height } = ctx
    const configure = (bloomOn, vignetteOn, grainOn) => {
        params.bloom.enabled = bloomOn
        params.vignette.enabled = vignetteOn
        params.grain.enabled = grainOn
    }
    let consumed = 0
    const timed = (fn) => {
        const ms = time(fn)
        consumed = (consumed + checksum(imageData.data)) >>> 0
        return ms
    }

    configure(false, false, false)
    const off = timed(() => render(ctx, false, false))
    configure(false, true, true)
    const vignetteGrain = timed(() => render(ctx, false, true))
    configure(true, false, false)
    const bloomed = timed(() => render(ctx, true, false))
    configure(true, true, true)
    const all = timed(() => render(ctx, true, true))

    // The stages on their own. `Bloom.apply` and `DensityBuffer.render` read one
    // buffer and write another, so running them repeatedly measures the same
    // work every time.
    const gradient = Gradient.from(params.gradient)
    const toneOptions = { exposure: params.exposure, gamma: params.gamma,
        adaptation: params.adaptation, gradient }
    configure(true, true, true)
    const bloomStage = timed(() => bloom.apply(density.data, width, height, params.bloom,
        density.whitePoint || density.max))
    const renderStage = timed(() => density.render(imageData, toneOptions))

    // `PostProcess.apply` does not: it rewrites the pixels in place, so a second
    // pass runs on its own output. Left to repeat, the image creeps towards the
    // ramp's base colour, the grain's weight test starts skipping pixels, and
    // the stage measures cheaper than it is — 42.5 ms against the 56 ms it costs
    // on a fresh image at 1080p. So it is timed as a difference: render plus
    // post, minus the same render alone.
    const postPaired = timed(() => {
        density.render(imageData, toneOptions)
        post.apply(imageData.data, width, height, {
            vignette: params.vignette, grain: params.grain, base: gradient.sample(0, [0, 0, 0])
        })
    })
    const renderPaired = timed(() => density.render(imageData, toneOptions))
    const postStage = postPaired - renderPaired

    // Which half of the post pass costs what, on the same paired footing. The
    // two do not add up to the pass with both on, and that is real: the vignette
    // pulls the edge towards the base colour, which is exactly what makes the
    // grain's weight test skip those pixels.
    const postHalf = (vignetteOn, grainOn) => {
        configure(true, vignetteOn, grainOn)
        const paired = timed(() => {
            density.render(imageData, toneOptions)
            post.apply(imageData.data, width, height, {
                vignette: params.vignette, grain: params.grain, base: gradient.sample(0, [0, 0, 0])
            })
        })
        return paired - renderPaired
    }
    const postVignette = postHalf(true, false)
    const postGrain = postHalf(false, true)
    configure(true, true, true)

    const stepStage = time(() => step(ctx))

    return {
        ...spec,
        fill: fill(density),
        top: Math.ceil(density.whitePoint),
        off, vignetteGrain, bloomed, all,
        stepStage, bloomStage, renderStage, postStage,
        postVignette, postGrain,
        consumed
    }
}

const ms = (value) => value.toFixed(1)

const report = (results) => {
    console.log(`\nnode ${process.version} — ${quick ? "QUICK, numbers not comparable" : `${WARMUP} warm-up, ${RUNS} timed runs`}, one context per process`)
    console.log(`seed "${SEED}", ${new Params().particleCount} particles, two focal points, accumulating\n`)

    console.log("Full frame render, milliseconds:\n")
    console.log("| resolution | state | effects off | vignette + grain | bloom | all on |")
    console.log("| --- | --- | --- | --- | --- | --- |")
    for (const r of results) {
        console.log(`| ${r.width}×${r.height} | ${r.label}, ${(r.fill*100).toFixed(0)}% fill | ${ms(r.off)} | ${ms(r.vignetteGrain)} | ${ms(r.bloomed)} | ${ms(r.all)} |`)
    }

    console.log("\nThe parts:\n")
    console.log("| resolution | state | step | Bloom.apply | DensityBuffer.render | PostProcess.apply |")
    console.log("| --- | --- | --- | --- | --- | --- |")
    for (const r of results) {
        console.log(`| ${r.width}×${r.height} | ${r.label} | ${ms(r.stepStage)} | ${ms(r.bloomStage)} | ${ms(r.renderStage)} | ${ms(r.postStage)} |`)
    }
    console.log("\nNot additive across configurations. Each part is timed in one configuration, and")
    console.log("PostProcess.apply is timed on a frame without bloom — measured, it costs 4-6% more")
    console.log("when bloom is in the frame. Build a row out of parts from different rows and the")
    console.log("number comes out wrong; the residual below is what checks a row against its own parts.")

    console.log("\nThe post pass, split — each timed against the same bare render:\n")
    console.log("| resolution | state | vignette only | grain only | both |")
    console.log("| --- | --- | --- | --- | --- |")
    for (const r of results) {
        console.log(`| ${r.width}×${r.height} | ${r.label} | ${ms(r.postVignette)} | ${ms(r.postGrain)} | ${ms(r.postStage)} |`)
    }

    // The guard. A row that stops matching its parts means the harness has
    // drifted — that is exactly how T19's bloom column went 15.9 ms wrong.
    console.log("\nResidual — a row minus its parts, which should be noise:\n")
    console.log("| resolution | state | bloom row − (bloom + render) | all on − (bloom + render + post) |")
    console.log("| --- | --- | --- | --- |")
    for (const r of results) {
        const bloomResidual = r.bloomed - r.bloomStage - r.renderStage,
            allResidual = r.all - r.bloomStage - r.renderStage - r.postStage
        console.log(`| ${r.width}×${r.height} | ${r.label} | ${ms(bloomResidual)} | ${ms(allResidual)} |`)
    }

    console.log(`\nchecksums ${results.map(r => r.consumed).join(" ")} — the pixels were read, not optimised away`)
}

// A child measures exactly one context and reports it back. The parent prints.
const contextArgument = process.argv.indexOf("--context")
if (contextArgument !== -1) {
    const spec = CONTEXTS[Number(process.argv[contextArgument + 1])]
    process.send(measure(quick ? { ...spec, frames: Math.min(spec.frames, 100) } : spec))
} else {
    const self = fileURLToPath(import.meta.url)
    const results = []
    for (let i = 0; i < CONTEXTS.length; i++) {
        const argv = ["--context", String(i), ...(quick ? ["--quick"] : [])]
        results.push(await new Promise((resolve, reject) => {
            const child = fork(self, argv, { stdio: "inherit" })
            let result = null
            child.on("message", (message) => result = message)
            child.on("error", reject)
            child.on("exit", (code) => code === 0 && result
                ? resolve(result)
                : reject(new Error(`context ${i} exited with ${code}`)))
        }))
    }
    report(results)
}
