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
    // The station or the Bézier handle the hand is moving, when it is not moving
    // a bare focal point. Never more than one of the three at a time.
    draggingStation = null,
    draggingHandle = null,
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

// One weight for every point — and every station, or applyTracks would write
// the stations' old weights back over the points on the next step and the
// slider would do nothing to an animated point. Point writes go through
// setWeight so d is recalculated the one existing way.
const applySharedWeight = () => {
    if (params.manualWeight) return
    for (let i = 0; i < nEllipse.numberOfFocalPoints; i++) {
        nEllipse.setWeight(i, params.sharedWeight)
    }
    for (const track of animation.tracks) Animation.setWeight(track, params.sharedWeight)
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
    // The stations too, or applyTracks writes the old canvas back over the
    // points on the next step.
    for (const track of animation.tracks) Animation.rescale(track, scaleX, scaleY, scaleWeight)
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
    const state = Preset.capture(params, nEllipse, animation, random.seed, width, height)
    history.replaceState(null, "", `#${Preset.encode(state)}`)
}

// weight null means "whatever the panel says": the shared weight while that is
// in charge, so a new point matches the others, or unit_d in manual mode.
// The animation keeps one track per focal point, bound by position, and
// NEllipse.addFocalPoint unshifts — so a new point takes index 0 and every
// existing track shifts with it.
// The selection is an index into the same list, so it shifts with the tracks
// rather than being clamped: without this the point the user had open silently
// becomes its neighbour.
const addFocalPoint = (x, y, weight=null) => {
    if (weight === null && !params.manualWeight) weight = params.sharedWeight
    nEllipse.addFocalPoint(new FocalPoint(x, y), weight)
    animation.insertTrack(0)
    if (panel && panel.selectedPoint >= 0) panel.selectPoint(panel.selectedPoint + 1)
    markStateChanged()
    if (panel) panel.syncFocalPoints()
}

const removeFocalPoint = (index=0) => {
    const removed = index >= 0 && index < nEllipse.numberOfFocalPoints
    nEllipse.removeFocalPoint(index)
    if (removed) animation.removeTrack(index)
    if (panel && removed && panel.selectedPoint >= 0) {
        // The selected point itself can be the one that went.
        if (panel.selectedPoint === index) panel.selectPoint(-1)
        else if (panel.selectedPoint > index) panel.selectPoint(panel.selectedPoint - 1)
    }
    markStateChanged()
    if (panel) panel.syncFocalPoints()
}

// The point the hand is steering, or -1. One helper for both readers — the
// writer here and the skip in applyTracks — so they cannot disagree about which
// point the cursor owns. Only while the image is being fed: on the way over to
// the panel the cursor would otherwise drag a point across a finished picture.
// With nothing selected it is the newest point, which is where addFocalPoint
// puts one and what "follow" meant before the selection existed.
const steeredPoint = () => {
    if (!params.exposing || !params.followFocalPoint || !panel) return -1
    const index = panel.selectedPoint >= 0 ? panel.selectedPoint : 0
    return index < nEllipse.numberOfFocalPoints ? index : -1
}

