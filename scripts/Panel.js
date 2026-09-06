import Params from "./Params.js"

const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
}

// Writing an input that already holds the value is still a DOM write, and these
// run every frame while a focal point is being dragged or followed.
const setNumber = (input, value) => {
    const text = String(Math.round(value))
    if (input.value !== text) input.value = text
}

const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text
}

const TABS = [
    { id: "parameters", label: "Parameters" },
    { id: "render", label: "Render" },
    { id: "playback", label: "Playback" }
]

// The control panel. Owns no state of its own: every control reads and writes
// the Params instance, and hands the app a hint about what has to be rebuilt.
export default class Panel {
    constructor(params, nEllipse, handlers={}) {
        this.params = params
        this.nEllipse = nEllipse
        this.handlers = handlers
        this.controls = []
        this.focalRows = []

        this.root = el("aside", "panel")
        this.buildTabs()
        this.buildParameters()
        this.buildRender()
        this.buildPlayback()
        this.buildModes()
        this.showTab("parameters")
        document.body.appendChild(this.root)
        // Not sync(): that calls back into the handlers, and the caller has not
        // finished constructing us yet. The build already set every value, the
        // slider's range comes from weightRange, and syncFocalPoints locked the
        // weight editors.
    }

    buildTabs() {
        const nav = el("nav", "tabs")
        this.tabButtons = {}
        this.tabBodies = {}
        for (const tab of TABS) {
            const button = el("button", "tab", tab.label)
            button.addEventListener("click", () => this.showTab(tab.id))
            nav.appendChild(button)
            this.tabButtons[tab.id] = button

            const body = el("div", "tab-body")
            body.hidden = true
            this.tabBodies[tab.id] = body
        }
        this.root.appendChild(nav)
        for (const tab of TABS) this.root.appendChild(this.tabBodies[tab.id])
    }

    showTab(id) {
        for (const tab of TABS) {
            this.tabButtons[tab.id].classList.toggle("active", tab.id === id)
            this.tabBodies[tab.id].hidden = tab.id !== id
        }
    }

    section(parent, title) {
        const section = el("section", "section")
        section.appendChild(el("h2", null, title))
        parent.appendChild(section)
        return section
    }

    row(parent, label, input, valueNode) {
        const row = el("label", "row")
        row.appendChild(el("span", "label", label))
        if (valueNode) row.appendChild(valueNode)
        row.appendChild(input)
        parent.appendChild(row)
        return row
    }

    // read/write are closures over the parameter, so nested ones (step.scale)
    // need no key-path machinery.
    // commit: run the change callback on release instead of on every pixel of
    // the drag — for the ones that reallocate (particle count).
    slider(parent, label, { read, write, min, max, step=1, format=(v) => v, change, commit=false }) {
        const input = el("input")
        input.type = "range"
        input.min = min
        input.max = max
        input.step = step
        const value = el("span", "value")

        const sync = () => {
            input.value = read()
            value.textContent = format(read())
        }
        input.addEventListener("input", () => {
            write(Number(input.value))
            value.textContent = format(read())
            if (change && !commit) change()
        })
        if (change && commit) input.addEventListener("change", () => change())

        this.row(parent, label, input, value)
        this.controls.push(sync)
        sync()
        return input
    }

    select(parent, label, { read, write, options, change }) {
        const input = el("select")
        for (const option of options) {
            const node = el("option", null, option.label)
            node.value = String(option.value)
            input.appendChild(node)
        }
        const sync = () => { input.value = String(read()) }
        input.addEventListener("change", () => {
            const raw = input.value
            const option = options.find(o => String(o.value) === raw)
            write(option ? option.value : raw)
            if (change) change()
        })

        this.row(parent, label, input)
        this.controls.push(sync)
        sync()
        return input
    }

    colour(parent, label, { read, write, change }) {
        const input = el("input")
        input.type = "color"
        const sync = () => { input.value = read() }
        input.addEventListener("input", () => {
            write(input.value)
            if (change) change()
        })

        this.row(parent, label, input)
        this.controls.push(sync)
        sync()
        return input
    }

    toggle(parent, label, { read, write, change, hint, compact=false }) {
        const input = el("input")
        input.type = "checkbox"
        const sync = () => { input.checked = read() }
        input.addEventListener("change", () => {
            write(input.checked)
            if (change) change()
        })

        if (compact) {
            const row = el("label", "mode")
            if (hint) row.title = hint
            row.append(input, el("span", null, label))
            parent.appendChild(row)
        } else {
            const row = this.row(parent, label, input)
            if (hint) row.title = hint
        }

        this.controls.push(sync)
        sync()
        return input
    }

