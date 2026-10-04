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
node checks/board-check.mjs      # 36 checks, three widths, a real browser
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
*Checked: `the drawer fits, for every task`.*

### No focusable control on a phone is under 16px
iOS zooms the whole page when a focused input is smaller, and the zoom *stays*
after the keyboard closes. That is what once pushed the drawer's close button
off the right edge with no way back but a pinch. Banning pinch-zoom in the
viewport tag would also stop it and is worse. Watch for specificity: `.cbox
textarea` sets its own size and beats the blanket rule, so it has to say 16px
again.
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

Branch, PR, merge — never commit code straight to `main`. The one sanctioned
exception is a data-only patch file into `claude-inbox/`.

The standing permission to commit, push, open the PR and merge without asking is
paid for by the list above, not by care taken afterwards.
