import Params from "./Params.js"
import Gradient from "./Gradient.js"

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

// Slider labels for the fractional settings.
const fixed = (places) => (value) => value.toFixed(places)

// Parameters shapes the simulation, Look turns density into a picture — the
// usual workflow is to draw an image first and grade it afterwards, so Look
// comes right after Parameters. See Phase 4 in docs/roadmap.md.
const TABS = [
    { id: "parameters", label: "Parameters" },
    { id: "look", label: "Look" },
    { id: "render", label: "Render" },
    { id: "playback", label: "Playback" }
]

// The control panel. Owns no state of its own: every control reads and writes
// the Params instance, and hands the app a hint about what has to be rebuilt.
export default class Panel {
    constructor(params, nEllipse, animation, handlers={}) {
        this.params = params
        this.nEllipse = nEllipse
        this.animation = animation
        this.handlers = handlers
        this.controls = []
        this.focalRows = []

        this.root = el("aside", "panel")
        this.buildTabs()
        this.buildParameters()
        this.buildLook()
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

    // Every control reports that the state moved, so the URL can follow it.
    // Only user edits reach this; `sync` sets values without firing listeners.
    touched() {
        if (this.handlers.changed) this.handlers.changed()
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
            this.touched()
            if (change && !commit) change()
        })
        if (change && commit) input.addEventListener("change", () => change())