    buildParameters() {
        const body = this.tabBodies.parameters,
            params = this.params,
            { canvasChanged, countChanged } = this.handlers

        const canvas = this.section(body, "Canvas")
        this.select(canvas, "Aspect", {
            read: () => params.aspect,
            write: (v) => params.aspect = v,
            options: Params.aspects,
            change: canvasChanged
        })
        this.select(canvas, "Resolution", {
            read: () => params.resolution,
            write: (v) => params.resolution = v,
            options: Params.resolutions,
            change: canvasChanged
        })
        this.sizeReadout = el("p", "readout")
        canvas.appendChild(this.sizeReadout)

        const simulation = this.section(body, "Simulation")
        this.slider(simulation, "Particles", {
            read: () => params.particleCount,
            write: (v) => params.particleCount = v,
            min: 1000, max: 100_000, step: 1000,
            format: (v) => `${Math.round(v/1000)}k`,
            change: countChanged,
            commit: true
        })
        this.slider(simulation, "Recycle at", {
            read: () => params.tolerance,
            write: (v) => params.tolerance = v,
            min: 0, max: 4, step: .5,
            format: (v) => v === 0 ? "canvas edge" : `+${v} canvases`
        })

        const focal = this.section(body, "Focal points")
        const { weightChanged } = this.handlers
        this.toggle(focal, "Manual", {
            read: () => params.manualWeight,
            write: (v) => params.manualWeight = v,
            change: weightChanged,
            hint: "Off: one slider sizes every point. On: each point carries its own weight."
        })
        const range = this.weightRange()
        this.sharedWeightInput = this.slider(focal, "Weight", {
            read: () => params.sharedWeight,
            write: (v) => params.sharedWeight = v,
            min: range.min, max: range.max, step: 1,
            change: weightChanged
        })
        focal.appendChild(el("p", "hint", "Drag a point on the canvas to move it."))
        this.focalList = el("div", "focal-list")
        focal.appendChild(this.focalList)
        const add = el("button", "wide", "Add focal point")
        add.addEventListener("click", () => {
            if (this.handlers.addFocalPoint) this.handlers.addFocalPoint()
        })
        focal.appendChild(add)
        // d is now exactly the sum of the weights; showing it makes the slider's
        // effect legible with several points on the canvas.
        this.targetSumReadout = el("p", "readout")
        focal.appendChild(this.targetSumReadout)
        this.syncFocalPoints()

        const tone = this.section(body, "Tone map")
        this.slider(tone, "Exposure", {
            read: () => params.exposure,
            write: (v) => params.exposure = v,
            min: .05, max: 4, step: .05,
            format: (v) => v.toFixed(2)
        })
        this.slider(tone, "Gamma", {
            read: () => params.gamma,
            write: (v) => params.gamma = v,
            min: .1, max: 4, step: .05,
            format: (v) => v.toFixed(2)
        })
        this.slider(tone, "Adaptation", {
            read: () => params.adaptation,
            write: (v) => params.adaptation = v,
            min: .01, max: 1, step: .01,
            format: (v) => v.toFixed(2)
        })
        this.colour(tone, "Background", {
            read: () => params.backgroundColor,
            write: (v) => params.backgroundColor = v
        })
        this.colour(tone, "Foreground", {
            read: () => params.foregroundColor,
            write: (v) => params.foregroundColor = v
        })

        // Advanced, and rarely touched once the look is set — so it sits last.
        const curve = this.section(body, "Step curve")
        curve.appendChild(el("p", "hint", "step = sqrt(error + offset) * scale - bias"))
        this.slider(curve, "Offset", {
            read: () => params.step.offset,
            write: (v) => params.step.offset = v,
            min: 0, max: 1024, step: 1
        })
        this.slider(curve, "Scale", {
            read: () => params.step.scale,
            write: (v) => params.step.scale = v,
            min: .5, max: 32, step: .5
        })
        this.slider(curve, "Bias", {
            read: () => params.step.bias,
            write: (v) => params.step.bias = v,
            min: 0, max: 300, step: 1
        })
    }

    // The modes live in a footer, outside the tabs: they are the things a
    // keyboard shortcut flips, so they stay visible whichever tab is open.
    buildModes() {
        const params = this.params
        const footer = el("div", "panel-footer")
        footer.appendChild(el("h2", null, "Modes"))

        const grid = el("div", "modes")
        this.toggle(grid, "Animate", {
            read: () => params.animate,
            write: (v) => params.animate = v,
            hint: "Pause or resume the simulation (space)",
            compact: true
        })
        this.toggle(grid, "Clear (c)", {
            read: () => params.clearCanvas,
            write: (v) => params.clearCanvas = v,
            hint: "Clear the buffer each frame; off means the image accumulates (c)",
            compact: true
        })
        this.toggle(grid, "Foci (s)", {
            read: () => params.showFocalPoints,
            write: (v) => params.showFocalPoints = v,
            hint: "Show a cross at each focal point (s)",
            compact: true
        })
        this.toggle(grid, "Follow (f)", {
            read: () => params.followFocalPoint,
            write: (v) => params.followFocalPoint = v,
            hint: "The newest focal point follows the mouse (f)",
            compact: true
        })

        footer.appendChild(grid)
        this.root.appendChild(footer)
    }

