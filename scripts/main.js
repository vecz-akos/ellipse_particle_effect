import NEllipse from "./NEllipse.js";
import Particle from "./Particle.js";
import FocalPoint from "./FocalPoint.js";
import MouseFollower from "./MouseFollower.js";
import DensityBuffer from "./DensityBuffer.js";
import Random from "./Random.js";
import Params from "./Params.js";
import Panel from "./Panel.js";
import Preset from "./Preset.js";

const canvas = document.querySelector('canvas'),
    stage = document.querySelector('.stage'),
    ctx = canvas.getContext("2d")

const params = new Params()
const density = new DensityBuffer(1, 1)
const nEllipse = new NEllipse(0)
const mf = new MouseFollower()

// The seed lives in the URL hash, so a run can be linked and replayed.
const random = new Random(decodeURIComponent(location.hash.slice(1)) || Random.randomSeed())

let width = 1,
    height = 1,
    imageData = null,
    particles = [],
    panel = null,
    dragging = -1,
    recording = false

const rgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
]

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
    location.hash = encodeURIComponent(random.seed)
    if (panel) panel.setSeed(random.seed)
    density.clear()
    spawnParticles()
}

// weight null means "whatever the panel says": the shared weight while that is
// in charge, so a new point matches the others, or unit_d in manual mode.
const addFocalPoint = (x, y, weight=null) => {
    if (weight === null && !params.manualWeight) weight = params.sharedWeight
    nEllipse.addFocalPoint(new FocalPoint(x, y), weight)
    if (panel) panel.syncFocalPoints()
}

const removeFocalPoint = (index=0) => {
    nEllipse.removeFocalPoint(index)
    if (panel) panel.syncFocalPoints()
}

const update = () => {
    if (params.followFocalPoint && nEllipse.numberOfFocalPoints > 0) {
        const point = toCanvas(mf.x, mf.y)
        nEllipse.focalPoints[0].x = point.x
        nEllipse.focalPoints[0].y = point.y
        panel.refreshFocalValues()
    }

    let correctionCounter = 0
    if (params.animate) {
        for (let p of particles) {
            p.update(nEllipse, random, params.step)
            correctionCounter += particleCorrection(p, random)
        }
    }
    draw()
    window.requestAnimationFrame(update)
}

const draw = () => {
    // Accumulating mode is the old "record": mark it with a red frame, since
    // nothing else on screen says the image is being kept. Only on a transition
    // — this runs every frame.
    const accumulating = !params.clearCanvas
    if (accumulating !== recording) {
        recording = accumulating
        canvas.classList.toggle("recording", recording)
    }

    if (params.animate) {
        if (params.clearCanvas) density.clear()

        for (let p of particles) {
            density.add(p.x, p.y)
        }

        density.render(imageData, {
            exposure: params.exposure,
            gamma: params.gamma,
            adaptation: params.adaptation,
            background: rgb(params.backgroundColor),
            foreground: rgb(params.foregroundColor)
        })
        ctx.putImageData(imageData, 0, 0)
    }

    if (params.showFocalPoints) {
        // Crosses stay the same size on screen whatever the canvas resolution.
        ctx.strokeStyle = params.foregroundColor
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

// The margin is the same on every side: tolerance canvases beyond each edge,
// so 0 recycles a particle as soon as it leaves the visible area.
const particleCorrection = (particle, random) => {
    let change = false;
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

// The file comes from the user, so everything here can fail: Preset.apply
// validates the contents, and the status line reports whatever went wrong.
const loadPreset = async (file) => {
    let preset
    try {
        preset = Preset.apply(JSON.parse(await file.text()), params, nEllipse)
    } catch (error) {
        panel.setPresetStatus(`Could not load ${file.name}: ${error.message}`, true)
        return
    }

    // The preset carries its own aspect and resolution, and coordinates that
    // belong to the canvas it was made on — so resize first, then scale the
    // figure in, exactly as a resolution change does.
    resizeCanvas()
    if (preset.width && preset.height) rescaleFocalPoints(preset.width, preset.height)
    applyDefaultWeight()
    panel.syncFocalPoints()
    panel.sync()
    applySeed(preset.seed || random.seed)
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

    panel = new Panel(params, nEllipse, {
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
        clearImage: () => density.clear()
    })
    panel.setSeed(random.seed)
    panel.setCanvasSize(width, height)
    location.hash = encodeURIComponent(random.seed)

    // The panel changed the stage width, so the canvas may need a second pass.
    if (resizeCanvas()) {
        applyDefaultWeight()
        panel.sync()
    }

    addFocalPoint(Math.round(width/2), Math.round(height/2))
    spawnParticles()

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
    })

    window.addEventListener("mouseup", () => {
        dragging = -1
    })

    document.body.addEventListener("keydown", (event) => {
        // The panel's own inputs keep their keys.
        if (event.target.closest(".panel")) return

        switch (event.key) {
            case " ":
                params.animate = !params.animate
                break
            case "c":
                params.clearCanvas = !params.clearCanvas
                break
            case "s":
                params.showFocalPoints = !params.showFocalPoints
                break
            case "+":
                {
                    const point = toCanvas(mf.x, mf.y)
                    addFocalPoint(point.x, point.y)
                }
                break
            case "-":
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
    })

    window.requestAnimationFrame(update)

    onresize = () => {
        if (resizeCanvas()) spawnParticles()
    }
}
