import Point from "./Point.js"

export default class NEllipse {
    constructor(d=0) {
        this.focalPoints = []
        this.unit_d = d
        this.d = d // expected sum of distances from focal points
    }

    get numberOfFocalPoints() {
        return this.focalPoints.length
    }

    addFocalPoint(point, d=null) {
        if (point instanceof Point)
            this.focalPoints.unshift(point)
        if (d === null)
            this.d += this.unit_d
        else
            this.d += d
    }

    removeFocalPoint(index=0, d=null) {
        if (this.numberOfFocalPoints > index && index >= 0)
            this.focalPoints.splice(index, 1)
        if (d === null)
            this.d -= this.unit_d
        else
            this.d -= d
    }

    calcDistance(point) {
        if (this.numberOfFocalPoints > 0)
            return Math.abs(this.focalPoints.reduce((sum, focal) => {
                return sum += focal.distance(point)
            }, 0) - this.d)
        // else empty
        return 0
    }
}