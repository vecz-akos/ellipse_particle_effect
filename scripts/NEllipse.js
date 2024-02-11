import Point from "./Point.js"

export default class NEllipse {
    constructor(d=0) {
        this.focalPoints = []
        this.d = d // expected sum of distances from focal points
    }

    get numberOfFocalPoints() {
        return this.focalPoints.length
    }

    addFocalPoint(point) {
        if (point instanceof Point)
            this.focalPoints.push(point)
    }

    removeFocalPoint(index=0) {
        if (this.numberOfFocalPoints > index && index >= 0)
            this.focalPoints.splice(index, 1)
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