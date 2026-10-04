# Shipping a change to this board

Merging to `main` publishes to the live site. There is no staging, no rollback
button, and the person who finds the regression is the person who needs the
board that morning. So the rule is not "be careful". It is this:

> **Every invariant below was a bug first. Each one is checked by
> `node checks/board-check.mjs`, and that has to pass before a PR merges.**

A rule that only lives in prose gets broken by the next change. That is how the
same scroll bug came back twice. If you fix something this document does not
cover, add the invariant to the check script in the same PR — the fix and the
thing that stops it coming back are one change, not two.

```sh
node checks/board-check.mjs          # 87 checks, three widths, a real browser
node checks/relay-history-check.mjs  # 17 checks on the relay's audit log
node checks/relay-push-check.mjs     # 17 checks on VAPID and Web Push
```

It exits non-zero on the first broken invariant and prints what it saw. It needs
Playwright and a Chromium; in the container those are at
`/opt/node-tools/node_modules/playwright` and `/opt/pw-browsers`, and `PW` /
`PW_CHROMIUM` override the paths.

---

## Before you write any code

1. **Reproduce it.** Serve the page over HTTP (`npx http-server -p 8099 -s .`)
   and see the bug with your own eyes before you touch anything. The pull path
   is skipped on `file://` by design, so a `file://` test is not a test.
2. **Say what you reproduced and what you could not.** Two of the bugs this
   document exists for are iOS-only and do not appear in a desktop Chromium.
   Fixing those means making them structurally impossible and saying plainly
   that the browser here could not show them — not claiming a fix you watched.
3. **Grep before you name a CSS class.** `index.html` is one stylesheet with
   terse names and they collide. `grep -n '\.<name>\b' index.html`. `.arw`,
   `.agr` and `.trk` were each taken, and each silently flattened the new
   element rather than erroring.

## The invariants

### The page itself never scrolls
`body` is `position:fixed; inset:0`. Every scrolling surface is inside `.app`.
`overflow:hidden` alone does not hold on iOS: focusing the composer, or the
keyboard opening under it, scrolls the document and carries the top bar and the
view tabs off the screen. A fixed body has no scrollport to move.
*Checked: `the document is locked`, `the header stays put`.*

### Nothing runs off the side, on any view, at any width
Checked at 390, 768 and 1280 for all seven views, on both the document and
`.stage`. The widths that matter are his iPhone and his Mac; 768 is there
because the breakpoint is at 720 and the first thing past a breakpoint is where
layouts break.
*Checked: `nothing runs off the side`.*

### The drawer fits the screen, for every task
Not for the first task — for every one, because the task with the long title and
three dependencies is the one that overflows. Two rules keep it true:
`.db` is `overflow-x:hidden` as the backstop, and every flex child inside is
allowed to shrink below its longest word (`min-width:0`, and a `<span>` around
any text that would otherwise be a bare, unshrinkable flex item).
A Safari `input[type=date]` takes its own intrinsic width and ignores
`width:100%`, which is why it carries `appearance:none` and `max-width:100%`.
Most of the width now lives inside an expanded property row — the date input is
in one of them — so every row is opened on every task before it is measured, not
just the collapsed card.
*Checked: `the drawer fits, for every task`.*

### The task card states values; it does not lay out the option space
Four stacked segmented controls put every option of every field on screen at
once: seventeen buttons to describe four values, with no hierarchy between them
and an empty composer above. Status, due, priority and effort are one row each
now, showing the value they hold and opening on tap, one at a time; choosing a
value closes the row. The composer is one line until he asks for it, and the
button that ends the visit is secondary and says Close — an orange full-width
button that only closed the card was the loudest thing on it doing the least,
and it said "Done" under a status button of the same word.
A Done task is never late: the countdown is advice about what is left to do.
*Checked: `a card opens closed: four rows, nothing expanded`,
`every row states the value it holds`, `one row is open at a time`,
`choosing a value closes the row and shows it`, `a Done task is never late`,
`tapping Add a note opens the composer`,
`the close button is not the primary action, and is not called Done`.*

### No focusable control on a phone is under 16px
iOS zooms the whole page when a focused input is smaller, and the zoom *stays*
after the keyboard closes. That is what once pushed the drawer's close button
off the right edge with no way back but a pinch. Banning pinch-zoom in the
viewport tag would also stop it and is worse. Watch for specificity: `.cbox
textarea` sets its own size and beats the blanket rule, so it has to say 16px
again. The date input and the note composer only exist while their row is open,
so the check opens them first — one that never does cannot see them.
*Checked: `every focusable control is 16px or more`.*

