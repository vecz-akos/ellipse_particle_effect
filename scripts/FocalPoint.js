import Point from "./Point.js"

// A focal point that carries its own contribution to the n-ellipse target sum,
// so a single point's weight can be edited after it was added.
export default class FocalPoint extends Point {
    constructor(x=0, y=0, weight=0) {
        super(x, y)
        this.weight = weight
    }
}
