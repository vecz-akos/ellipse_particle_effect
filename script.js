const canvas = document.querySelector('canvas'),
    ctx = canvas.getContext("2d")

let width = canvas.width = window.innerWidth,
    height = canvas.height = window.innerHeight,
    frame = 0

class Particle{
    constructor(x=0, y=0) {
        this.x = x
        this.y = y
    }

    update(circle) {
        const d = this.distance(circle)/3
        const angle = Math.random()*Math.PI*2
        debugger
        this.x += d * Math.cos(angle)
        this.y += d * Math.sin(angle)
    }

    distance(obj=new Particle()) {
        return Math.sqrt(this.dummyDistance(obj))
    }

    dummyDistance(obj=new Particle()) {
		const dx = this.x - obj.x;
		const dy = this.y - obj.y;
		return dx * dx + dy * dy;
    }
}

let circle = {
    x: Math.round(width/2),
    y: Math.round(height/2),
    r: Math.round(Math.min(width, height)*(2/3))
}

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
    for (let p of particles) {
        p.update(circle)
    }

    draw()
    frame = window.requestAnimationFrame(update)
}

const draw = () => {
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = "#00000044"

    particles.forEach((p) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, .5, 0, Math.PI*2, true)
        ctx.fill()
    })
}

window.onload = () => {
    init()
    window.requestAnimationFrame(update)
}

onresize = (e) => {
    window.cancelAnimationFrame(frame)
    init()
    window.requestAnimationFrame(update)
}
