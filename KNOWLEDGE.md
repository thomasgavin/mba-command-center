# What this board knows

This is the durable copy of the **Mind map** view. He asked for it in these
words: *"create and maintain one or more .md files in the git repo so the
context and information is never lost even if this session is gone."*

The map itself lives in his browser and travels between his devices as `kb[]`
in the sync payload. That is the copy he reads. **This file is the copy the
next Claude reads** — no session, no browser and no Durable Object required,
just `git clone`.

## How it is kept

- `.claude/skills/answer-notes/SKILL.md` §3c is the procedure. A run that adds
  or changes a node in `kb[]` updates this file in the same commit.
- One `##` per category (the four he thinks in, plus Unfiled), one `###` per
  top-level node, nested bullets under it. The task a fact is tied to goes in
  brackets as its `SEED` id, so a future session can find it in `index.html`.
- The node's `id` is in brackets too. That is what makes a correction possible:
  same id, new text, in both places.
- **Only what he actually told us.** Inventing a fact here is worse than
  inventing one anywhere else on this board, because he will come back to it in
  six months and trust it.
- **This repository is public.** No account, passport, visa, loan or reference
  numbers, ever — name the thing indirectly and say the number was left out.

## Financial

*Nothing filed yet.*

## Student Life

*Nothing filed yet.*

## Academics

*Nothing filed yet.*

## Career

*Nothing filed yet.*

## Unfiled

*Nothing filed yet.*

---

The map starts empty on purpose. Thirty-four invented facts shipped as fact is
the drift this board exists to prevent, so it fills as he writes — one line in
the Mind map composer, and the next run files it here and in his browser.
