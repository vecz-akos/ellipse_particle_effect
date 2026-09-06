import Point from "./Point.js"
import FocalPoint from "./FocalPoint.js"

export default class NEllipse {
    constructor(d=0) {
        this.focalPoints = []
        this.unit_d = d
        this.baseD = d
        this.d = d // expected sum of distances from focal points
    }

    get numberOfFocalPoints() {
        return this.focalPoints.length
    }

    addFocalPoint(point, d=null) {
        if (point instanceof Point) {
            const weight = d === null ? this.unit_d : d
            this.focalPoints.unshift(
                point instanceof FocalPoint
                    ? Object.assign(point, { weight })
                    : new FocalPoint(point.x, point.y, weight)
            )
        }
        this.recalculateD()
    }

    removeFocalPoint(index=0) {
        if (this.numberOfFocalPoints > index && index >= 0 && this.numberOfFocalPoints > 0) {
            this.focalPoints.splice(index, 1)
            this.recalculateD()
        }
    }

    setWeight(index, weight) {
        const point = this.focalPoints[index]
        if (point) {
            point.weight = weight
            this.recalculateD()
        }
    }

    // d is the sum of the per-point weights, so editing one weight is enough.
    recalculateD() {
        this.d = this.focalPoints.reduce((sum, focal) => sum + focal.weight, this.baseD)
    }

    calcDistance(point) {
        if (this.numberOfFocalPoints > 0)
            return Math.abs(this.focalPoints.reduce((sum, focal) => {
                return sum + focal.distance(point)
            }, 0) - this.d)
        return 0
    }
}
