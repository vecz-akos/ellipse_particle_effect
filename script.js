const canvas = document.querySelector('canvas'),
    ctx = canvas.getContext("2d")

let width = canvas.width = window.innerWidth,
    height = canvas.height = window.innerHeight,
    frame = 0,
    animate = true,
    clearCanvas = true;

class Particle{
    constructor(x=0, y=0) {
        this.x = x
        this.y = y
    }

    update(circle) {
        //const d = Math.min(this.distance(circle)/Math.log10(this.distance(circle)+1) + this.distance({x:0, y:0, r:300})/Math.log10(this.distance(circle)+1))
        //const d = Math.min(this.distance(circle)/8, this.distance({x:100, y:100, r:350})/8)
        //const d = this.distance(circle)/8
        const x = this.distance(circle)
        const d = Math.sqrt(x+8)*3-7
        const angle = Math.random()*Math.PI*2
        this.x += d * Math.cos(angle)
        this.y += d * Math.sin(angle)
    }

    distance(obj) {
        return Math.abs(Math.sqrt(this.dummyDistance(obj)) - obj.r)
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
    r: Math.round(Math.min(width, height)*(1/3))
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
    if (animate) {
        for (let p of particles) {
            p.update(circle)
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
