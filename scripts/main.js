import NEllipse from "./NEllipse.js";
import Particle from "./Particle.js";
import Point from "./Point.js";
import MouseFollower from "./MouseFollower.js";

const canvas = document.querySelector('canvas'),
    ctx = canvas.getContext("2d")

let width = canvas.width = window.innerWidth,
    height = canvas.height = window.innerHeight,
    frame = 0,
    animate = true,
    clearCanvas = true,
    showFocalPoints = false,
    followFocalPoint = false;

const nEllipse = new NEllipse(Math.round(Math.min(width, height)*(1/3)))
nEllipse.addFocalPoint(new Point(Math.round(width/2), Math.round(height/2)), 0)

const mf = new MouseFollower()

let particles = []

const init = () => {
    width = canvas.width = window.innerWidth
    height = canvas.height = window.innerHeight

    particles = []
    for (let i = 0; i < 10_000; i++) {
        particles.push(new Particle(Math.random()*width, Math.random()*height))
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
            p.update(nEllipse)
            correctionCounter += particleCorrection(p)
        }
    }
    //console.log(correctionCounter)
    draw()
    frame = window.requestAnimationFrame(update)
}

const draw = () => {
    if (clearCanvas) {
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, width, height)
    }

    ctx.fillStyle = "#00000055"

    particles.forEach((p) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, .5, 0, Math.PI*2, true)
        ctx.fill()
    })

    if (showFocalPoints) {
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
        particle.x = Math.random()*width
    }
    if (particle.y > tolerance*height || particle.x < -tolerance*height) {
        change = true
        particle.y = Math.random()*height
    }
    return change
}

window.onload = () => {
    init()
    
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
            default:
                break
        }
    })

    window.requestAnimationFrame(update)
}

onresize = (e) => {
    window.cancelAnimationFrame(frame)
    init()
    window.requestAnimationFrame(update)
}
