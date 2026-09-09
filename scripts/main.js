import NEllipse from "./NEllipse.js"
import Particle from "./Particle.js"
import FocalPoint from "./FocalPoint.js"
import MouseFollower from "./MouseFollower.js"
import DensityBuffer from "./DensityBuffer.js"
import Random from "./Random.js"
import Params from "./Params.js"
import Panel from "./Panel.js"
import Preset from "./Preset.js"
import Gradient from "./Gradient.js"
import PostProcess from "./PostProcess.js"
import Bloom from "./Bloom.js"
import Animation from "./Animation.js"

const canvas = document.querySelector('canvas'),
    stage = document.querySelector('.stage'),
    ctx = canvas.getContext("2d")

const params = new Params()
const density = new DensityBuffer(1, 1)
const nEllipse = new NEllipse(0)
const post = new PostProcess()
const bloom = new Bloom()
const animation = new Animation()
const mf = new MouseFollower()

// The URL hash carries the whole state, so a run can be linked and replayed.
// Links from before that are a bare seed, and still work.
// Everything here is a string someone pasted, so the whole of it — including
// the percent decoding — has to survive being wrong.
const readHash = () => {
    let raw = ""
    try {
        raw = decodeURIComponent(location.hash.slice(1))
        const preset = Preset.decode(raw)
        if (preset) return { preset, seed: typeof preset.seed === "string" ? preset.seed : null }
    } catch (error) {
        // A hash that claims to be a state link and is not readable is not a
        // seed either; say so and start fresh rather than pretending.
        console.warn("Ignoring an unreadable state link:", error.message)
        return { preset: null, seed: null }
    }
    return { preset: null, seed: raw || null }
}

const startup = readHash()
const random = new Random(startup.seed || Random.randomSeed())

let width = 1,
    height = 1,
    imageData = null,
    particles = [],
    panel = null,
    dragging = -1,
    // What the canvas frame currently shows, so the class is written only on a
    // transition. null until the first render, which then writes both.
    accumulating = null,
    exposing = null,
    // Raised by anything that changes the picture; cleared by render.
    needsRender = true

// Reused every frame: the vignette's base colour, read from the ramp at 0.
const baseColour = [0, 0, 0]

// Canvas pixels, not screen pixels: the canvas is scaled by CSS to fit the
// space left next to the panel.
const toCanvas = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect()
    return {
        x: (clientX - rect.left) * width/rect.width,
        y: (clientY - rect.top) * height/rect.height
    }
}

const canvasScale = () => width/canvas.getBoundingClientRect().width

const resizeCanvas = () => {
    const size = params.canvasSize(stage.clientWidth, stage.clientHeight)
    if (size.width === width && size.height === height) return false

    width = canvas.width = size.width
    height = canvas.height = size.height
    density.resize(width, height)
    imageData = ctx.createImageData(width, height)
    if (panel) panel.setCanvasSize(width, height)
    return true
}

// The default weight of a focal point is a third of the shorter canvas side, so
// it has to follow the canvas whenever the pixel size changes.
const applyDefaultWeight = () => {
    nEllipse.unit_d = Math.round(Math.min(width, height)/3)
    // In manual mode the slider tracks the canvas default, so switching back to
    // the shared weight starts from the size the canvas suggests. With no points
    // yet — both passes on load — there is nothing to preserve either.
    if (params.manualWeight || nEllipse.numberOfFocalPoints === 0) {
        params.sharedWeight = nEllipse.unit_d
    }
    nEllipse.recalculateD()
}

// One weight for every point. Writes go through setWeight so d is recalculated
// the one existing way.
const applySharedWeight = () => {
    if (params.manualWeight) return
    for (let i = 0; i < nEllipse.numberOfFocalPoints; i++) {
        nEllipse.setWeight(i, params.sharedWeight)
    }
}

// A deliberate resolution change takes the whole figure with it: the points keep
// their place in the frame and their size relative to it. Only the panel path
// does this — a window resize leaves the figure in place, along with the
// density it belongs to. See AGENTS.md.
const rescaleFocalPoints = (fromWidth, fromHeight) => {
    const scaleX = width/fromWidth,
        scaleY = height/fromHeight,
        scaleWeight = Math.min(width, height)/Math.min(fromWidth, fromHeight)
    params.sharedWeight = Math.round(params.sharedWeight*scaleWeight)
    for (const point of nEllipse.focalPoints) {
        point.x *= scaleX
        point.y *= scaleY
        point.weight = Math.round(point.weight*scaleWeight)
    }
}

