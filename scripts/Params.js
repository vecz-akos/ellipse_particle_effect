// Every tunable in one place. The panel and the keyboard handler write it, the
// loop reads it — see "One parameters object" in docs/decisions.md.
export default class Params {
    constructor() {
        // canvas
        this.aspect = "window"      // "window", or "w:h"
        this.resolution = "fit"     // "fit", or a height in pixels

        // simulation
        this.particleCount = 20_000
        this.tolerance = 1
        this.step = { offset: 128, scale: 8, bias: 90 }

        // focal points: by default sharedWeight sizes every point at once; with
        // manualWeight on, each point carries its own and a new one takes
        // NEllipse.unit_d. main.js seeds sharedWeight from unit_d.
        this.manualWeight = false
        this.sharedWeight = 0

        // tone map
        this.exposure = .9
        this.gamma = .5
        this.adaptation = .1
        this.backgroundColor = "#ffffff"
        this.foregroundColor = "#000000"

        // toggles
        this.animate = true
        this.clearCanvas = true
        this.showFocalPoints = false
        this.followFocalPoint = false
    }

    static get aspects() {
        return [
            { value: "window", label: "Fit window" },
            { value: "16:9", label: "16:9" },
            { value: "3:2", label: "3:2" },
            { value: "4:3", label: "4:3" },
            { value: "1:1", label: "1:1" },
            { value: "2:3", label: "2:3" },
            { value: "9:16", label: "9:16" }
        ]
    }

    static get resolutions() {
        return [
            { value: "fit", label: "Fit area" },
            { value: 720, label: "720p" },
            { value: 1080, label: "1080p" },
            { value: 1440, label: "1440p" },
            { value: 2160, label: "4K" }
        ]
    }

    ratio(freeWidth, freeHeight) {
        if (this.aspect === "window") return freeWidth/freeHeight
        const [w, h] = this.aspect.split(":").map(Number)
        return w/h
    }

    // The canvas' own pixel size. CSS scales it into whatever space is left
    // next to the panel, so this is a render setting, not a layout one.
    canvasSize(freeWidth, freeHeight) {
        const ratio = this.ratio(freeWidth, freeHeight)

        if (this.resolution === "fit") {
            let width = freeWidth,
                height = Math.round(width/ratio)
            if (height > freeHeight) {
                height = freeHeight
                width = Math.round(height*ratio)
            }
            return { width: Math.max(1, Math.round(width)), height: Math.max(1, height) }
        }

        const height = Number(this.resolution)
        return { width: Math.max(1, Math.round(height*ratio)), height }
    }
}