const update = () => {
    const steered = nEllipse.focalPoints[steeredPoint()]
    if (steered) {
        const point = toCanvas(mf.x, mf.y)
        steered.x = point.x
        steered.y = point.y
        panel.refreshFocalValues()
    }

    if (exportRun) {
        // A special play: the export drives the one stepping loop with a count
        // and captures once per frame. See exportFrame.
        exportFrame()
    } else if (params.exposing) {
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
// Where the timeline says each point is, written before the particles move so a
// frame's particles see that frame's figure. A track with no stations returns
// null and its point is left exactly where the by-hand workflow put it.
//
// This is the one place the plan and its modulation compose into a position.
// Everything else — the station list, the canvas markers, addStation — reads
// the plan, so a tremor never gets frozen into a station.
// While follow mode runs, the hand owns the steered point completely and its
// track lets go: position from the cursor, weight left where it was, no
// modulator either, since a modulator is part of the plan. Applying the plan
// and overwriting the position afterwards would leave half of each. Nothing is
// written into the track, so switching follow off restores the plan exactly —
// see "One selected focal point" in docs/decisions.md.
const applyTracks = () => {
    if (!animation.animated) return
    const { duration, loop } = params.animation
    const steered = steeredPoint()
    animation.tracks.forEach((track, index) => {
        const point = nEllipse.focalPoints[index]
        if (!point || index === steered) return
        const at = Animation.at(track, animation.time, duration, loop)
        if (!at) return
        const wobble = Animation.modulate(track, at, random.seed)
        point.x = at.x + wobble.x
        point.y = at.y + wobble.y
        // The pulse is a weight that differs from step to step, which is what
        // Manual mode means; with the shared weight in charge it stays locked
        // in the panel and silent here, like the station weights it rides on.
        const weight = params.manualWeight ? at.weight + wobble.weight : at.weight
        // Through setWeight, so d is recalculated the one existing way.
        if (point.weight !== weight) nEllipse.setWeight(index, weight)
    })
}

const step = () => {
    let correctionCounter = 0
    applyTracks()
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
    // The white point this render used — not one recomputed — and only when
    // something redrew, so the plot moves with the image and no more often.
    if (panel) panel.refreshToneCurve(density.whitePoint)
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
        const selected = panel ? panel.selectedPoint : -1
        nEllipse.focalPoints.forEach((point, index) => {
            ctx.beginPath()
            ctx.moveTo(point.x, point.y - crossSize)
            ctx.lineTo(point.x, point.y + crossSize)
            ctx.moveTo(point.x - crossSize, point.y)
            ctx.lineTo(point.x + crossSize, point.y)
            ctx.stroke()
            // The selection drives the Playback tab and follow mode, so it has
            // to be visible on the canvas too: a ring around its cross.
            if (index === selected) {
                ctx.beginPath()
                ctx.arc(point.x, point.y, crossSize, 0, Math.PI*2)
                ctx.stroke()
            }
        })
    }

    drawTrack(gradient)
}

// The spatial half of the Playback tab: the open track's legs, a marker at each
// station, and a dot where the clock is. Drawn on the visible canvas after the
// blit, so — like the crosses — it never reaches an exported PNG.
const drawTrack = (gradient) => {
    if (!panel) return
    const track = animation.tracks[panel.selectedPoint]
    if (!track || track.stations.length === 0) return

    const scale = Math.max(1, Math.round(canvasScale())),
        stations = track.stations,
        { duration, loop } = params.animation

    ctx.save()
    ctx.strokeStyle = gradient.top
    ctx.fillStyle = gradient.top
    ctx.lineWidth = scale

    // The legs. The last one joins back to the first only when the timeline
    // loops; a one-shot simply holds at its last station.
    ctx.globalAlpha = .5
    ctx.beginPath()
    stations.forEach((station, index) => {
        const next = stations[index + 1] || (loop ? stations[0] : null)
        if (!next) return
        ctx.moveTo(station.x, station.y)
        if (station.curve) ctx.quadraticCurveTo(station.cx, station.cy, next.x, next.y)
        else ctx.lineTo(next.x, next.y)
    })
    ctx.stroke()

    // Stations, with the one the clock is sitting on — the editable one — filled.
    const size = 4*scale
    ctx.globalAlpha = 1
    for (const station of stations) {
        const here = station.time === animation.time
        ctx.beginPath()
        ctx.rect(station.x - size, station.y - size, size*2, size*2)
        if (here && !animation.playing) ctx.fill()
        else ctx.stroke()

        // The handle of a curved leg, and only while its station is editable:
        // it is the one the hand may drag.
        if (station.curve && here && !animation.playing) {
            ctx.globalAlpha = .5
            ctx.beginPath()
            ctx.moveTo(station.x, station.y)
            ctx.lineTo(station.cx, station.cy)
            ctx.stroke()
            ctx.beginPath()
            ctx.arc(station.cx, station.cy, size, 0, Math.PI*2)
            ctx.stroke()
            ctx.globalAlpha = 1
        }
    }

    // Where the plan puts the point right now, which is not always a station.
    // The plan, not the wobble: the cross above already shows where the point
    // actually is, so the two together make the modulation visible.
    const at = Animation.at(track, animation.time, duration, loop)
    if (at) {
        ctx.beginPath()
        ctx.arc(at.x, at.y, size*.75, 0, Math.PI*2)
        ctx.fill()
    }
    ctx.restore()
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

// ---- timelapse export -------------------------------------------------
//
// One button and a special play, not a mode: a fresh exposure, the timeline
// played from the start at a fixed number of steps per frame, every frame
// recorded from a hidden canvas so no overlay gets in, and a stop at the end
// with the finished image left on the canvas. The recorder observes the run
// and never changes it — the density after an export is what playing the same
// timeline without one leaves. See "Timelapse export" in docs/decisions.md.
//
// Session state, never in Params: an export is not something a link restores.
let exportRun = null

// The codecs worth asking for, best first. MediaRecorder's default bitrate
// smears a film of fine traces, so it is set high and explicitly.
const EXPORT_TYPES = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
const EXPORT_BITRATE = 40_000_000

const exportFrames = () => {
    const span = Animation.span(params.animation.duration)
    const perFrame = Math.max(1, Math.round(params.animation.stepsPerFrame))
    // Plus the empty first frame, captured before any step.
    return Math.ceil(span/perFrame) + 1
}

const exportName = () => `n-ellipse-${random.seed}-${width}x${height}.webm`

const exportTimelapse = () => {
    if (exportRun) {
        cancelExport()
        return
    }
    if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
        panel.setExportStatus("This browser cannot record a canvas.", true)
        return
    }

    const target = document.createElement("canvas")
    target.width = width
    target.height = height
    // Zero frame rate: a frame goes to the recorder only on requestFrame, so
    // it gets exactly one per export frame and nothing in between.
    const stream = target.captureStream(0)
    const mimeType = EXPORT_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || ""
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: EXPORT_BITRATE })
    const chunks = []
    recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data)
    })
    recorder.addEventListener("stop", () => {
        if (!run.finished) return
        const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" })
        download(blob, exportName())
        panel.setExportStatus(`Exported ${run.frame} frames.`)
    })

    const run = {
        recorder,
        stream,
        target: target.getContext("2d"),
        perFrame: Math.max(1, Math.round(params.animation.stepsPerFrame)),
        total: exportFrames(),
        frame: 0,
        finished: false,
        // What a cancel puts back: the settings the export overrides, the clock,
        // and the image that was on the canvas.
        restore: {
            exposing: params.exposing,
            accumulate: params.accumulate,
            loop: params.animation.loop,
            followFocalPoint: params.followFocalPoint,
            time: animation.time,
            density: density.data.slice(),
            whitePoint: density.whitePoint,
            max: density.max
        }
    }

    // A fresh exposure, the way a new one starts: exposure mode, an empty
    // buffer, the seeded stream from its start, and the clock at 0. The hand
    // is taken off the figure, and loop is off — a film has an end.
    params.accumulate = true
    params.exposing = true
    params.followFocalPoint = false
    params.animation.loop = false
    density.clear()
    animation.seek(0, params.animation.duration, false)
    animation.playing = true
    spawnParticles()
    applyTracks()
    panel.sync()

    exportRun = run
    panel.setExporting(true)
    recorder.start()
    // The first frame is the empty canvas, before any step.
    captureExportFrame()
}

