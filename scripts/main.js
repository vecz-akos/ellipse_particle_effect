import NEllipse from "./NEllipse.js";
import Particle from "./Particle.js";
import Point from "./Point.js";
import MouseFollower from "./MouseFollower.js";
import DensityBuffer from "./DensityBuffer.js";
import Random from "./Random.js";

const canvas = document.querySelector('canvas'),
    ctx = canvas.getContext("2d")

let width = canvas.width = window.innerWidth,
    height = canvas.height = window.innerHeight,
    backgroundColor = "#ffffff",
    foregroundColor = "#000000",
    exposure = .9,
    gamma = .5,
    frame = 0,
    animate = true,
    clearCanvas = true,
    showFocalPoints = false,
    followFocalPoint = false;

const density = new DensityBuffer(width, height)
let imageData = ctx.createImageData(width, height)

// The seed lives in the URL hash, so a run can be linked and replayed.
const random = new Random(decodeURIComponent(location.hash.slice(1)) || Random.randomSeed())

const applySeed = (seed) => {
    random.seed = String(seed)
    location.hash = encodeURIComponent(random.seed)
    console.info(`seed: ${random.seed}`)
    density.clear()
    init()
}

const rgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
]

const nEllipse = new NEllipse(Math.round(Math.min(width, height)*(1/3)))
nEllipse.addFocalPoint(new Point(Math.round(width/2), Math.round(height/2)), 0)

const mf = new MouseFollower()

let particles = []

const init = () => {
    width = canvas.width = window.innerWidth
    height = canvas.height = window.innerHeight

    density.resize(width, height)
    imageData = ctx.createImageData(width, height)

    random.reset()

    particles = []
    for (let i = 0; i < 20_000; i++) {
        particles.push(new Particle(random.between(0, width), random.between(0, height)))
    }
}

const update = () => {
    if (followFocalPoint) {
        if (nEllipse.numberOfFocalPoints > 0) {
            nEllipse.focalPoints[0].x = mf.x
            nEllipse.focalPoints[0].y = mf.y
        }
    }
    let correctionCounter = 0
    if (animate) {
        for (let p of particles) {
            p.update(nEllipse, random)
            correctionCounter += particleCorrection(p)
        }
    }
    draw()
    frame = window.requestAnimationFrame(update)
}

const draw = () => {
    if (animate) {
        if (clearCanvas) density.clear()

        for (let p of particles) {
            density.add(p.x, p.y)
        }

        density.render(imageData, {
            exposure,
            gamma,
            background: rgb(backgroundColor),
            foreground: rgb(foregroundColor)
        })
        ctx.putImageData(imageData, 0, 0)
    }

    if (showFocalPoints) {
        ctx.strokeStyle = foregroundColor
        const crossSize = 5
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

const addFocalPoint = (x, y) => {
    nEllipse.addFocalPoint(
        new Point(x, y)
    )
}

const particleCorrection = (particle) => {
    let change = false;
    const tolerance = 3
    if (particle.x > tolerance*width || particle.x < -tolerance*width) {
        change = true
        particle.x = random.between(0, width)
    }
    if (particle.y > tolerance*height || particle.y < -tolerance*height) {
        change = true
        particle.y = random.between(0, height)
    }
    return change
}

window.onload = () => {
    applySeed(random.seed)

    mf.addMouseMoveEventListener()

    document.body.addEventListener("keydown", (event) => {
        switch (event.key) {
            case " ":
                animate = !animate
                break
            case "c":
                clearCanvas = !clearCanvas
                break
            case "s":
                showFocalPoints = !showFocalPoints
                break
            case "+":
                addFocalPoint(mf.x, mf.y)
                break
            case "-":
                nEllipse.removeFocalPoint()
                break
            case "f":
                followFocalPoint = !followFocalPoint
                break
            case "r":
                applySeed(Random.randomSeed())
                break
            default:
                break
        }
    })

    window.requestAnimationFrame(update)

    onresize = (e) => {
        window.cancelAnimationFrame(frame)
        init()
        window.requestAnimationFrame(update)
    }
}
