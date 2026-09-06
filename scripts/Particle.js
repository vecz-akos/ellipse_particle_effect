import Point from "./Point.js"

export default class Particle extends Point {
    constructor(x=0, y=0) {
        super(x, y)
    }

    // Hot path: called once per particle per frame, so no argument checking here.
    update(nEllipse, random) {
        const x = nEllipse.calcDistance(this)
        const d = Math.sqrt(x+128)*8-90
        const angle = random.angle()
        this.x += d * Math.cos(angle)
        this.y += d * Math.sin(angle)
    }
}