// One video frame: the steps it gets, one render, one capture. The stepping is
// the ordinary step(), driven with a count — not a second loop.
const exportFrame = () => {
    const run = exportRun
    for (let i = 0; i < run.perFrame && animation.playing; i++) step()
    captureExportFrame()
    if (!animation.playing) finishExport()
}

const captureExportFrame = () => {
    const run = exportRun
    render()
    // The hidden canvas gets the post-processed pixels and nothing drawn on
    // top of them — the same copy savePng makes.
    run.target.putImageData(imageData, 0, 0)
    const [track] = run.stream.getVideoTracks()
    if (track && typeof track.requestFrame === "function") track.requestFrame()
    else if (typeof run.stream.requestFrame === "function") run.stream.requestFrame()
    run.frame++
    panel.setExportStatus(`Exporting — frame ${run.frame} of ${run.total}.`)
}

// The film is done: the exposure is held with the finished picture in it,
// gradeable and saveable like any other, and the settings the export overrode
// go back — except that it is paused, which is the point.
const finishExport = () => {
    const run = exportRun
    exportRun = null
    run.finished = true
    params.exposing = false
    params.followFocalPoint = run.restore.followFocalPoint
    params.animation.loop = run.restore.loop
    animation.playing = false
    panel.setExporting(false)
    panel.sync()
    needsRender = true
    // A frame requested from a captureStream(0) reaches the recorder
    // asynchronously; stopping in the same tick as the last requestFrame could
    // leave the finished image out of the file. One animation frame later is
    // enough for it to land. See T27b in docs/decisions.md.
    requestAnimationFrame(() => run.recorder.stop())
}

