# Task list

> This is the tracked skeleton. The working file, `docs/task-list.md`, is
> git-ignored and holds only the tasks that are open right now. Landed ones move
> to `docs/task-list.archive.md`, which is tracked and never read while working.
> Copy this file over the working one to start a fresh queue.

A queue of small, self-contained tasks to hand to an agent. Each one is an
**addendum to a roadmap phase**, not a phase of its own — the shape of the work
is in `docs/roadmap.md`, and these are the follow-ups that come out of reviewing
what already landed.

## Project state

*Replace this with one line about where the project actually is. It saves whole
rounds of irrelevant engineering.* For example: "Pre-release, no live users and
no saved state anywhere but this machine — backward compatibility is never a
requirement unless a task says so in as many words."

An agent writing a task cannot infer this from the code, and will default to
production caution: migrations, deprecation paths, version negotiation. One line
here turns that off.

## Up next

*Execution order, which is not the numbering.* IDs are stable because things
reference them; the order changes as work lands. Three to five entries, each
with a clause saying why it is next.

## How to use this file

- **One task, one prompt.** The `Prompt` block is meant to be copied and handed
  over as-is; it has to stand on its own without the conversation it came from.
- **Tasks are independent** unless a `Blocked by` line says otherwise.
- **When a task lands, move it to the archive** — do not leave it here. A file
  that is mostly finished work costs context on every read and gives nothing
  back.
- **A landed task's `docs/decisions.md` entry names its ID.** That is what makes
  the archive findable from the durable record.
- **When one task landing changes another's premise, fix the other one there and
  then**, or close it. A stale open task is worse than a closed one: the next
  person starts from assumptions that stopped being true.
- Read `AGENTS.md` before starting anything here.

## Fields

`Kind` — bug / feature / performance / cleanup / measurement / documentation.

`Roadmap` — which phase it extends.

`Touches` — files. **Documentation is always in scope even when it is not
listed**: a rename that leaves the README saying the old word is not finished.

`Status` — `open`, `parked` (deliberately deferred, with the reason and what
would revive it), `superseded`, `rejected` (considered and turned down — kept so
it is not re-proposed).

`Done when` — **mandatory, and observable.** "Byte-identical", "no pass runs",
"the panel says X" — not "the code is cleaner". This is the field that stops an
implementer from gold-plating, and it is the one to write first: if you cannot
name a check, the task is not ready to hand over.

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
> **Do not describe what the code currently does.** The implementer reads it
> anyway, and the description is stale the moment it is written. Describe the
> problem, not the listing.
>
> **Name the traps.** "This will look like a bug and is not." "The obvious fix
> here is X, and X is wrong because Y." One sentence of this is worth three
> paragraphs of instructions — it is what stops a competent implementer from
> confidently doing the wrong thing.
>
> Say explicitly what is **not** wrong, when there is a nearby thing that looks
> wrong and isn't. An agent told only what to fix will happily "fix" the
> surroundings too.
>
> Call out any invariant the change must not break — an output that has to stay
> identical, an order of operations something else depends on, a public
> signature. This is the line that saves a rewrite.
>
> **Mark premises as premises.** Anything this task *rests on* but has not
> verified goes in a sentence that asks the implementer to check it rather than
> obey it: "this is believed to be true — confirm before relying on it". Prompts
> get written by someone reading, not running, the code; the confident wrong
> assertion is the characteristic failure of this format, and it only gets caught
> when it is flagged as checkable.
>
> **Not in this task:** the alternatives that were considered and turned down,
> named, so nobody reinvents them in six months.

**Done when**

- An observable check, not "the code looks better".
- One line per condition.