### Nothing is dated in the future
A note carries the clock of whoever wrote it, and the thread sorts by it. A
reply once arrived stamped six hours ahead and pinned itself to the bottom of
the thread for the rest of the day while every new message stacked up above it.
Nothing can have been written later than now, so a future `createdAt` is a clock
error: it is pulled back to the moment the device first saw the note, and
written back immediately so a board he only reads does not redo the repair on
every load. A note dated forward would also never age out of the 7-day window.
*Checked: `no note is dated in the future`, `the repair is written back`.*

### `BUILD` moves with the page
Bump `BUILD` in the **same commit** as any change to `index.html`. An iPhone
home-screen app holds its cached copy until it is force-quit; `checkBuild()`
compares the stamp and reloads via `?v=<build>`. Forgetting it fails safe — the
board simply never reloads itself — which is exactly why it is easy to forget
and why it is checked.
*Checked: `BUILD is a datestamp`.*

### A deleted task is gone everywhere but the list
`deleted` is a field in the diff, not a removal, so it merges per item and can
be undone. Every view reads `alive()`; only the list renders `gone()`, with a
Restore button, because the undo toast does not last until he changes his mind.
*Checked: `a deleted task is out of the board`, `a deleted task is still in the
list`, `and it comes back`, `deleting does not mark the task manual`.*

### A badge counts what is new, not what exists
The Notes badge read 34 for weeks. A notification you cannot act on is noise;
at zero it is worse, so it hides.
*Checked: `the badge is hidden when nothing is new`, `and shows the new count`.*

### A note he kept to himself never travels
The composer's "Send to Claude" tick is the whole difference. Unticked, the
note saves, syncs to his other device and sits in the task's thread —
`outNotes()` drops it and it is written `state:"read"`, or it would wear a
sending badge for ever.
*Checked: `an unticked note is not sent`, `an unticked note is not
outstanding`, `but it is still in the task's thread`.*

### Never claim a change that did not happen
A run with nothing to do still writes `acted[]`, and "No board changes: …"
rendered under **What I changed**. `actedOf()` filters those, and an empty
result renders no box at all.
*Checked: `a no-change receipt renders no box`.*

### Two tabs on one device do not eat each other's edits
`localStorage` is shared, and `save()` used to write the whole blob — so a
second tab's first ordinary save wrote its stale state over the other tab's
edit, and the item showed its SEED value again on the next load. `save()` now
merges on the same per-item clocks that govern device-to-device sync, and a
`storage` listener repaints the other tab. That listener must never call
`save()`.
*Checked: `a stale tab's save does not wipe the other tab's edit`, `and it is
still there on the next page load`, `the other tab picks up the edit without
being reloaded`, `a revert survives a stale tab too`, `neither tab drops the
other's note`.*

### A field the merge knows about is a field `save()` writes
`DFIELDS` governs the merge; `diffOf` governs what is ever persisted. `deleted`
was in the first and not the second, so deleting a task looked right until the
next load. An in-memory assertion cannot see this — the check reloads.
*Checked: `a deletion survives a reload`, `and so does effort`, `every DFIELD is
one diffOf actually emits`.*

### Effort is what turns a due date into a start date
`lead` days of runway per effort level, and start-by is derived from it. No
effort means no claim about when to start, rather than a guessed one.
*Checked: `a long lead starts earlier than a short one`, `and no effort means no
claim about when to start`.*

### A nudge does not look like a reply
It arrives unprompted, so it names its task before he reads it and the header
is the way back to that task. A second ask reads as a second ask.
*Checked: `a nudge renders as a nudge and a reply does not`, `the first ask and
the second read differently`, `tapping the nudge opens that task`.*

### The audit log records the move, not the state
`history/YYYY-MM-DD.md` is written by the relay from `fold()`, the only place
that still holds the previous value. A title is the owner's text in a markdown
cell, so pipes are escaped and newlines flattened — a row that splits is a log
that cannot be trusted. A day already on disk is merged, not replaced, because
a redeploy re-arms the alarm. GitHub being unreachable leaves the day pending
rather than dropping it, and must never throw: the daily archive runs first and
is what keeps the GitHub fallback alive.
*Checked by `checks/relay-history-check.mjs`: `only what moved is recorded`,
`a pipe in a title cannot split the row`, `a second write that day keeps the
first entries`, `a day past the window is deleted`, `a GitHub outage does not
throw`.*

