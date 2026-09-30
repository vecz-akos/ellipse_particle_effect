import Params from "./Params.js"
import Gradient from "./Gradient.js"
import Animation, { KINDS, modulator } from "./Animation.js"

// The modulator fields, as the panel labels them. Waves are full cycles per
// hold, amplitudes pixels, drift's speed per step — see KINDS in Animation.js.
const MODULATOR_FIELDS = {
    amplitude: { label: "amp", step: 1, min: 0 },
    waves: { label: "waves", step: .5, min: 0 },
    waves2: { label: "waves y", step: .5, min: 0 },
    speed: { label: "speed", step: .1, min: 0 }
}

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

    // Controls that would wreck a running timelapse export — a new exposure, a
    // new canvas, a moved clock — are disabled for its duration.
    exportLocked(control) {
        (this.exportLocks ||= []).push(control)
        return control
    }

    // Beyond the listed controls, the **whole Parameters tab** is locked: every
    // control there changes the simulation the recorder is observing, and
    // adding a point shifts every track under the running export. Each
    // control's previous disabled state is kept and put back — the per-point w
    // fields are disabled in shared mode and must come back that way. The Look
    // tab stays live on purpose: a film is graded per frame, and changing the
    // ramp or the bloom while it records is legitimate, not an accident.
    setExporting(on) {
        this.exporting = on
        // The tab's snapshot is taken before the listed locks touch anything,
        // and put back after they release — some of the listed controls sit on
        // this tab, and a snapshot taken after locking would restore them locked.
        if (on) {
            this.parametersWere = new Map()
            for (const node of this.tabBodies.parameters.querySelectorAll("input, select, button")) {
                this.parametersWere.set(node, node.disabled)
                node.disabled = true
            }
        }
        for (const control of this.exportLocks || []) control.disabled = on
        if (!on && this.parametersWere) {
            for (const [node, was] of this.parametersWere) node.disabled = was
            this.parametersWere = null
        }
        if (this.exportButton) {
            setText(this.exportButton, on ? "Cancel export" : "Export timelapse")
            this.exportButton.classList.toggle("active", on)
        }
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
        this.exportLocked(this.select(canvas, "Aspect", {
            read: () => params.aspect,
            write: (v) => params.aspect = v,
            options: Params.aspects,
            change: canvasChanged
        }))
        this.exportLocked(this.select(canvas, "Resolution", {
            read: () => params.resolution,
            write: (v) => params.resolution = v,
            options: Params.resolutions,
            change: canvasChanged
        }))
        this.sizeReadout = el("p", "readout")
        canvas.appendChild(this.sizeReadout)

        const simulation = this.section(body, "Simulation")
        this.exportLocked(this.slider(simulation, "Particles", {
            read: () => params.particleCount,
            write: (v) => params.particleCount = v,
            min: 1000, max: 100_000, step: 1000,
            format: (v) => `${Math.round(v/1000)}k`,
            change: countChanged,
            commit: true
        }))
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
        const reset = this.exportLocked(el("button", "wide", "Reset parameters"))
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
            min: .05, max: 2, step: .05,
            format: fixed(2)
        })
        this.slider(tone, "Gamma", {
            read: () => params.gamma,
            write: (v) => params.gamma = v,
            min: .1, max: 2, step: .05,
            format: fixed(2)
        })
        this.slider(tone, "Adaptation", {
            read: () => params.adaptation,
            write: (v) => params.adaptation = v,
            min: .01, max: 1, step: .01,
            format: fixed(2)
        })
        tone.appendChild(el("p", "hint", "Adaptation only matters while the exposure runs: lower, and a fresh bright area burns out for longer before the picture darkens around it."))
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
        this.exportLocked(this.toggleButton(run, (on) => on ? "Pause" : "Resume", {
            read: () => params.exposing,
            write: (v) => params.exposing = v,
            className: "primary",
            hint: "Stop feeding the image; the look stays live (space)"
        }))
        this.exportLocked(this.toggleButton(run, (on) => on ? "Exposure" : "Live", {
            read: () => params.accumulate,
            write: (v) => params.accumulate = v,
            className: "mode",
            hint: "Live draws each frame afresh; Exposure keeps what has been drawn (e)"
        }))
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
            hint: "Show a cross at each focal point, ringed on the selected one (s)"
        })
        this.toggleButton(overlays, "Follow (f)", {
            read: () => params.followFocalPoint,
            write: (v) => params.followFocalPoint = v,
            hint: "The selected point follows the mouse while the exposure runs; its track lets go of it meanwhile, and switching this off snaps it back to where the plan puts it — which draws a line into the exposure (f)"
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
        const apply = this.exportLocked(el("button", null, "Apply"))
        apply.addEventListener("click", () => {
            if (this.handlers.seedChanged) this.handlers.seedChanged(this.seedInput.value.trim())
        })
        const roll = this.exportLocked(el("button", null, "Roll (r)"))
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
        const loadPreset = this.exportLocked(el("button", null, "Load…"))
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
        this.playButton = this.exportLocked(this.toggleButton(transport, (on) => on ? "Pause" : "Play", {
            read: () => animation.playing,
            write: (on) => {
                // Pressing play on a finished one-shot starts it again rather
                // than leaving it sitting on its last step.
                if (on && animation.finished(params.animation.duration, params.animation.loop)) {
                    animation.seek(0, params.animation.duration, params.animation.loop)
                }
                animation.playing = on
            },
            hint: "The timeline advances one step per simulation step, so it only runs while the exposure does (space)"
        }))
        this.exportLocked(this.toggleButton(transport, (on) => on ? "Loop" : "One-shot", {
            read: () => params.animation.loop,
            write: (on) => params.animation.loop = on,
            // The reachable end of the timeline differs between the two: a loop
            // never occupies the last step, it wraps past it.
            change: () => this.syncTransport(),
            hint: "One-shot stops at the end; loop wraps back to the start"
        }))
        timeline.appendChild(transport)

        this.exportLocked(this.slider(timeline, "Duration", {
            read: () => params.animation.duration,
            write: (value) => params.animation.duration = value,
            min: 60, max: 1200, step: 10,
            format: (value) => `${value} steps`,
            change: () => this.syncTransport()
        }))

        this.scrubInput = this.exportLocked(this.slider(timeline, "Time", {
            read: () => animation.time,
            write: (value) => animation.seek(value, params.animation.duration, params.animation.loop),
            min: 0, max: Math.max(1, Math.round(params.animation.duration)), step: 1,
            format: (value) => String(Math.round(value)),
            // The readout only repaints itself while the transport runs, so a
            // scrub on a stopped timeline has to ask for it — and the figure
            // moves with the clock now.
            change: () => {
                this.refreshTransport()
                if (this.handlers.timelineSeeked) this.handlers.timelineSeeked()
            }
        }))

        this.timeReadout = el("p", "readout", "")
        timeline.appendChild(this.timeReadout)
        timeline.appendChild(el("p", "hint", "Duration is counted in simulation steps rather than seconds, so a run reproduces exactly. At 60 fps a step is about 17 ms."))
        timeline.appendChild(el("p", "hint", "Scrubbing back does not clear the image — re-running a stretch draws over what is already there. Use the mode button to start a new exposure."))

        this.buildTrack(body)
        this.buildExport(body)
        this.syncTransport()
    }

    // The timelapse: one button and a special play — see "Timelapse export" in
    // docs/decisions.md. The pace is steps per frame, because the clock counts
    // steps; the film length is derived from it and the duration.
    buildExport(body) {
        const params = this.params
        const section = this.section(body, "Timelapse")

        this.exportLocked(this.slider(section, "Steps per frame", {
            read: () => params.animation.stepsPerFrame,
            write: (value) => params.animation.stepsPerFrame = value,
            min: 1, max: 10, step: 1,
            format: (value) => String(Math.round(value)),
            change: () => this.syncTransport()
        }))
        this.exportReadout = el("p", "readout", "")
        section.appendChild(this.exportReadout)

        this.exportButton = el("button", "wide", "Export timelapse")
        this.exportButton.title = "Start a fresh exposure, play the timeline from the start, and record it"
        this.exportButton.addEventListener("click", () => {
            if (this.handlers.exportTimelapse) this.handlers.exportTimelapse()
        })
        section.appendChild(this.exportButton)
        section.appendChild(el("p", "hint", "Starts a new exposure and plays the timeline from the start, recording every frame without the overlay; the finished image stays on the canvas, paused. Press again to cancel. Frames are stamped as they arrive, so a slow canvas makes a slower film, never a dropped frame."))
    }

    // One point selected at a time, chosen here or by clicking it on the canvas.
    // That one selection is the whole app's: it opens the track here and it is
    // the point follow mode steers — see "One selected focal point" in
    // docs/decisions.md. Four levels of accordion would be unusable in a narrow
    // column, hence selection rather than nesting — see "The Playback tab" in
    // docs/roadmap.md.
    buildTrack(body) {
        const section = this.section(body, "Track")

        this.trackSelect = el("select")
        this.trackSelect.addEventListener("change", () => {
            this.selectPoint(Number(this.trackSelect.value))
        })
        this.row(section, "Point", this.trackSelect)

        // The one control still worth reading once the station list is scrolled,
        // so it sticks to the top of the section; the wrapper is what carries the
        // background the rows pass under.
        const sticky = el("div", "mini-bar-sticky")
        this.miniBar = el("div", "mini-bar")
        this.miniBar.addEventListener("mousedown", (event) => {
            this.seekFromMiniBar(event)
            // Captured on the window rather than the strip: it is sixteen pixels
            // tall, and the cursor leaves it at the first flick of the wrist.
            // The same references go to removeEventListener — see the
            // MouseFollower gotcha in AGENTS.md.
            const drag = (moved) => this.seekFromMiniBar(moved)
            const drop = () => {
                window.removeEventListener("mousemove", drag)
                window.removeEventListener("mouseup", drop)
            }
            window.addEventListener("mousemove", drag)
            window.addEventListener("mouseup", drop)
        })
        sticky.appendChild(this.miniBar)
        section.appendChild(sticky)

        // The track's default modulation, which its stations inherit. One slot
        // today; T26 adds the leg's beside it.
        this.modulationBlock = el("div", "modulation")
        section.appendChild(this.modulationBlock)

        this.stationList = el("div", "station-list")
        section.appendChild(this.stationList)

        this.addStationButton = el("button", "wide", "Add station here")
        this.addStationButton.title = "A station at the current time, at the point's current position and weight"
        this.addStationButton.addEventListener("click", () => this.addStation())
        section.appendChild(this.addStationButton)

        this.playbackStatus = el("p", "hint", "")
        section.appendChild(this.playbackStatus)
        section.appendChild(el("p", "hint", "A station can only be edited while the timeline is stopped and the clock sits exactly on it — click a row, away from its fields, to go there. What the exposure has already burned in cannot be un-burned."))
        section.appendChild(el("p", "hint", "While the shared Weight slider is in charge it sizes every station too; turn Manual on (Parameters tab) to animate a point's weight."))

        this.selectedPoint = -1
        this.syncTracks()
    }

    // The selector and the station list, rebuilt rather than patched: both
    // change only when the figure or the plan does, never per frame.
    syncTracks() {
        const points = this.nEllipse.focalPoints
        if (this.selectedPoint >= points.length) this.selectedPoint = points.length - 1
        if (points.length === 0) this.selectedPoint = -1

        this.trackSelect.textContent = ""
        const none = el("option", null, points.length === 0 ? "No focal points" : "None")
        none.value = "-1"
        this.trackSelect.appendChild(none)
        points.forEach((point, index) => {
            const stations = this.animation.tracks[index]
                ? this.animation.tracks[index].stations.length : 0
            const option = el("option", null,
                `Point ${index + 1}${stations > 0 ? ` — ${stations} stations` : ""}`)
            option.value = String(index)
            this.trackSelect.appendChild(option)
        })
        this.trackSelect.value = String(this.selectedPoint)
        this.trackSelect.disabled = points.length === 0

        this.syncStations()
    }

    selectPoint(index) {
        const points = this.nEllipse.focalPoints.length
        this.selectedPoint = index >= 0 && index < points ? index : -1
        this.trackSelect.value = String(this.selectedPoint)
        this.syncStations()
        // The canvas draws the open track and marks the selected point, so the
        // selection changes the picture.
        if (this.handlers.selectionChanged) this.handlers.selectionChanged()
    }

    get openTrack() {
        return this.animation.tracks[this.selectedPoint] || null
    }

    // A station is editable only while the timeline is stopped and the clock is
    // exactly on it. The lock lives here and not in Animation: a preset restores
    // every station regardless, and the model has no notion of a past. See
    // "Editing rules on the Playback tab" in docs/roadmap.md.
    stationLocked(station) {
        return this.animation.playing || this.animation.time !== station.time
    }

    addStation() {
        const track = this.openTrack
        const point = this.nEllipse.focalPoints[this.selectedPoint]
        if (!track || !point) return
        if (this.animation.playing) {
            this.setPlaybackStatus("Stop the timeline before editing a track.", true)
            return
        }
        const time = this.animation.time
        if (track.stations.some(station => station.time === time)) {
            this.setPlaybackStatus(`There is already a station at step ${time}.`, true)
            return
        }
        // The plan's position, not the point's: with a tremor running the point
        // is off-plan by a random offset, and copying it would freeze one
        // shaking instant into a station. Only a track with no stations yet
        // has nothing but the point to read.
        const { duration, loop } = this.params.animation
        const at = Animation.at(track, time, duration, loop) || point
        this.animation.addStation(track, {
            time, x: at.x, y: at.y, weight: at.weight,
            // A control point on the station itself makes the curve start out
            // straight, so turning `curve` on changes nothing until it is dragged.
            cx: at.x, cy: at.y
        })
        this.setPlaybackStatus(`Station added at step ${time}.`)
        this.touched()
        this.syncTracks()
        if (this.handlers.animationEdited) this.handlers.animationEdited()
    }

    // Times snap to other tracks' station times, so points can be made to arrive
    // together without typing matching numbers.
    snapTime(time, exclude) {
        const span = Math.max(1, Math.round(this.params.animation.duration))
        // Clamped to where the clock can actually stand — a loop never
        // occupies its last step — so a station typed past the end does not
        // land where the clock can never reach it.
        const last = this.params.animation.loop ? span - 1 : span
        const tolerance = Math.max(2, Math.round(span*.01))
        let best = Math.min(last, Math.max(0, Math.round(time))), distance = tolerance + 1
        for (const track of this.animation.tracks) {
            for (const station of track.stations) {
                if (station === exclude) continue
                const gap = Math.abs(station.time - time)
                if (gap <= tolerance && gap < distance) {
                    distance = gap
                    best = station.time
                }
            }
        }
        return best
    }

    stationField(row, label, station, key, { step=1, min=null, integer=true }={}) {
        const field = el("label", "station-field")
        field.appendChild(el("span", null, label))
        const input = el("input")
        input.type = "number"
        input.step = step
        if (min !== null) input.min = min
        input.value = integer ? Math.round(station[key]) : station[key]
        const read = () => {
            const value = Number(input.value)
            return Number.isNaN(value) ? null : value
        }
        if (key === "time") {
            // The time is applied on commit only. Typing 150 over a 5 passes
            // through 1 and 15, and applying those would snap the station onto
            // a neighbour, let normalise clamp its dwell to zero for good, and
            // burn the figure's detour into a running exposure. A wrong x is
            // harmless for a keystroke; a wrong t is not.
            input.addEventListener("change", () => {
                const value = read()
                if (value === null) return
                station.time = this.snapTime(value, station)
                // The lock is "the clock sits on the station", so moving the
                // station would lock it under the cursor: the clock goes with it.
                this.seekTo(station.time)
                this.editedStation(station)
                this.syncTracks()
            })
        } else {
            input.addEventListener("input", () => {
                const value = read()
                if (value === null) return
                station[key] = value
                this.editedStation(station)
            })
        }
        // Rebuilding on every keystroke would reorder the list under the cursor
        // — the ramp's stops wait for the same reason. Leg lengths update live
        // through refreshLegs; the order and the locks wait for the field.
        if (key === "dwell") {
            input.addEventListener("change", () => this.syncTracks())
        }
        field.appendChild(input)
        row.appendChild(field)
        return input
    }

    // One place for everything an edit has to do: keep the list well formed,
    // move the figure to match, and tell the app the state changed.
    editedStation() {
        const track = this.openTrack
        if (track) Animation.normalise(track)
        this.refreshLegs()
        this.syncMiniBar()
        this.touched()
        if (this.handlers.animationEdited) this.handlers.animationEdited()
    }

    // A leg's length is derived from two stations' times and a dwell, so it goes
    // stale the moment any of the three is typed into. Cheap enough to redo in
    // place rather than rebuilding the rows.
    refreshLegs() {
        const track = this.openTrack
        if (!track || !this.stationRows) return
        const span = Math.max(1, Math.round(this.params.animation.duration))
        this.stationRows.forEach(({ legLength }, index) => {
            const station = track.stations[index]
            if (!station || !legLength) return
            const next = track.stations[index + 1]
            const arrives = next ? next.time : span
            const steps = Math.max(0, Math.round(arrives - station.time - Math.max(0, station.dwell)))
            setText(legLength, !next && !this.params.animation.loop
                ? "holds to the end"
                : `↓ ${steps} steps${next ? "" : " back to the first"}`)
        })
    }

    // One form per slot, wherever the slot sits — the track's default or a
    // station's own. The fields differ per kind, so a kind change rebuilds the
    // fields; the numbers are edited live, like a station's x.
    modulatorForm(container, get, { locked, onEdit }) {
        const form = el("div", "modulator")
        const select = el("select")
        const options = {}
        for (const kind of Object.keys(KINDS)) {
            const option = el("option", null, kind)
            option.value = kind
            select.appendChild(option)
            options[kind] = option
        }
        const fields = el("div", "station-fields modulator-fields")
        const entry = { select, fields, inputs: [], get, locked, pulseOption: options.pulse }

        const render = () => {
            const m = get()
            select.value = m.kind
            fields.textContent = ""
            entry.inputs = []
            for (const key of KINDS[m.kind]) {
                const spec = MODULATOR_FIELDS[key]
                const field = el("label", "station-field")
                field.appendChild(el("span", null, spec.label))
                const input = el("input")
                input.type = "number"
                input.step = spec.step
                if (spec.min !== undefined) input.min = spec.min
                input.value = m[key]
                input.addEventListener("input", () => {
                    const value = Number(input.value)
                    if (Number.isNaN(value)) return
                    get()[key] = spec.min !== undefined ? Math.max(spec.min, value) : value
                    onEdit()
                })
                field.appendChild(input)
                fields.appendChild(field)
                entry.inputs.push(input)
            }
            fields.hidden = KINDS[m.kind].length === 0
        }
        select.addEventListener("change", () => {
            get().kind = select.value
            render()
            onEdit()
            this.syncStationLocks(true)
        })
        render()

        form.appendChild(select)
        form.appendChild(fields)
        container.appendChild(form)
        this.modulatorForms.push(entry)
        return entry
    }

    // The track's defaults, one form per slot. A default reaches every phase
    // of its kind on the track, so it is a track edit: allowed whenever the
    // timeline is stopped.
    syncModulation() {
        const track = this.openTrack
        this.modulationBlock.textContent = ""
        this.modulationBlock.hidden = !track
        if (!track) return
        const locked = () => this.animation.playing
        this.modulationBlock.appendChild(el("p", "readout", "Dwell modulation"))
        this.modulatorForm(this.modulationBlock, () => track.modulation.dwell, {
            locked, onEdit: () => this.editedStation()
        })
        this.modulationBlock.appendChild(el("p", "hint",
            "Added on top of the plan while the point holds at a station. Amplitude is in pixels; waves is how many full cycles fit in the hold, so a whole number ends where it started."))
        this.modulationBlock.appendChild(el("p", "readout", "Leg modulation"))
        this.modulatorForm(this.modulationBlock, () => track.modulation.leg, {
            locked, onEdit: () => this.editedStation()
        })
        this.modulationBlock.appendChild(el("p", "hint",
            "The same, while the point travels to the next station: the sine swings across the leg, the orbit rides along it. Every station takes these unless it has its own."))
    }

    // A station's own slot, collapsed behind a checkbox: ticking it copies the
    // track's default to start from, unticking goes back to inheriting.
    stationSlot(row, track, station, slot, label) {
        const own = el("div", "station-modulation")
        const override = el("input")
        override.type = "checkbox"
        override.checked = Boolean(station.modulation[slot])
        override.addEventListener("change", () => {
            station.modulation[slot] = override.checked ? modulator(track.modulation[slot]) : null
            this.editedStation(station)
            this.syncTracks()
        })
        const overrideLabel = el("label", "station-curve")
        overrideLabel.appendChild(override)
        overrideLabel.appendChild(el("span", null, label))
        own.appendChild(overrideLabel)
        if (station.modulation[slot]) {
            this.modulatorForm(own, () => station.modulation[slot], {
                locked: () => this.stationLocked(station),
                onEdit: () => this.editedStation(station)
            })
        }
        row.appendChild(own)
        return override
    }

    syncStations() {
        const track = this.openTrack
        this.stationList.textContent = ""
        this.stationRows = []
        this.modulatorForms = []
        this.addStationButton.disabled = !track
        this.syncModulation()

        if (!track) {
            this.stationList.appendChild(el("p", "hint",
                this.nEllipse.focalPoints.length === 0
                    ? "Add a focal point first."
                    : "No point selected. Choose one above, or click it on the canvas."))
            this.syncMiniBar()
            return
        }
        if (track.stations.length === 0) {
            this.stationList.appendChild(el("p", "hint",
                "No stations — this point stands where you put it. Add one to start a track."))
        }

        const span = Math.max(1, Math.round(this.params.animation.duration))
        track.stations.forEach((station, index) => {
            const row = el("div", "station-row")
            // The whole row is the way back to a station — the step number
            // alone was too small a target. The row is full of controls, so a
            // click that lands on one is not a seek: typing a number must not
            // move the clock, and the × must not seek to the station it is
            // removing. Same shape as the keyboard handler's `.panel` guard.
            row.addEventListener("click", (event) => {
                if (event.target.closest("input, select, button")) return
                // A label around a checkbox toggles it, so seeking there would
                // be two actions from one click; one around a number field only
                // moves focus, and its letter is target the row can spare.
                const label = event.target.closest("label")
                if (label && [...label.children].some(node => node.type === "checkbox")) return
                this.seekTo(station.time)
            })

            // When, then which station, then away with it. The time leads the
            // row because it is what orders the list — see "The station row
            // drops x and y" in docs/decisions.md.
            const head = el("div", "station-head")
            const inputs = {
                time: this.stationField(head, "t", station, "time", { min: 0 })
            }
            // The way back to a locked station: seeking here unlocks it.
            const at = el("button", "station-time", `${index + 1}. step ${Math.round(station.time)}`)
            at.title = "Move the clock to this station"
            at.addEventListener("click", () => this.seekTo(station.time))
            head.appendChild(at)
            const remove = el("button", "remove", "×")
            remove.title = "Remove this station"
            remove.addEventListener("click", () => this.removeStation(index))
            head.appendChild(remove)
            row.appendChild(head)

            // A station's position is dragged on the canvas, not typed: how
            // much and how long are what is left to read here.
            const fields = el("div", "station-fields")
            inputs.weight = this.stationField(fields, "w", station, "weight", { step: 10 })
            inputs.dwell = this.stationField(fields, "hold", station, "dwell", { step: 10, min: 0 })
            row.appendChild(fields)

            // The station's own dwell modulator sits under the hold; the leg's
            // under the leg row below, since the leg is what leaves here.
            inputs.override = this.stationSlot(row, track, station, "dwell", "own dwell modulation")

            const next = track.stations[index + 1]
            const isLast = !next
            const arrives = next ? next.time : span
            const legSteps = Math.max(0, Math.round(arrives - station.time - Math.max(0, station.dwell)))
            const leg = el("div", "station-leg")
            const curve = el("input")
            curve.type = "checkbox"
            curve.checked = station.curve
            curve.addEventListener("change", () => {
                station.curve = curve.checked
                this.editedStation(station)
            })
            const curveLabel = el("label", "station-curve")
            curveLabel.appendChild(curve)
            curveLabel.appendChild(el("span", null, "curve"))
            leg.appendChild(curveLabel)
            const legLength = el("span", "station-leg-length",
                isLast && !this.params.animation.loop
                    ? "holds to the end"
                    : `↓ ${legSteps} steps${isLast ? " back to the first" : ""}`)
            leg.appendChild(legLength)
            row.appendChild(leg)
            // A one-shot's last station has no leg to modulate.
            if (!(isLast && !this.params.animation.loop)) {
                inputs.legOverride = this.stationSlot(row, track, station, "leg", "own leg modulation")
            }

            this.stationList.appendChild(row)
            this.stationRows.push({ row, inputs, curve, station, legLength })
        })

        this.syncMiniBar()
        this.syncStationLocks(true)
    }

    // Disabled state follows the clock, so it is re-evaluated per frame — but
    // only written when the set of unlocked stations actually changes. The
    // station's w field is also the shared weight's third view, so it is locked
    // with the per-point one while that is in charge.
    syncStationLocks(force=false) {
        if (!this.stationRows) return
        const shared = !this.params.manualWeight
        // `current` is where the clock sits, which a playing timeline still has
        // even though every row is locked then — so both flags go into the
        // signature, or the accent would stop following the clock while it runs.
        const signature = (shared ? "s" : "m") + (this.animation.playing ? "p" : "-")
            + this.stationRows.map(({ station }) =>
                `${this.stationLocked(station) ? "1" : "0"}${this.animation.time === station.time ? "c" : "-"}`).join("")
        if (!force && signature === this.shownLocks) return
        this.shownLocks = signature

        this.stationRows.forEach(({ row, inputs, curve, station }) => {
            const locked = this.stationLocked(station)
            row.classList.toggle("locked", locked)
            row.classList.toggle("current", this.animation.time === station.time)
            for (const input of Object.values(inputs)) input.disabled = locked
            inputs.weight.disabled = locked || shared
            curve.disabled = locked
        })

        // The modulator forms lock with whatever they hang off — the track or a
        // station. A weight pulse is a weight, so its numbers lock with the
        // station weights while the shared slider is in charge; the kind can
        // still be changed away from it.
        for (const form of this.modulatorForms || []) {
            const locked = form.locked()
            form.select.disabled = locked
            form.pulseOption.disabled = shared
            const pulse = shared && form.get().kind === "pulse"
            for (const input of form.inputs) input.disabled = locked || pulse
        }
    }

    // Sequence without proportion is what a list cannot show: dwells as blocks,
    // legs as lines, a marker at the current time.
    syncMiniBar() {
        const track = this.openTrack
        const span = Math.max(1, Math.round(this.params.animation.duration))
        this.miniBar.textContent = ""
        this.miniBar.classList.toggle("empty", !track || track.stations.length === 0)

        if (track) {
            for (const station of track.stations) {
                const dwell = Math.max(0, Math.min(station.dwell, span - station.time))
                const block = el("div", "mini-dwell")
                block.style.left = `${station.time/span*100}%`
                // A zero dwell still needs to be visible as a mark on the bar.
                block.style.width = `${Math.max(dwell/span*100, .6)}%`
                this.miniBar.appendChild(block)
            }
        }
        this.miniMarker = el("div", "mini-marker")
        this.miniBar.appendChild(this.miniMarker)
        this.shownMarker = null
        this.moveMiniMarker()
    }

    moveMiniMarker() {
        if (!this.miniMarker) return
        const span = Math.max(1, Math.round(this.params.animation.duration))
        const left = `${Math.min(100, this.animation.time/span*100)}%`
        if (left !== this.shownMarker) {
            this.shownMarker = left
            this.miniMarker.style.left = left
        }
    }

    seekFromMiniBar(event) {
        const rect = this.miniBar.getBoundingClientRect()
        if (!rect.width) return
        const span = Math.max(1, Math.round(this.params.animation.duration))
        const raw = (event.clientX - rect.left)/rect.width*span
        // Clicking near a station lands on it, which is what makes it editable.
        this.seekTo(this.snapTime(raw, null))
    }

    // Every seek the tab offers goes through here — the scrub, the mini bar, a
    // station row — so one guard keeps them all off a running export, which the
    // disabled scrub slider alone would not (the bar and the rows are divs).
    seekTo(time) {
        if (this.exporting) return
        this.animation.seek(time, this.params.animation.duration, this.params.animation.loop)
        this.refreshTransport()
        if (this.handlers.timelineSeeked) this.handlers.timelineSeeked()
    }

    removeStation(index) {
        const track = this.openTrack
        if (!track) return
        if (this.animation.playing) {
            this.setPlaybackStatus("Stop the timeline before editing a track.", true)
            return
        }
        if (this.stationLocked(track.stations[index])) {
            this.setPlaybackStatus("That station is behind the clock. Go to it first.", true)
            return
        }
        this.animation.removeStation(track, index)
        this.touched()
        this.syncTracks()
        if (this.handlers.animationEdited) this.handlers.animationEdited()
    }

    setPlaybackStatus(text, failed=false) {
        setText(this.playbackStatus, text)
        this.playbackStatus.classList.toggle("failed", failed)
    }

    // The shared weight or a canvas drag changed a station: the numbers the row
    // still shows follow without rebuilding it, which would pull the cursor out
    // of a field. A drag moves x and y, which the row no longer prints — the
    // canvas is where that is read now.
    refreshStationValues() {
        if (!this.stationRows) return
        for (const { inputs, station } of this.stationRows) {
            setNumber(inputs.weight, station.weight)
        }
    }

    // Not on a per-frame path: the scrub's range follows the duration, and a
    // duration written from outside can leave the current time past the end.
    syncTransport() {
        const { duration, loop } = this.params.animation
        const span = Math.max(1, Math.round(duration))
        // A loop wraps past its last step, so that step is not a position the
        // slider should be able to offer.
        this.scrubInput.max = loop ? span - 1 : span
        this.animation.seek(this.animation.time, span, loop)
        // Leg lengths and the mini bar's scale are both read off the duration.
        if (this.stationList) this.syncStations()
        this.refreshTransport()
        this.refreshExportReadout()
    }

    // The film's length: one frame per stepsPerFrame steps plus the empty first
    // one, and the seconds that makes at 60 fps — the best case, since the
    // recorder stamps frames as they arrive.
    refreshExportReadout() {
        if (!this.exportReadout || !this.handlers.exportFrames) return
        const frames = this.handlers.exportFrames()
        setText(this.exportReadout, `${frames} frames — ${(frames/60).toFixed(1)} s at 60 fps`)
    }

    // Runs every frame while the timeline plays, so every write is guarded —
    // see the per-frame DOM rule in AGENTS.md.
    refreshTransport() {
        const { duration } = this.params.animation
        const playing = this.animation.playing,
            time = this.animation.time,
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

        this.moveMiniMarker()
        // Which stations are editable follows the clock, so it has to be checked
        // as often as the clock moves — the write inside is what is guarded.
        this.syncStationLocks()
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
        // The track selector lists the points, so it is rebuilt with them.
        // Guarded: the focal rows are built before the Playback tab exists.
        if (this.trackSelect) this.syncTracks()
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

    // The shared weight, the per-row w fields and the stations' w fields are
    // three views of one number, so exactly one of them is editable at a time.
    syncWeightControls() {
        const shared = !this.params.manualWeight
        this.sharedWeightInput.disabled = !shared
        for (const inputs of this.focalRows) inputs.weight.disabled = shared
        this.refreshFocalValues()
        // The station rows are built after the focal rows, so on the first pass
        // there are none yet; both are guarded inside.
        this.refreshStationValues()
        this.syncStationLocks()
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
        // been restored, or the track list, which follows the focal points.
        this.syncTracks()
        this.syncTransport()
    }
}
