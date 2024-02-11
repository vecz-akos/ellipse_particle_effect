export default class Point {
    constructor(x=0, y=0) {
        this.x = x
        this.y = y
    }

    distance(obj) {
        return Math.abs(Math.sqrt(this.dummyDistance(obj)))
    }

    dummyDistance(obj=new Particle()) {
		const dx = this.x - obj.x;
		const dy = this.y - obj.y;
		return dx * dx + dy * dy;
    }
}