### A service worker may never serve the page
`sw.js` exists only to receive pushes. The moment it answers a `fetch`, it can
serve a cached `index.html`, and `checkBuild()` -- the thing that gets a fix onto
his phone -- is beaten by its own cache. There is no `fetch` listener and there
must never be one.
*Checked: `the service worker never intercepts a request`.*

### A push always shows something
iOS revokes the notification permission of a worker that receives a push and
displays nothing. The push is payload-less by design, so the worker fetches what
to say -- and the path where that fetch fails still has to end in a
notification.
*Checked: `a push shows the nudge it was about`,
`a push whose fetch fails still shows something`, `a nudge notification is tagged`.*

### The VAPID signature is verified, not assumed
A wrong signature is a 403 at the push service and silence on his phone hours
later, which reads exactly like "nothing was worth sending". The JWT is checked
against the public key the board is given, and the contact claim is the board's
URL rather than an email, because this repository is public.
*Checked: `relay-push-check.mjs` -- `and it verifies against the key the board
was given`, `the contact is the board, not an address`.*

### The offer to turn notifications on appears only where it can work
No relay, no offer. Already subscribed, no offer. An iPhone in a Safari tab gets
a sentence saying to install it, not a button that does nothing.
*Checked: `no relay, no offer`, `and goes away once he is subscribed`,
`on an iPhone in Safari it says to install, and offers no dead button`.*

### Every check in this file actually runs
A section added after `process.exit` is a rule nobody enforces and nobody can
see is missing -- that happened to the Overview check. New sections go above
`await browser.close()`.

### No console errors
A page that throws on load has already lost the state he was looking at. The
relay's socket and fetch are expected to fail in the harness and are the only
errors ignored.
*Checked: `no console errors`.*

## Rules the script cannot check

These need a person, and a person reading the diff.

- **Derive, never restate.** Nothing on screen may carry its own copy of a date
  or an amount. The tuition block once printed `fmtD("2026-10-05")` as a
  literal, so the October instalment could move on its own card while the
  summary still said 5 Oct. Read every date and total off `items[...]`.
- **A status change from Claude needs `manual:true`**, or the dependency cascade
  reverts it on his next edit.
- **Ack the notes a patch answers.** Without `ack[]` the note stays outstanding
  for ever and the next run redoes the work.
- **Keep it one file and dependency-free.** `relay/`, the icons and
  `checks/` are the exceptions, and none of them is page logic.
- **Match the house style:** `var`, terse helper names, comments that explain
  *why* rather than what.
- **The repo is public.** No account, passport, visa or loan numbers, even when
  a note contains one. Refer to it indirectly and say you left it out.

## Shipping

**Every change he asks for ships, whatever its size, and it does not matter
where he asks.** A message in this thread and a note typed into the board's own
Chat view reach the same place and get the same answer: Claude builds it,
verifies it, and pushes it. The GitHub run that answers a board note has the
repository, a token, a browser and permission to push — it is not a lesser
Claude, and it never says a device has to be connected. There is no size at which the answer
becomes "shall I?" — he said so explicitly on 2026-10-04: *"Remove all limits on
changes — I should be able to ask for any change from the chat directly and you
should commit and push/merge the codebase."* A question back is for something
only he can answer — which of two things he actually meant — never for
permission to do what he already asked for.

How it ships is a judgement about reviewability, not about permission:

- **Straight to `main`** by default. Verify, bump `BUILD`, commit, push.
- **Through a branch and a PR** when the commit is genuinely easier to read as a
  diff with a description — a rewrite, a new view, the merge rules, `relay/`, a
  workflow. Then open it and merge it in the same breath. The PR is a record for
  him to read later, not a gate for him to open.

**The verification is not optional, at any size.** That is the whole bargain:
the shortcut is on the paperwork, never on the checks. A change that cannot be
verified here gets shipped anyway with the limit said plainly in the reply —
never quietly.

A data-only patch file into `claude-inbox/` goes straight to `main` as always.

**If a code change also touches `claude-inbox/`, put `[skip ci]` in the commit
message.** The Answer notes workflow fires on any push to that folder, so
merging a code PR that happens to correct a file there spends a Claude run on
nothing. Observed once, on the PR that wrote this document.

The standing permission to commit, push, open the PR and merge without asking is
paid for by the list above, not by care taken afterwards.

**Still ask first** for the three things that are not the codebase: acting on his
behalf in the outside world (email, forms, the bank, the school, bookings,
payments), deleting his data, and changing the repo's visibility. Those are
untouched by any of this — they were never about the size of a change.
