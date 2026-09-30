import Point from "./Point.js"

export default class Particle extends Point {
    constructor(x=0, y=0) {
        super(x, y)
    }

    // Hot path: called once per particle per frame, so no argument checking here.
    // step holds the hand-tuned curve constants — see AGENTS.md before changing
    // their defaults in Params.
    update(nEllipse, random, step) {
        const x = nEllipse.calcDistance(this)
        const d = Math.sqrt(x + step.offset)*step.scale - step.bias
        const angle = random.angle()
        this.x += d * Math.cos(angle)
        this.y += d * Math.sin(angle)
    }
}