        this.row(parent, label, input, value)
        // For the one caller that repaints itself every frame and cannot afford
        // a DOM query to find its own readout.
        input.valueNode = value
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
            this.touched()
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
            this.touched()
            if (change) change()
        })

        this.row(parent, label, input)
        this.controls.push(sync)
        sync()
        return input
    }

    toggle(parent, label, { read, write, change, hint }) {
        const input = el("input")
        input.type = "checkbox"
        const sync = () => { input.checked = read() }
        input.addEventListener("change", () => {
            write(input.checked)
            this.touched()
            if (change) change()
        })

        const row = this.row(parent, label, input)
        if (hint) row.title = hint

        this.controls.push(sync)
        sync()
        return input
    }

    // A toggle that carries its own label instead of sitting in a labelled row:
    // for the footer, where the controls are named by what they do and a lit
    // button says more than a tick box.
    // `label` may be a function of the current value, for a control whose name
    // is its state.
    toggleButton(parent, label, { read, write, className="", hint, change }) {
        const button = el("button", `toggle ${className}`.trim())
        if (hint) button.title = hint

        const sync = () => {
            const on = read()
            setText(button, typeof label === "function" ? label(on) : label)
            button.classList.toggle("active", on)
        }
        button.addEventListener("click", () => {
            write(!read())
            this.touched()
            sync()
            if (change) change()
        })

        parent.appendChild(button)
        this.controls.push(sync)
        sync()
        return button
    }

    buildParameters() {
        const body = this.tabBodies.parameters,
            params = this.params,
            { canvasChanged, countChanged, weightChanged } = this.handlers

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

        const defaults = this.section(body, "Defaults")
        const reset = el("button", "wide", "Reset parameters")
        reset.addEventListener("click", () => {
            if (this.handlers.resetParams) this.handlers.resetParams()
        })
        defaults.appendChild(reset)
        defaults.appendChild(el("p", "hint", "Every parameter back to its startup value, and one centred focal point. The seed is kept."))
    }

    // Everything between the density buffer and the pixels on screen, in the
    // order it is applied. None of it touches the simulation, so an image can be
    // graded long after it was drawn; bloom lands here too.
    buildLook() {
        const body = this.tabBodies.look,
            params = this.params

        // Colours first: the ramp is the first thing reached for when grading.
        const ramp = this.section(body, "Colours")
        this.stopList = el("div", "stop-list")
        ramp.appendChild(this.stopList)
        const addStop = el("button", "wide", "Add stop")
        addStop.addEventListener("click", () => this.addGradientStop())
        ramp.appendChild(addStop)
        ramp.appendChild(el("p", "hint", "Position 0 is empty canvas, 1 is the densest pixel."))
        this.syncGradientStops()

        const bloom = this.section(body, "Bloom")
        this.toggle(bloom, "Enabled", {
            read: () => params.bloom.enabled,
            write: (v) => params.bloom.enabled = v
        })
        this.slider(bloom, "Radius", {
            read: () => params.bloom.radius,
            write: (v) => params.bloom.radius = v,
            min: 2, max: 128, step: 1,
            format: (v) => `${v} px`
        })
        this.slider(bloom, "Strength", {
            read: () => params.bloom.strength,
            write: (v) => params.bloom.strength = v,
            min: 0, max: 2, step: .05,
            format: fixed(2)
        })
        this.slider(bloom, "Threshold", {
            read: () => params.bloom.threshold,
            write: (v) => params.bloom.threshold = v,
            min: 0, max: 1, step: .01,
            format: fixed(2)
        })
        bloom.appendChild(el("p", "hint", "Blurs the density itself, before the tone map, so the halo takes its colour from the middle of the ramp."))

        const tone = this.section(body, "Tone map")
        this.slider(tone, "Exposure", {
            read: () => params.exposure,
            write: (v) => params.exposure = v,
            min: .05, max: 4, step: .05,
            format: fixed(2)
        })
        this.slider(tone, "Gamma", {
            read: () => params.gamma,
            write: (v) => params.gamma = v,
            min: .1, max: 4, step: .05,
            format: fixed(2)
        })
        this.slider(tone, "Adaptation", {
            read: () => params.adaptation,
            write: (v) => params.adaptation = v,
            min: .01, max: 1, step: .01,
            format: fixed(2)
        })
        tone.appendChild(el("p", "hint", "The look is applied to whatever the image already holds — grade it with the exposure paused."))

        const vignette = this.section(body, "Vignette")
        this.toggle(vignette, "Enabled", {
            read: () => params.vignette.enabled,
            write: (v) => params.vignette.enabled = v
        })
        this.slider(vignette, "Amount", {
            read: () => params.vignette.amount,
            write: (v) => params.vignette.amount = v,
            min: 0, max: 1, step: .01,
            format: fixed(2)
        })
        this.slider(vignette, "Radius", {
            read: () => params.vignette.radius,
            write: (v) => params.vignette.radius = v,
            min: 0, max: 1, step: .01,
            format: fixed(2)
        })
        this.slider(vignette, "Softness", {
            read: () => params.vignette.softness,
            write: (v) => params.vignette.softness = v,
            min: .01, max: 1, step: .01,
            format: fixed(2)
        })

        vignette.appendChild(el("p", "hint", "The edge fades towards the ramp's colour at 0, not towards black."))

        const grain = this.section(body, "Grain")
        this.toggle(grain, "Enabled", {
            read: () => params.grain.enabled,
            write: (v) => params.grain.enabled = v
        })
        this.slider(grain, "Amount", {
            read: () => params.grain.amount,
            write: (v) => params.grain.amount = v,
            min: 0, max: 1, step: .01,
            format: fixed(2)
        })
        this.slider(grain, "Size", {
            read: () => params.grain.size,
            write: (v) => params.grain.size = v,
            min: 1, max: 4, step: 1,
            format: (v) => `${v} px`
        })
        this.slider(grain, "Coverage", {
            read: () => params.grain.coverage,
            write: (v) => params.grain.coverage = v,
            min: .02, max: 1, step: .02,
            format: fixed(2)
        })
        this.toggle(grain, "Monochrome", {
            read: () => params.grain.mono,
            write: (v) => params.grain.mono = v,
            hint: "Off: each channel gets its own noise, which reads as colour speckle."
        })
        grain.appendChild(el("p", "hint", "Coverage is how much of the frame gets a speck at all. Grain follows the image — the empty canvas stays clean."))
    }

    // The run controls live in a footer, outside the tabs: they are the things a
    // keyboard shortcut flips, so they stay visible whichever tab is open.
    buildModes() {
        const params = this.params
        const footer = el("div", "panel-footer")
        footer.appendChild(el("h2", null, "Exposure"))

        const run = el("div", "modes")
        // The pause button is named for what pressing it does; the mode button
        // is named for the state it is in, which is why only that one lights up.
        this.toggleButton(run, (on) => on ? "Pause" : "Resume", {
            read: () => params.exposing,
            write: (v) => params.exposing = v,
            className: "primary",
            hint: "Stop feeding the image; the look stays live (space)"
        })
        this.toggleButton(run, (on) => on ? "Exposure" : "Live", {
            read: () => params.accumulate,
            write: (v) => params.accumulate = v,
            className: "mode",
            hint: "Live draws each frame afresh; Exposure keeps what has been drawn (e)"
        })
        footer.appendChild(run)

        // Starting over is two clicks on the mode button (Live throws the buffer
        // away on the next frame, Exposure starts collecting again), so the
        // button below would be a third way to do the same thing. Kept in case
        // it is wanted back.
        // const newExposure = el("button", null, "New exposure")
        // newExposure.title = "Throw away the image and start collecting again"
        // newExposure.addEventListener("click", () => {
        //     if (this.handlers.clearImage) this.handlers.clearImage()
        // })
        // run.appendChild(newExposure)

        const overlays = el("div", "modes")
        this.toggleButton(overlays, "Foci (s)", {
            read: () => params.showFocalPoints,
            write: (v) => params.showFocalPoints = v,
            hint: "Show a cross at each focal point (s)"
        })
        this.toggleButton(overlays, "Follow (f)", {
            read: () => params.followFocalPoint,
            write: (v) => params.followFocalPoint = v,
            hint: "The newest focal point follows the mouse while the exposure runs (f)"
        })

        footer.appendChild(overlays)
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
        seed.appendChild(el("p", "hint", "The URL hash carries the whole state — copy the link to keep an image."))

        const output = this.section(body, "Output")
        const save = el("button", "wide", "Save PNG")
        save.addEventListener("click", () => {
            if (this.handlers.savePng) this.handlers.savePng()
        })
        output.appendChild(save)
        output.appendChild(el("p", "hint", "Saved at the canvas resolution set on the Parameters tab, with the look applied. Re-render at print size is Phase 6."))

        const presets = this.section(body, "Presets")
        const presetField = el("div", "field")
        const savePreset = el("button", null, "Download")
        savePreset.addEventListener("click", () => {
            if (this.handlers.savePreset) this.handlers.savePreset()
        })
        const loadPreset = el("button", null, "Load…")
        // A file input cannot be opened from script without a real click, so the
        // input stays hidden and the button forwards to it.
        const file = el("input")
        file.type = "file"
        file.accept = "application/json,.json"
        file.hidden = true
        file.addEventListener("change", () => {
            const chosen = file.files[0]
            file.value = ""
            if (chosen && this.handlers.loadPreset) this.handlers.loadPreset(chosen)
        })
        loadPreset.addEventListener("click", () => file.click())
        presetField.append(savePreset, loadPreset, file)
        presets.appendChild(presetField)
        this.presetStatus = el("p", "hint", "Seed, every parameter and the focal points, as one JSON file.")
        presets.appendChild(this.presetStatus)
    }

    buildPlayback() {
        const body = this.tabBodies.playback,
            params = this.params,
            animation = this.animation

        const timeline = this.section(body, "Timeline")

        const transport = el("div", "modes")
        this.playButton = this.toggleButton(transport, (on) => on ? "Pause" : "Play", {
            read: () => params.animation.playing,
            write: (on) => {
                // Pressing play on a finished one-shot starts it again rather
                // than leaving it sitting on its last step.
                if (on && animation.finished(params.animation.duration, params.animation.loop)) {
                    animation.seek(0, params.animation.duration)
                }
                params.animation.playing = on
            },
            hint: "The timeline advances one step per simulation step, so it only runs while the exposure does (space)"
        })
        this.toggleButton(transport, (on) => on ? "Loop" : "One-shot", {
            read: () => params.animation.loop,
            write: (on) => params.animation.loop = on,
            hint: "One-shot stops at the end; loop wraps back to the start"
        })
        timeline.appendChild(transport)

        this.slider(timeline, "Duration", {
            read: () => params.animation.duration,
            write: (value) => params.animation.duration = value,
            min: 60, max: 6000, step: 10,
            format: (value) => `${value} steps`,
            change: () => this.syncTransport()
        })

        this.scrubInput = this.slider(timeline, "Time", {
            read: () => animation.time,
            write: (value) => animation.seek(value, params.animation.duration),
            min: 0, max: Math.max(1, Math.round(params.animation.duration)), step: 1,
            format: (value) => String(Math.round(value)),
            // The readout only repaints itself while the transport runs, so a
            // scrub on a stopped timeline has to ask for it.
            change: () => this.refreshTransport()
        })

        this.timeReadout = el("p", "readout", "")
        timeline.appendChild(this.timeReadout)
        timeline.appendChild(el("p", "hint", "Duration is counted in simulation steps rather than seconds, so a run reproduces exactly. At 60 fps a step is about 17 ms."))
        timeline.appendChild(el("p", "hint", "Nothing moves yet: paths, dwells and modulators come next — see Phase 5 in docs/roadmap.md."))

        this.syncTransport()
    }

    // Not on a per-frame path: the scrub's range follows the duration, and a
    // duration written from outside can leave the current time past the end.
    syncTransport() {
        const duration = Math.max(1, Math.round(this.params.animation.duration))
        this.scrubInput.max = duration
        if (this.animation.time > duration) this.animation.seek(duration, duration)
        this.refreshTransport()
    }

    // Runs every frame while the timeline plays, so every write is guarded —
    // see the per-frame DOM rule in AGENTS.md.
    refreshTransport() {
        const { duration, playing } = this.params.animation
        const time = this.animation.time,
            span = Math.max(1, Math.round(duration))

        setNumber(this.scrubInput, time)
        setText(this.scrubInput.valueNode, String(Math.round(time)))
        setText(this.timeReadout,
            `Step ${Math.round(time)} of ${span} — ${Math.round(time/span*100)}%, ${(span/60).toFixed(1)} s at 60 fps`)

        if (this.shownPlaying !== playing) {
            this.shownPlaying = playing
            setText(this.playButton, playing ? "Pause" : "Play")
            this.playButton.classList.toggle("active", playing)
        }
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
                    this.touched()
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

    // The colour ramp's stops, rebuilt rather than patched — the focal-point
    // rows above work the same way, and neither is on a per-frame path.
    syncGradientStops() {
        const stops = this.params.gradient
        this.stopList.textContent = ""

        stops.forEach((stop, index) => {
            const row = el("div", "stop-row")

            const at = el("input")
            at.type = "number"
            at.min = 0
            at.max = 1
            at.step = .05
            at.value = stop.at
            at.addEventListener("input", () => {
                const value = Number(at.value)
                if (Number.isNaN(value)) return
                stop.at = Math.min(1, Math.max(0, value))
                this.touched()
            })
            // Reordering while a digit is being typed would pull the row out
            // from under the cursor, so it waits for the field to be committed.
            at.addEventListener("change", () => this.sortGradientStops())

            const colour = el("input")
            colour.type = "color"
            colour.value = stop.color
            colour.addEventListener("input", () => {
                stop.color = colour.value
                this.touched()
            })

            const remove = el("button", "remove", "×")
            remove.title = "Remove this stop"
            // Two is a ramp; one is a flat fill and zero is nothing to sample.
            remove.disabled = stops.length <= 2
            remove.addEventListener("click", () => {
                stops.splice(index, 1)
                this.touched()
                this.syncGradientStops()
            })

            row.append(at, colour, remove)
            this.stopList.appendChild(row)
        })
    }

    sortGradientStops() {
        this.params.gradient.sort((a, b) => a.at - b.at)
        this.syncGradientStops()
    }

    // A new stop lands in the widest gap, in the colour the ramp already has
    // there — so adding one changes nothing until it is moved.
    addGradientStop() {
        const stops = this.params.gradient
        let at = .5,
            widest = -1
        for (let i = 1; i < stops.length; i++) {
            const gap = stops[i].at - stops[i - 1].at
            if (gap > widest) {
                widest = gap
                at = (stops[i].at + stops[i - 1].at)/2
            }
        }

        stops.push({ at, color: Gradient.hex(Gradient.from(stops).sample(at)) })
        this.touched()
        this.sortGradientStops()
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

    setPresetStatus(text, failed=false) {
        setText(this.presetStatus, text)
        this.presetStatus.classList.toggle("failed", failed)
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
        // Not one of the registered controls: the stop list is a variable number
        // of rows, so a preset or a reset has to rebuild it.
        this.syncGradientStops()
        // Nor is the scrub's range, which follows the duration that has just
        // been restored.
        this.syncTransport()
    }
}
