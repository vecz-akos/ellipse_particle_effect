export default class MouseFollower {
    constructor(domElement=document, start=false) {
        this.x = 0
        this.y = 0
        this.domElement = domElement
        if (start) this.addMouseMoveEventListener()
    }

    addMouseMoveEventListener() {
        this.domElement.addEventListener("mousemove", (e) => this.update(e))
    }

    removeMouseMoveEventListener() {
        this.domElement.removeEventListener("mousemove", (e) => this.update(e))
    }

    changeMouseMoveEventListener(domElement) {
        this.removeMouseMoveEventListener()
        this.domElement = domElement
        this.addMouseMoveEventListener()
    }

    update(e) {
        this.x = Number(e.x)
        this.y = Number(e.y)
    }
}