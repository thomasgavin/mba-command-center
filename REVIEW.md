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
node checks/board-check.mjs          # 398 checks, three widths, a real browser
node checks/relay-history-check.mjs  # 17 checks on the relay's audit log
node checks/relay-push-check.mjs     # 21 checks on VAPID and Web Push
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
Checked at 390, 768 and 1280 for every view, on both the document and
`.stage`. The widths that matter are his iPhone and his Mac; 768 is there
because the breakpoint is at 720 and the first thing past a breakpoint is where
layouts break.
*Checked: `nothing runs off the side`.*

### A fact he gave the board is never lost
`kb` is the mind map, and it is the one thing on this board that cannot be
rebuilt from `SEED`. So it has to survive every path: a merge, a reload, a
second tab, and the Worker being deleted. It goes in `unionKb` (newest clock per
id, deletions included), in `save()` as a whole-blob field with its own rule, in
both payloads, in `mergePayload`, in the relay's `fold()` and in the daily
archive — and it is mirrored into `KNOWLEDGE.md` in the same commit that
changes it. A field that merges but never saves passes every in-memory
assertion and fails completely, which is what `deleted` taught; so the check
reloads the page.
*Checked: `a patch from Claude fills the map`, `it is written to storage, not
only held in memory`, `the map survives a reload`, `the relay folds the mind
map`, `the daily archive carries it into the repo`.*

### A node whose parent is gone is still reachable
It renders at the top of its category. A tree that silently drops a branch when
one node above it is deleted is a tree that loses what he wrote.
*Checked: `a fact whose parent is missing is still on screen`.*

### An answer out of the map is the best matches, not everything
Without a stop-word list, "what do I need for the loan" matched every node,
because "the" is in nearly every sentence. Words of three letters or more, stop
words dropped, and only the best-scoring nodes shown.
*Checked: `an ask answers out of the map at once`, `the tree dims what the
question did not touch`.*

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

### A deleted task is gone everywhere but Tasks
`deleted` is a field in the diff, not a removal, so it merges per item and can
be undone. Every view reads `alive()`; only Tasks renders `gone()`, with a
Restore button, because the undo toast does not last until he changes his mind.
(That job came over from the List view when the two merged.)
*Checked: `a deleted task is out of the board`, `a deleted task is still in
Tasks`, `and it comes back`, `deleting does not mark the task manual`.*

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

### Only a fresh nudge from Claude rings his phone
The board's `/send` carries `outNotes()`, which includes Claude's own notes so
they merge across devices — so anything that notifies on "a Claude note in the
payload" fires on every edit he makes, replaying old messages as news. It did.
The origin must be `/agent/reply`, the note must be a nudge, and it must be
newer than `NOTIFY_FRESH`, chosen by `createdAt` rather than array position.
*Checked: `a nudge echoed back by the board does not ring it either`,
`a plain reply does not ring it`, `an old nudge replayed is not news`,
`and it is the newest one, whatever order they arrived in`.*

### A successful automatic send is silent
The toast fired on every edit and every chat message and said only what the
screen already showed. A failure still toasts: that is the case he cannot
otherwise see.
*Checked: `a successful automatic send raises no toast`,
`a send that failed says so`.*

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

### A task opens from every view that draws one

Calendar renders a task two ways: `.ev` in the desktop grid and `.calrow` in
the narrow agenda. Only the first was in the click handler's selector, so on
the phone -- the way he actually uses the board -- Calendar was the one view
where tapping a task did nothing. `cursor:grab` on the row made the silence
look deliberate, and it was not even draggable.

A view that draws a task in a shape of its own has to be added to that
selector by hand. The check taps a Calendar task at 390 and 1280 and asserts
the drawer opens on the tapped id.

### A renamed task is still renamed after a reload

`title` is in `DFIELDS` and in `diffOf`. A field in one and not the other fails
silently and completely -- `deleted` proved it -- so the check types a new name
into the card, reads it back out of `localStorage`, **reloads the page**, and
reads it again. An in-memory assertion cannot see this class of bug at all.

The rename is driven the only way he has: the pencil on the drawer header. The
field takes the title's place (showing both is the same name twice), Escape
abandons, an empty name is refused -- a task with no name cannot be found again
-- and the Notes drawer offers no pencil at all.

