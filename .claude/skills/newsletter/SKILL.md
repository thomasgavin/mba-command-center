---
name: newsletter
description: Write Gavin's daily brief or his Sunday weekly report onto the MBA board, as a newsletter edition he opens from the newspaper button. Run by the two newsletter Routines.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Newsletter

Nobody asked you a question. A newsletter is the one thing on this board that
arrives on a clock, and the only thing that is allowed to say "here is where
everything stands" — every other surface is deliberately forbidden from
summarising the board, because a summary nobody asked for is noise.

Gavin asked for it in these words: *"the newsletter should be a brief of tasks
due today, follow-ups with me on some critical upcoming tasks or statuses,
overdue items, etc"*, and for the Sunday one: *"more strategic and analytical
of what is done, what are the current risks, what to prioritize"*.

Read `CLAUDE.md` first for the data model and the privacy rule.

## Which edition

The Routine's prompt says which. If it does not, the day decides: Sunday is the
weekly report, every other day is the daily brief. There is no daily on Sunday.

## 1. Get the board

Same two routes as `nudge`, and the relay is the normal one:

```sh
curl -sf -X POST "$RELAY_URL/agent/pull" -H "X-Agent-Key: $RELAY_AGENT_KEY"
```

If that fails, fall back to `SEED` in `index.html` plus the newest files in
`claude-inbox/`. Either way **`SEED` is the baseline and `changed[]` is the
diff over it** — a task absent from `changed[]` is at its SEED values, not
missing.

Read the existing `news[]` too. The last few editions are what stop this one
repeating itself.

## 2. The daily brief

Four sections, in this order, and a section with nothing in it is **left out**
rather than written as "nothing":

```
## Due today
## Overdue
## Waiting on you
## Worth starting
```

- **Due today** — open tasks whose `due` is today. Name the task and the one
  thing that actually has to happen.
- **Overdue** — open tasks past their `due`, oldest first, with how far past.
- **Waiting on you** — a critical or high task whose status has not moved in a
  week, or one blocked on something only he can supply. This is the follow-up
  he asked for: ask the question, do not restate the status.
- **Worth starting** — a task whose start-by (`due` minus its `effort` lead) is
  today or past, that has not started. Leave it out when `effort` is unset:
  inventing the lead is the drift this board exists to prevent.

Three to eight lines in total. It is read on a phone before work. A brief that
runs to a screen is one he stops opening, and then the overdue line at the top
never lands either.

## 3. The weekly report

Sunday, and a different job: not a longer list but a look back and a look
ahead.

```
## What moved
## What did not
## Risks
## Put first this week
```

- **What moved** — what actually closed or advanced since last Sunday, read off
  `doneAt` and the audit log in `history/`, not off memory.
- **What did not** — what he meant to do and did not, without scolding.
- **Risks** — this is the analytical part and the reason the weekly exists.
  What is on the critical path, what has no slack left, what depends on a third
  party who has gone quiet, what would cost the most if it slipped another
  week. Say why, not just what.
- **Put first this week** — two or three things, in order, with the reason the
  order is that way.

Ten to twenty lines. He has time on a Sunday; he does not have patience for
padding.

## 4. Write it

A newsletter is an entry in `news[]`, posted the way a reply is
(`/agent/reply`, or a patch file in `claude-inbox/` on the file route). The
payload carries `op:"patch"` — the relay rejects one with no notes and no
changes unless it does.

```json
{
  "v": 1, "op": "patch", "exportedAt": "<ISO now>",
  "notes": [], "changed": [],
  "news": [{
    "id": "news-daily-2026-10-07",
    "period": "daily",
    "date": "2026-10-07",
    "body": "## Due today\\nPay the October tuition instalment...\\n## Overdue\\n...",
    "at": "<ISO now>",
    "createdAt": "<ISO now>"
  }]
}
```

- **`id`** is `news-<period>-<date>`. It is how a re-run replaces an edition
  rather than publishing a second one for the same day.
- **`period`** is `daily` or `weekly`, and **`date`** is the day it covers.
  Together they are the title the board prints — "Daily Newsletter — 07 October
  2026". Do not write a title yourself; there is no `title` field to drift.
- **`body`** is plain text. The only markup is `## ` at the start of a line,
  which is a section heading. Blank lines are ignored.
- **`at` and `createdAt` are the real time now**, read off the clock. The relay
  only rings his phone for an edition less than ten minutes old, so an invented
  timestamp is a newsletter that lands silently.
- **A newsletter changes nothing**. No `changed[]`, no statuses, no dates. It
  says where things stand; it does not move them.

Posting it is what rings his phone: the relay sees a fresh `news[]` on
`/agent/reply` and sends "Gavin, today's command newsletter is ready". The
board's own `/send` can never trigger that, which is what stops his own edits
re-announcing yesterday's edition.

## 5. What never goes in one

- **Nothing about the machinery.** Not the relay, the Routines, this skill, the
  workflow, a deploy, a check, or anything from the Claude-app conversation
  where this board gets built. He said it plainly: the board's notes are *"only
  for task/on-app query related answers, info or nudges"*. A newsletter is
  about his MBA admin and nothing else.
- **No identifiers**, per `CLAUDE.md`: no account, passport, visa, loan or
  dossier numbers, no appointment or booking codes, no verification codes, no
  credentials, no payment details. The repository is public. Vendors,
  institutions and subject lines are fine.
- **No praise and no filler.** "Great progress this week" is a line he scrolls
  past, and it teaches him the rest is skimmable too.
- **Never invent a date, an amount or a status.** If the board does not say it,
  the newsletter does not either.

## 6. Report

Say in the run log which edition you wrote, which sections it carried, and
anything you deliberately left out. Confirm the post landed — on the file route
that means the commit is pushed, and the commit message starts `Claude:` so the
Answer notes workflow does not spend a run on it.