    buildRender() {
        const body = this.tabBodies.render

        const seed = this.section(body, "Seed")
        const field = el("div", "field")
        this.seedInput = el("input", "seed")
        this.seedInput.type = "text"
        this.seedInput.spellcheck = false
        const apply = el("button", null, "Apply")
        apply.addEventListener("click", () => {
            if (this.handlers.seedChanged) this.handlers.seedChanged(this.seedInput.value.trim())
        })
        const roll = el("button", null, "Roll (r)")
        roll.addEventListener("click", () => {
            if (this.handlers.seedRolled) this.handlers.seedRolled()
        })
        field.append(this.seedInput, apply, roll)
        seed.appendChild(field)
        seed.appendChild(el("p", "hint", "The seed is also in the URL hash — copy the link to keep an image."))

        const output = this.section(body, "Output")
        const save = el("button", "wide", "Save PNG")
        save.addEventListener("click", () => {
            if (this.handlers.savePng) this.handlers.savePng()
        })
        output.appendChild(save)
        output.appendChild(el("p", "hint", "Saved at the canvas resolution set on the Parameters tab. Presets and re-render at size are not built yet."))

        const restart = this.section(body, "Restart")
        const reset = el("button", "wide", "Clear image")
        reset.addEventListener("click", () => {
            if (this.handlers.clearImage) this.handlers.clearImage()
        })
        restart.appendChild(reset)
    }

    buildPlayback() {
        const body = this.tabBodies.playback
        const section = this.section(body, "Playback")
        section.appendChild(el("p", "hint", "Focal-point paths and timelapse export are Phase 5 — see docs/roadmap.md."))
    }

    // Rebuilds the focal-point rows. Called when a point is added or removed;
    // dragging only writes the numbers back through refreshFocalValues.
    syncFocalPoints() {
        this.focalList.textContent = ""
        this.focalRows = []

        this.nEllipse.focalPoints.forEach((point, index) => {
            const row = el("div", "focal-row")
            const inputs = {}
            for (const key of ["x", "y", "weight"]) {
                const field = el("label", "focal-field")
                field.appendChild(el("span", null, key === "weight" ? "w" : key))
                const input = el("input")
                input.type = "number"
                input.step = key === "weight" ? 10 : 1
                input.value = Math.round(point[key])
                if (key === "weight") input.disabled = !this.params.manualWeight
                input.addEventListener("input", () => {
                    const value = Number(input.value)
                    if (Number.isNaN(value)) return
                    if (key === "weight") this.nEllipse.setWeight(index, value)
                    else point[key] = value
                })
                field.appendChild(input)
                row.appendChild(field)
                inputs[key] = input
            }
            const remove = el("button", "remove", "×")
            remove.title = "Remove this focal point"
            remove.addEventListener("click", () => {
                if (this.handlers.removeFocalPoint) this.handlers.removeFocalPoint(index)
            })
            row.appendChild(remove)
            this.focalList.appendChild(row)
            this.focalRows.push(inputs)
        })

        if (this.nEllipse.numberOfFocalPoints === 0) {
            this.focalList.appendChild(el("p", "hint", "No focal points — the particles wander freely."))
        }
        this.syncWeightControls()
    }

    // The shared weight and the per-row w fields are two views of one number, so
    // exactly one of them is editable at a time.
    syncWeightControls() {
        const shared = !this.params.manualWeight
        this.sharedWeightInput.disabled = !shared
        for (const inputs of this.focalRows) inputs.weight.disabled = shared
        this.refreshFocalValues()
    }

    // Derived, never stored: an eighth of the shorter canvas side up to one and
    // a half times it, and unit_d is a third of that side — hence 3/8 and 4.5.
    weightRange() {
        const unit = this.nEllipse.unit_d
        return {
            min: Math.max(1, Math.round(unit*3/8)),
            max: Math.max(2, Math.round(unit*4.5))
        }
    }

    refreshFocalValues() {
        this.nEllipse.focalPoints.forEach((point, index) => {
            const inputs = this.focalRows[index]
            if (!inputs) return
            setNumber(inputs.x, point.x)
            setNumber(inputs.y, point.y)
            setNumber(inputs.weight, point.weight)
        })
        setText(this.targetSumReadout, `Target sum d = ${Math.round(this.nEllipse.d)} px`)
    }

    setSeed(seed) {
        this.seedInput.value = seed
    }

    setCanvasSize(width, height) {
        setText(this.sizeReadout, `${width} × ${height} px`)
    }

    // Rereads everything from Params: values, the weight slider's range, and
    // which of the two weight editors is live. Whatever writes Params from
    // outside — the keyboard today, presets later — only has to call this.
    sync() {
        const { min, max } = this.weightRange()
        this.sharedWeightInput.min = min
        this.sharedWeightInput.max = max

        // A range input clamps what it shows and nothing else, so an
        // out-of-range value would leave the panel and the simulation quietly
        // disagreeing. Clamp Params itself instead.
        this.params.sharedWeight =
            Math.min(max, Math.max(min, Math.round(this.params.sharedWeight)))

        // Each point holds its own copy of the weight, so a sharedWeight written
        // from outside reaches the figure only by being applied again.
        if (this.handlers.weightChanged) this.handlers.weightChanged()

        for (const control of this.controls) control()
        this.syncWeightControls()
    }
}