// A second press: the recorder is stopped without a file, and everything the
// export changed is put back — including the image that was on the canvas.
const cancelExport = () => {
    const run = exportRun
    exportRun = null
    run.recorder.stop()
    params.exposing = run.restore.exposing
    params.accumulate = run.restore.accumulate
    params.followFocalPoint = run.restore.followFocalPoint
    params.animation.loop = run.restore.loop
    // The canvas could have been resized mid-export from the Parameters tab;
    // the old image only fits the canvas it was drawn on.
    if (run.restore.density.length === density.data.length) {
        density.data.set(run.restore.density)
        density.whitePoint = run.restore.whitePoint
        density.max = run.restore.max
    }
    animation.playing = false
    animation.seek(run.restore.time, params.animation.duration, params.animation.loop)
    spawnParticles()
    applyTracks()
    panel.setExporting(false)
    panel.sync()
    panel.setExportStatus("Export cancelled — no file was written.")
    needsRender = true
}

const download = (blob, name) => {
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
}

const savePreset = () => {
    const preset = Preset.capture(params, nEllipse, animation, random.seed, width, height)
    download(new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" }),
        `n-ellipse-${random.seed}.json`)
    panel.setPresetStatus(`Saved as n-ellipse-${random.seed}.json`)
}

// Shared by the file loader and the state link. Throws if the document is not a
// valid preset; nothing is written before Preset.apply has accepted it.
const applyPreset = (data) => {
    const preset = Preset.apply(data, params, nEllipse, animation)

    // The preset carries its own aspect and resolution, and coordinates that
    // belong to the canvas it was made on — so resize first, then scale the
    // figure in, exactly as a resolution change does.
    resizeCanvas()
    if (preset.width && preset.height) rescaleFocalPoints(preset.width, preset.height)
    applyDefaultWeight()
    // Preset.apply has already restored the tracks, or given fresh empty ones.
    // The timeline starts at the beginning of the restored animation, stopped:
    // a preset carries the animation's plan, never its run state.
    animation.playing = false
    animation.seek(0, params.animation.duration, params.animation.loop)
    applyTracks()
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

// The station the clock is sitting exactly on, which is the only one the hand
// may move — see "Editing rules on the Playback tab" in docs/roadmap.md.
const stationUnderClock = (track) =>
    track ? track.stations.find(station => station.time === animation.time) : undefined

// The Bézier handle of a curved leg leaving an editable station. Only the open
// track's handles are draggable, and only the one the clock is on.
const pickHandle = (x, y) => {
    if (!panel || animation.playing) return null
    const track = animation.tracks[panel.selectedPoint]
    const station = stationUnderClock(track)
    if (!station || !station.curve) return null
    const radius = 12*canvasScale()
    return Math.hypot(station.cx - x, station.cy - y) < radius ? station : null
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
        // Moving the clock now moves the figure, so it has to repaint — T23
        // could leave seeking alone because nothing moved.
        timelineSeeked: () => {
            applyTracks()
            panel.refreshFocalValues()
            needsRender = true
        },
        // A station changed: the figure follows it, and the state is saved.
        animationEdited: () => {
            applyTracks()
            panel.refreshFocalValues()
            markStateChanged()
        },
        // The open track is drawn on the canvas, so the selection is picture state.
        selectionChanged: () => { needsRender = true },
        savePng,
        savePreset,
        loadPreset,
        resetParams,
        exportTimelapse,
        exportFrames,
        exportName,
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

    // One writer at a time, which is what the editing rules buy: a point under a
    // track and a point under the hand would otherwise both write its position
    // and the last one in the frame would win silently.
    canvas.addEventListener("mousedown", (event) => {
        // A hand on the figure would steer the film.
        if (exportRun) {
            panel.setPlaybackStatus("Exporting — cancel it before moving anything.", true)
            return
        }
        const point = toCanvas(event.clientX, event.clientY)

        draggingHandle = pickHandle(point.x, point.y)
        if (draggingHandle) return

        // Empty canvas is a no-op and deliberately does not clear the selection:
        // a mis-click would otherwise close the track that was open.
        const index = pickFocalPoint(point.x, point.y)
        if (index < 0) return

        // Clicking a point selects it whether or not it has a track, whatever
        // happens next — the selection is what follow mode steers and what the
        // Playback tab opens.
        if (panel.selectedPoint !== index) panel.selectPoint(index)
        const track = animation.tracks[index]

        // A point with no track is the normal case, and the by-hand workflow is
        // unchanged for it.
        if (!track || track.stations.length === 0) {
            dragging = index
            return
        }

        if (animation.playing) {
            panel.setPlaybackStatus("The timeline is running — stop it to move a station.", true)
            return
        }
        const station = stationUnderClock(track)
        if (!station) {
            panel.setPlaybackStatus("The clock is between stations. Go to one to move it.", true)
            return
        }
        draggingStation = station
        panel.setPlaybackStatus(`Moving the station at step ${Math.round(station.time)}.`)
    })

    window.addEventListener("mousemove", (event) => {
        if (dragging < 0 && !draggingStation && !draggingHandle) return
        const point = toCanvas(event.clientX, event.clientY)

        if (draggingHandle) {
            draggingHandle.cx = point.x
            draggingHandle.cy = point.y
        } else if (draggingStation) {
            draggingStation.x = point.x
            draggingStation.y = point.y
            // The figure has to follow the station under the cursor, and the
            // panel's numbers with it.
            applyTracks()
            panel.refreshStationValues()
            panel.refreshFocalValues()
        } else {
            const focal = nEllipse.focalPoints[dragging]
            if (!focal) return
            focal.x = point.x
            focal.y = point.y
            panel.refreshFocalValues()
        }
        markStateChanged()
    })

    window.addEventListener("mouseup", () => {
        dragging = -1
        draggingStation = null
        draggingHandle = null
    })

    document.body.addEventListener("keydown", (event) => {
        // The panel's own inputs keep their keys.
        if (event.target.closest(".panel")) return

        // Every key but the overlay toggle would start a new exposure or move
        // the figure, which is the film being wrecked rather than steered.
        if (exportRun && event.key !== "s") {
            panel.setPlaybackStatus("Exporting — cancel it first.", true)
            return
        }

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