const spawnParticles = () => {
    random.reset()
    particles = []
    for (let i = 0; i < params.particleCount; i++) {
        particles.push(new Particle(random.between(0, width), random.between(0, height)))
    }
}

const applySeed = (seed) => {
    random.seed = String(seed) || Random.randomSeed()
    if (panel) panel.setSeed(random.seed)
    density.clear()
    spawnParticles()
    markStateChanged()
}

// The hash follows the state, but not on every slider pixel: a change arms a
// short timer, and the write goes through replaceState so dragging a control
// does not fill the back button with a hundred entries.
const HASH_DELAY = 400
let hashDueAt = 0

// Everything that changes the picture goes through here: the hash write is
// debounced, the repaint is not. One call site, two schedules.
const markStateChanged = () => {
    hashDueAt = performance.now() + HASH_DELAY
    needsRender = true
}

const writeHash = () => {
    hashDueAt = 0
    const state = Preset.capture(params, nEllipse, random.seed, width, height)
    history.replaceState(null, "", `#${Preset.encode(state)}`)
}

// weight null means "whatever the panel says": the shared weight while that is
// in charge, so a new point matches the others, or unit_d in manual mode.
// The animation keeps one track per focal point, bound by position, and
// NEllipse.addFocalPoint unshifts — so a new point takes index 0 and every
// existing track shifts with it.
const addFocalPoint = (x, y, weight=null) => {
    if (weight === null && !params.manualWeight) weight = params.sharedWeight
    nEllipse.addFocalPoint(new FocalPoint(x, y), weight)
    animation.insertTrack(0)
    markStateChanged()
    if (panel) panel.syncFocalPoints()
}

const removeFocalPoint = (index=0) => {
    const removed = index >= 0 && index < nEllipse.numberOfFocalPoints
    nEllipse.removeFocalPoint(index)
    if (removed) animation.removeTrack(index)
    markStateChanged()
    if (panel) panel.syncFocalPoints()
}

const update = () => {
    // Only while the image is being fed: on the way over to the panel the
    // cursor would otherwise drag focal point 0 across a finished picture.
    if (params.exposing && params.followFocalPoint && nEllipse.numberOfFocalPoints > 0) {
        const point = toCanvas(mf.x, mf.y)
        nEllipse.focalPoints[0].x = point.x
        nEllipse.focalPoints[0].y = point.y
        panel.refreshFocalValues()
    }

    if (params.exposing) {
        step()
        // Directly, never through markStateChanged: that one is debounced, and
        // pushing its deadline forward every frame would stop the URL hash from
        // ever being written.
        needsRender = true
    }
    if (needsRender) render()

    // Guarded inside, like every other per-frame DOM write. It runs while the
    // transport is on and for one frame after it stops, so the button that a
    // finished one-shot just released still flips back.
    if (animation.playing || panel.shownPlaying) panel.refreshTransport()

    if (hashDueAt && performance.now() >= hashDueAt) writeHash()
    window.requestAnimationFrame(update)
}

// Feeding the image: move the particles, then count their hits. The order is
// what a seed reproduces — leave it alone.
const step = () => {
    let correctionCounter = 0
    for (let p of particles) {
        p.update(nEllipse, random, params.step)
        correctionCounter += particleCorrection(p, random)
    }

    if (!params.accumulate) density.clear()
    for (let p of particles) {
        density.add(p.x, p.y)
    }

    // The animation's clock, at the end of the step so that after N steps it
    // reads N. It runs only from here, so it advances exactly when the image is
    // being fed and never in wall-clock time — see "The animation clock counts
    // steps" in docs/decisions.md.
    if (animation.playing) {
        if (animation.advance(params.animation.duration, params.animation.loop)) {
            animation.playing = false
        }
    }
}

