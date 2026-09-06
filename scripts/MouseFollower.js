export default class MouseFollower {
    constructor(domElement=document, start=false) {
        this.x = 0
        this.y = 0
        this.domElement = domElement
        // Stored so remove/add can pass the identical reference to removeEventListener.
        this.handler = (e) => this.update(e)
        if (start) this.addMouseMoveEventListener()
    }

    addMouseMoveEventListener() {
        this.domElement.addEventListener("mousemove", this.handler)
    }

    removeMouseMoveEventListener() {
        this.domElement.removeEventListener("mousemove", this.handler)
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