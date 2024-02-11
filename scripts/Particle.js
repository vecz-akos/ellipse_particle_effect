import NEllipse from "./NEllipse.js"
import Point from "./Point.js"

export default class Particle extends Point {
    constructor(x=0, y=0) {
        super(x, y)
    }

    update(nEllipse) {
        if (nEllipse instanceof NEllipse) {
            const x = nEllipse.calcDistance(this)
            const d = Math.sqrt(x+8)*3-7
            const angle = Math.random()*Math.PI*2
            this.x += d * Math.cos(angle)
            this.y += d * Math.sin(angle)
        }
    }
}