// Density to pixels. Runs when something that affects the picture has changed,
// and is never gated by the exposure — that split is the whole point. See "The
// exposure is not the redraw" in docs/decisions.md.
const render = () => {
    needsRender = false

    // Parsed once per edit, not once per frame — Gradient.from caches on the
    // stop list itself.
    const gradient = Gradient.from(params.gradient)
    syncCanvasFrame()

    // The threshold is a fraction of what the image is normalised to, so it
    // keeps meaning the same thing as the run gets brighter. whitePoint is
    // zero on the first frames, before it has caught up with anything.
    const glow = params.bloom.enabled && params.bloom.strength > 0
        ? bloom.apply(density.data, width, height, params.bloom,
            density.whitePoint || density.max)
        : null

    density.render(imageData, {
        exposure: params.exposure,
        gamma: params.gamma,
        // A held exposure gets no new data, so there is nothing to ease
        // towards. Snapping also keeps the white point still while someone
        // judges a gamma change against it.
        adaptation: params.exposing ? params.adaptation : 1,
        gradient,
        source: glow && glow.data,
        max: glow && glow.max
    })
    // In place, on the freshly rendered pixels — nothing else writes imageData,
    // so the effects cannot pile up on themselves.
    post.apply(imageData.data, width, height, {
        vignette: params.vignette,
        grain: params.grain,
        base: gradient.sample(0, baseColour)
    })
    ctx.putImageData(imageData, 0, 0)

    if (params.showFocalPoints) {
        // Crosses stay the same size on screen whatever the canvas resolution,
        // and take the ramp's densest colour so they stand out on the image.
        ctx.strokeStyle = gradient.top
        ctx.lineWidth = Math.max(1, Math.round(canvasScale()))
        const crossSize = 5*ctx.lineWidth
        nEllipse.focalPoints.forEach(point => {
            ctx.beginPath()
            ctx.moveTo(point.x, point.y - crossSize)
            ctx.lineTo(point.x, point.y + crossSize)
            ctx.moveTo(point.x - crossSize, point.y)
            ctx.lineTo(point.x + crossSize, point.y)
            ctx.stroke()
        })
    }
}

// A red frame means the image is being kept, a quiet one that the exposure is
// held. Guarded: render runs every frame while the exposure is running.
const syncCanvasFrame = () => {
    if (params.accumulate !== accumulating) {
        accumulating = params.accumulate
        canvas.classList.toggle("exposing", accumulating)
    }
    if (params.exposing !== exposing) {
        exposing = params.exposing
        canvas.classList.toggle("held", !exposing)
    }
}

// The margin is the same on every side: tolerance canvases beyond each edge,
// so 0 recycles a particle as soon as it leaves the visible area.
const particleCorrection = (particle, random) => {
    let change = false
    const marginX = params.tolerance*width,
        marginY = params.tolerance*height
    if (particle.x > width + marginX || particle.x < -marginX) {
        change = true
        particle.x = random.between(0, width)
    }
    if (particle.y > height + marginY || particle.y < -marginY) {
        change = true
        particle.y = random.between(0, height)
    }
    return change
}

// The visible canvas carries the focal-point crosses on top of the image, so
// the export goes through an offscreen copy of the density render instead.
const savePng = () => {
    const target = document.createElement("canvas")
    target.width = width
    target.height = height
    target.getContext("2d").putImageData(imageData, 0, 0)

    target.toBlob((blob) => download(blob, `n-ellipse-${random.seed}-${width}x${height}.png`))
}

const download = (blob, name) => {
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}

const savePreset = () => {
    const preset = Preset.capture(params, nEllipse, random.seed, width, height)
    download(new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" }),
        `n-ellipse-${random.seed}.json`)
    panel.setPresetStatus(`Saved as n-ellipse-${random.seed}.json`)
}

// Shared by the file loader and the state link. Throws if the document is not a
// valid preset; nothing is written before Preset.apply has accepted it.
const applyPreset = (data) => {
    const preset = Preset.apply(data, params, nEllipse)

    // The preset carries its own aspect and resolution, and coordinates that
    // belong to the canvas it was made on — so resize first, then scale the
    // figure in, exactly as a resolution change does.
    resizeCanvas()
    if (preset.width && preset.height) rescaleFocalPoints(preset.width, preset.height)
    applyDefaultWeight()
    // The point list was replaced wholesale, so there is no track order to
    // preserve; the timeline starts at the beginning of the restored animation,
    // stopped. A preset carries the animation's settings, never its run state.
    animation.syncTracks(nEllipse.numberOfFocalPoints)
    animation.playing = false
    animation.seek(0, params.animation.duration, params.animation.loop)
    panel.syncFocalPoints()
    panel.sync()
    applySeed(preset.seed || random.seed)
}

// Back to the state a first visit without a link would give, seed aside: every
// Params field from a fresh instance, one centred focal point, an empty image.
// The seed is not a parameter and has no default, so it stays.
const resetParams = () => {
    Object.assign(params, new Params())

    resizeCanvas()
    nEllipse.focalPoints = []
    animation.syncTracks(0)
    animation.playing = false
    animation.seek(0, params.animation.duration, params.animation.loop)
    applyDefaultWeight()
    addFocalPoint(Math.round(width/2), Math.round(height/2))
    panel.sync()
    density.clear()
    spawnParticles()
    markStateChanged()
}