The track is a row inside the property box, not a chip floating above it, and
the check asserts both halves of that: the row is there and the loose chip is
not.

### The words on screen are his words

"Blocked" is now "Upcoming" and the Target field is gone entirely. Both are
checked as text he can read -- the innerText of every view and of an open card
-- because a label is only ever wrong on screen. The status *key* is still
`blocked`, and must stay: every stored diff and merge payload in the wild
carries it.

### The key and the colours are one decision

Rows carry no state pill: the marker's colour is the state. So `statusColour()`
is the only place a status becomes a colour and `renderLegend()` builds the key
from `STATUS` -- a key that lies is worse than no key. *Checked: the key holds
every `STATUS` label plus Late, and no row renders a state pill, a date chip, a
note button or a note count.*

### Six weeks of the timeline fits beside the list on a phone

Two CSS numbers decide how much of the timeline he can see at 390px -- `--lw`
and the month width -- and either can quietly eat it. The check measures the
scroller, divides by a month column, and requires 1.5 months. *Checked: `at
least six weeks of the timeline is on screen beside the list`.*

### Tasks is one view, not two

The list and the timeline were two tabs over the same rows. One `.grow` now
holds both halves, `.gl` and `.gtrack`. The check asserts, at 390 and 1280,
that there is no List tab, that every task in `pool()` is a row, that a row
carries the state, the tick, the note button and the timeline together, and
that a done task is green on both halves.

### Every wide tile declares its grid span

`Recently completed` shipped with no `grid-column` at all, so auto-placement
gave it one column of the bento's twelve: an 80px ribbon of coloured dots with
every title clipped away. The check measures the tile's own box against the
bento's -- nearly the full row at 390, better than 40% and opposite the agenda
at 1280 -- because reading the stylesheet is what passed while his screen was
broken. It also asserts the list never shows more than five, while the heading
still counts them all.

### A webinar is a row in the timeline, not a section after it

Events sit in the same date-ordered run as the tasks, in Everything and inside
each track group alike, and the only thing separating them is `--ev` blue on
the title. The check asserts there is no `Events` heading, that every event is
still a row, that at least one of them falls *between* two tasks rather than
after all of them, and that the measured colour of an event title is blue
while no task's is.

### A NEWS item is a task, and his answer to it survives a reload

`nw:true` makes a task draw in `--news` everywhere and puts Accept and Reject
on its card; `newsState` is his answer. It is in `DFIELDS` **and** `diffOf`,
which is the rule a field in one and not the other breaks silently -- the
`deleted` bug. So the check accepts one, rejects another, reloads the page,
and asserts both answers are still there and the rejected one is still gone.
It also asserts the legend carries a News swatch exactly when a NEWS item is
on the board, and nothing else is in that key.

### The Notes drawer holds Claude's own notes and takes nothing

A Claude note anchored to a task, or a nudge. A reply in the thread and
anything he wrote himself are the thread's: *"don't include your replies to
regular chats."* The check seeds one of each, asserts only the first is drawn,
that no composer or action button survives, and that opening the drawer marks
read **only what it showed** -- marking a reply it never drew would put the
badge out over something he has not opened. Tapping a note opens the thread on
that message, highlighted and actually on screen.

### A swipe to reply arms across, never down

The one horizontal gesture on this board, and it is safe only because it hands
the drag back: nothing arms until the pointer has moved 12px across *and*
further across than down. The check drives real touch events -- a vertical drag
on a bubble must leave the reply strip shut, a right drag must open it on that
message, and the sent reply must carry `re` and draw its quote. The strip
quotes a line, never the message.

### A section comes back where he left it

`scrollAt` per view, restored after the view is painted, and never written to
`localStorage`. The check scrolls Timeline, leaves, returns and asserts the
same offset; then clicks the tab of the open section and asserts it ends at
the top. Boot calls `setView` with the current view, so the "already open"
shortcut is guarded by `viewReady` or the first setup is skipped entirely.

### A tile subtitle ends at the right edge of its heading

Two `margin-left:auto` elements split the free space between them rather than
one taking it, so "17 done so far" floated in the middle of its own heading.
The check measures every heading's subtitle against the heading's right edge,
and fails any `data-vgo` heading that has no subtitle at all -- that one would
put the chevron against the title.

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
