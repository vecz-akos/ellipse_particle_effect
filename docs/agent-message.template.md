# Agent messages

> This is the tracked skeleton. The working file, `docs/agent-message.md`, is
> git-ignored — it holds the tasks that happen to be open right now, and those
> are transient. Copy this file over it to start a fresh queue.

A queue of small, self-contained tasks to hand to an agent. Each one is an
**addendum to a roadmap phase**, not a phase of its own — the shape of the work
is in `docs/roadmap.md`, and these are the follow-ups that come out of reviewing
what already landed.

## How to use this file

- **One task, one prompt.** The `Prompt` block is meant to be copied and handed
  over as-is; it has to stand on its own without the conversation it came from.
- **Tasks are independent** unless a `Blocked by` line says otherwise. Pick any
  open one.
- **Mark, do not delete.** When a task lands, set `Status: done` and leave it —
  the record of what was asked is worth more than a short file.
- **Anything that changes how the project works still gets a `docs/decisions.md`
  entry.** A bug fix usually does not; a performance rewrite does.
- Read `AGENTS.md` before starting anything here.

Task fields: `Kind` (bug / performance / cleanup / measurement), `Roadmap` (which
phase it extends), `Touches` (files), `Status` (open / done), and `Done when` —
the acceptance check, so the agent knows when to stop.

---

## T0 — Title, as an imperative or a plain statement of the defect

- **Kind:** bug
- **Roadmap:** Phase N addendum
- **Touches:** `scripts/Something.js`
- **Status:** open

**Prompt**

> Name the symptom first, then the cause, then what to do. Write it for someone
> who has the repo open and nothing else — no "as we discussed", no pronouns
> pointing outside this block.
>
> Say explicitly what is **not** wrong, when there is a nearby thing that looks
> wrong and isn't. An agent told only what to fix will happily "fix" the
> surroundings too.
>
> Call out any invariant the change must not break — an output that has to stay
> identical, an order of operations something else depends on, a public
> signature. This is the line that saves a rewrite.

**Done when**

- An observable check, not "the code looks better".
- One line per condition; if you cannot name a check, the task is not ready to
  hand over.