// The file comes from the user, so everything here can fail: Preset.apply
// validates the contents, and the status line reports whatever went wrong.
const loadPreset = async (file) => {
    try {
        applyPreset(JSON.parse(await file.text()))
    } catch (error) {
        panel.setPresetStatus(`Could not load ${file.name}: ${error.message}`, true)
        return
    }
    panel.setPresetStatus(`Loaded ${file.name}`)
}

// Dragging a focal point: nearest one within a fixed screen-space radius.
const pickFocalPoint = (x, y) => {
    const radius = 12*canvasScale()
    let best = -1, bestDistance = radius
    nEllipse.focalPoints.forEach((point, index) => {
        const d = point.distance({ x, y })
        if (d < bestDistance) {
            bestDistance = d
            best = index
        }
    })
    return best
}

window.onload = () => {
    resizeCanvas()
    applyDefaultWeight()

    panel = new Panel(params, nEllipse, animation, {
        // A new pixel size is a new image: the density is resolution-specific,
        // so it is dropped here. A window resize keeps it — see AGENTS.md.
        canvasChanged: () => {
            const previousWidth = width,
                previousHeight = height
            if (!resizeCanvas()) return

            rescaleFocalPoints(previousWidth, previousHeight)
            applyDefaultWeight()
            panel.sync()
            density.clear()
            spawnParticles()
        },
        countChanged: () => spawnParticles(),
        // The panel's own constructor can reach this before `panel` is assigned.
        weightChanged: () => {
            applySharedWeight()
            if (panel) panel.syncWeightControls()
        },
        addFocalPoint: () => addFocalPoint(Math.round(width/2), Math.round(height/2)),
        removeFocalPoint: (index) => removeFocalPoint(index),
        seedChanged: (seed) => applySeed(seed),
        seedRolled: () => applySeed(Random.randomSeed()),
        savePng,
        savePreset,
        loadPreset,
        resetParams,
        changed: markStateChanged,
        // Only the commented-out New exposure button calls this today; switching
        // to Live and back does the same thing in two clicks. Kept because the
        // repaint below is the non-obvious half of it: without it the old image
        // would stay on screen over an empty buffer.
        clearImage: () => {
            density.clear()
            needsRender = true
        }
    })
    panel.setSeed(random.seed)
    panel.setCanvasSize(width, height)

    // The panel changed the stage width, so the canvas may need a second pass.
    if (resizeCanvas()) {
        applyDefaultWeight()
        panel.sync()
    }

    // A state link rebuilds the whole scene; anything else starts from one
    // centred focal point. A damaged link is not worth refusing to start over.
    let restored = false
    if (startup.preset) {
        try {
            applyPreset(startup.preset)
            restored = true
        } catch (error) {
            console.warn("Ignoring a damaged state link:", error.message)
        }
    }
    if (!restored) {
        addFocalPoint(Math.round(width/2), Math.round(height/2))
        spawnParticles()
    }
    writeHash()

    mf.addMouseMoveEventListener()

    canvas.addEventListener("mousedown", (event) => {
        const point = toCanvas(event.clientX, event.clientY)
        dragging = pickFocalPoint(point.x, point.y)
    })

    window.addEventListener("mousemove", (event) => {
        if (dragging < 0) return
        const focal = nEllipse.focalPoints[dragging]
        if (!focal) return
        const point = toCanvas(event.clientX, event.clientY)
        focal.x = point.x
        focal.y = point.y
        panel.refreshFocalValues()
        markStateChanged()
    })

    window.addEventListener("mouseup", () => {
        dragging = -1
    })

    document.body.addEventListener("keydown", (event) => {
        // The panel's own inputs keep their keys.
        if (event.target.closest(".panel")) return

        switch (event.key) {
            case " ":
                params.exposing = !params.exposing
                break
            case "e":
                params.accumulate = !params.accumulate
                break
            case "s":
                params.showFocalPoints = !params.showFocalPoints
                break
            // The signs and the letters are both bound: the signs read as
            // add/remove, the letters need no modifier on any layout.
            case "+":
            case "a":
                {
                    const point = toCanvas(mf.x, mf.y)
                    addFocalPoint(point.x, point.y)
                }
                break
            case "-":
            case "x":
                removeFocalPoint()
                break
            case "f":
                params.followFocalPoint = !params.followFocalPoint
                break
            case "r":
                applySeed(Random.randomSeed())
                break
            default:
                return
        }
        panel.sync()
        markStateChanged()
    })

    window.requestAnimationFrame(update)

    onresize = () => {
        if (resizeCanvas()) {
            spawnParticles()
            markStateChanged()
        }
    }
}
