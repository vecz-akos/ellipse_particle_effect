import NEllipse from "./NEllipse.js";
import Particle from "./Particle.js";
import FocalPoint from "./FocalPoint.js";
import MouseFollower from "./MouseFollower.js";
import DensityBuffer from "./DensityBuffer.js";
import Random from "./Random.js";
import Params from "./Params.js";
import Panel from "./Panel.js";

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
    dragging = -1

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

const addFocalPoint = (x, y, weight=null) => {
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

const savePng = () => {
    canvas.toBlob((blob) => {
        const link = document.createElement("a")
        link.href = URL.createObjectURL(blob)
        link.download = `n-ellipse-${random.seed}-${width}x${height}.png`
        link.click()
        setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
    })
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

    // The default target sum is a third of the shorter canvas side.
    nEllipse.unit_d = Math.round(Math.min(width, height)/3)
    nEllipse.baseD = nEllipse.unit_d
    nEllipse.recalculateD()

    panel = new Panel(params, nEllipse, {
        canvasChanged: () => {
            if (resizeCanvas()) {
                density.clear()
                spawnParticles()
            }
        },
        countChanged: () => spawnParticles(),
        addFocalPoint: () => addFocalPoint(Math.round(width/2), Math.round(height/2)),
        removeFocalPoint: (index) => removeFocalPoint(index),
        seedChanged: (seed) => applySeed(seed),
        seedRolled: () => applySeed(Random.randomSeed()),
        savePng,
        clearImage: () => density.clear()
    })
    panel.setSeed(random.seed)
    panel.setCanvasSize(width, height)
    location.hash = encodeURIComponent(random.seed)

    // The panel changed the stage width, so the canvas may need a second pass.
    if (resizeCanvas()) {
        nEllipse.unit_d = Math.round(Math.min(width, height)/3)
        nEllipse.baseD = nEllipse.unit_d
        nEllipse.recalculateD()
    }

    addFocalPoint(Math.round(width/2), Math.round(height/2), 0)
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
