import NEllipse from "./NEllipse.js";
import Particle from "./Particle.js";
import Point from "./Point.js";

const canvas = document.querySelector('canvas'),
    ctx = canvas.getContext("2d")

let width = canvas.width = window.innerWidth,
    height = canvas.height = window.innerHeight,
    frame = 0,
    animate = true,
    clearCanvas = true;

let circle = {
    x: Math.round(width/2),
    y: Math.round(height/2),
    r: Math.round(Math.min(width, height)*(1/3))
}

const nEllipse = new NEllipse(Math.round(Math.min(width, height)*(1/3)))
nEllipse.addFocalPoint(new Point(Math.round(width/2), Math.round(height/2)))

let particles = []

const init = () => {
    width = canvas.width = window.innerWidth
    height = canvas.height = window.innerHeight

    particles = []
    for (let i = 0; i < 8_000; i++) {
        particles.push(new Particle(Math.random()*width, Math.random()*height))
    }
}

const update = () => {
    if (animate) {
        for (let p of particles) {
            p.update(nEllipse)
        }
    }
    draw()
    frame = window.requestAnimationFrame(update)
}

const draw = () => {
    if (clearCanvas) {
        ctx.fillStyle = "#fff"
        ctx.fillRect(0, 0, width, height)
    }

    ctx.fillStyle = "#00000088"

    particles.forEach((p) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, .5, 0, Math.PI*2, true)
        ctx.fill()
    })
}

window.onload = () => {
    init()

    document.body.addEventListener("keydown", (event) => {
        switch (event.key) {
            case " ":
                animate = !animate
                break
            case "c":
                clearCanvas = !clearCanvas
                break
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
