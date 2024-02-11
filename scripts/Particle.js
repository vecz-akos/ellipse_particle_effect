import NEllipse from "./NEllipse.js"
import Point from "./Point.js"

export default class Particle extends Point {
    constructor(x=0, y=0) {
        super(x, y)
    }

    update(nEllipse) {
        if (nEllipse instanceof NEllipse) {
            const x = nEllipse.calcDistance(this)
            //const d = Math.min(this.distance(circle)/Math.log10(this.distance(circle)+1) + this.distance({x:0, y:0, r:300})/Math.log10(this.distance(circle)+1))
            //const d = Math.min(this.distance(circle)/8, this.distance({x:100, y:100, r:350})/8)
            //const d = this.distance(circle)/8
            const d = Math.sqrt(x+8)*3-7
            const angle = Math.random()*Math.PI*2
            this.x += d * Math.cos(angle)
            this.y += d * Math.sin(angle)
        }
    }
}
