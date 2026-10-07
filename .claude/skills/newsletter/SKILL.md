---
name: newsletter
description: Write Gavin's Daily Brief or his Sunday weekly report onto the MBA board, as an edition he opens from the newspaper button. Run by the two Routines.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Daily Brief

Nobody asked you a question. The brief is the one thing on this board that
arrives on a clock, and the only thing allowed to say "here is where
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

It is called the **Daily Brief** on the board. The skill keeps the name
`newsletter` only because the two Routines invoke it by that name and only
Gavin can edit a Routine; nothing he reads says "newsletter" any more.

**There is no fixed set of headings, and that is deliberate.** The first
edition had four, because this skill listed four, and it filled all four
because an empty one looked like a failure. He rejected the whole thing:
*"what is this shitty ass content? A waste of time. Fucking useless content
just to force some words in. I was expecting you to be smarter as a
productivity manager - not a 10yo asking for updates."*

He then wrote a replacement — Immediate, Creeping up, Nudges — and when that
was taken as the new template he said no to that too: *"that was an example.
Do your research and make it. ... Things change and so should the newsletters
accordingly."* This is the same principle the mind map is built on (see
`CLAUDE.md`, "Each group draws itself in the shape its content wants"): **the
brief works out its own shape from what the board actually holds that
morning.**

So: decide the sections after reading the board, not before. Two days with the
same four headings and different nouns under them is the failure. Some mornings
that is one section and three lines. A morning after an INSEAD mail lands with
a hard date in it might be one section about that and nothing else.

Headings that have earned themselves on a given day, as illustration and not
as a list to work through: Immediate. Creeping up. Waiting on someone else.
Nudges. Decide this week. Money. Nothing is due, here is what to get ahead of.
Write the heading that names what the lines under it have in common; if you
cannot name it in three words, the lines do not belong together.

### What earns a place

**Every item earns a second line or it does not go in.** The item line names
the thing and when; the second line is the reason the item is in a brief
rather than on the board:

- a **question** only he can answer — his intent, a conversation he has had, a
  decision he has not made;
- a **suggestion with a specific name in it** — which platform to start with,
  which document to chase, who to call;
- something **he has not noticed** — a date that collides with another, a mail
  that arrived without the confirmation that should have followed it, a task
  you created because of it.

If the only thing you can write under an item is a restatement of its status,
leave the item out. Three to ten lines in total; it is read on a phone before
work.

**Credit what he did, by name, when the board says he did it** — one line, in
whichever section fits, read off `doneAt` or `history/`. Not "great progress":
*"Good job on registering for the platforms yesterday."*

## 2b. The four ways this goes wrong

These are the specific failures of the first edition. Check the draft against
all four before posting.

1. **Padding to fill a heading.** A heading exists because lines earned it. If
   a section has nothing, there is no section. Never write "nothing overdue".
2. **Asking him for an update.** You have the whole board, the notes, the audit
   log in `history/` and three Gmail scans a day. "Any update on X?" with
   nothing behind it is the ten-year-old. Ask about the thing the board cannot
   know, and ask it specifically.
3. **Asserting a timeline the board contradicts.** The first edition said a
   task had sat through "a week's silence" when his own note said he was
   sending the documents the next day: *"If I just sent the corrected documents
   to them tomorrow, what do you mean a week's silence?"* **Never write an
   elapsed time, a gap, a streak or "no movement since" from a feeling.** Read
   it off `touched[id]`, `doneAt`, or a dated line in `history/` — and read the
   task's own notes first, because a note saying what he is about to do makes
   any claim about silence wrong. If you cannot cite the date, do not make the
   claim; say the thing without the number.
4. **Restating the board.** He is opening the brief on the board. Anything he
   would see by looking at Overview is not news.

Read the last few editions in `news[]` before writing. Repeating yesterday's
sections with today's date is the same failure as padding.

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
padding. These four are the weekly's job rather than a template — the section
that has nothing in it a given week is still left out. §2b applies in full — the elapsed-time rule most of all,
since "has gone quiet" is a Risks line and it is exactly the claim that has to
be read off a date rather than felt.

## 3b. NEWS — the section the weekly exists for as much as Risks

Sunday carries one more heading, and this one is **not** optional in the way
the others are: `## NEWS`. He asked for it on 2026-10-07 and said why.

> *"I just realized McKinsey has a Make your mark pre-mba program which would
> have been a major bonus if I applied and got through. But I simply did not
> even know about it. The reason for this new addition is exactly this. I want
> you to research all similar opportunities, programs, etc and keep me on top
> of this so I don't miss anything."*

So the weekly run **does research**, on the open web, before it writes. It is
the one part of either edition that is not read off the board.

**What he is aiming at.** Sr. Manager of Presales at Locus.sh, five years in
SaaS, INSEAD MBA'27D (starts January 2027, graduates December 2027). Post-MBA
targets, in his own order:

1. Big Tech — LDP and management-track programmes or regular hiring at Amazon,
   Google and their peers, in product, programme, project, solutioning or
   general management.
2. Consulting — McKinsey, Bain, BCG and the tier below.
3. Consumer — J&J, Unilever and similar, on a management track or an LDP.

**What counts as a find.** A pre-MBA or in-programme opportunity with a date
and a door: a pre-MBA mentorship or immersion programme, an LDP whose
applications open on a known schedule, a competition or case programme that
is a recognised way in, a fellowship, a conference where the recruiting
actually happens. The December-2027 graduation matters: a posting whose
eligibility window is "graduating between August 2026 and August 2027" is not
his, and saying so is a finding too.

**What does not.** A generic job board. A programme he has already been told
about. Anything whose only claim is that the company is on his list. An
opportunity with no date is a line in NEWS, never a task.

**Each item is two lines at most**, in the house style: what it is, when it
closes, and the one thing he would do about it. Name the source. If a date
could not be confirmed, say that instead of rounding one up — an invented
deadline on this board is worse than a missed programme, because he will plan
around it.

**A week with nothing is written as nothing.** `## NEWS` with "Nothing new
worth your week" under it, and that is the honest and common outcome. Padding
this section is the §2b failure with a wider blast radius.

### Putting one on the board

A find that he should **definitely** do — and that is a high bar, two or three
a term, not two a week — becomes a NEWS task in `SEED`:

```js
{id:"news-<short>", t:"[NEWS] <what he does>", k:"career", s:"todo", p:"High",
  d:"<the date he must act by>", ef:"hours", nw:true,
  n:"<what it is, where the date comes from, what is unconfirmed>"}
```

- `nw:true` is the whole mechanism: it draws the task in magenta everywhere,
  puts Accept and Reject on its card, and adds the News swatch to the Timeline
  legend. The `[NEWS]` title prefix is the half of that which survives a
  screen reader and a plain-text export, so write both.
- It is an ordinary task, so it needs `d` and `ef` like any other, and it
  lands on the Calendar and the Timeline by itself.
- **Be selective.** *"Be selective about the dates you add to calendar -
  shouldn't be a spam and clutter my calendar."* A cluttered calendar is one
  he stops reading, and then the NEWS item he would have acted on is lost in
  the ones he would not.
- A SEED edit is a code change: bump `BUILD`, run `node checks/board-check.mjs`
  and push, exactly as any other change to `index.html`.
- Never reopen one he has rejected. `newsState:"reject"` is his answer, it
  travels between his devices, and putting the same thing back next Sunday is
  the board arguing with him.

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
  Together they are the title the board prints — "Daily Brief — 07 October
  2026". Do not write a title yourself; there is no `title` field to drift.
- **`body`** is plain text. The only markup is `## ` at the start of a line,
  which is a section heading. Blank lines are ignored.
- **`at` and `createdAt` are the real time now**, read off the clock. The relay
  only rings his phone for an edition less than ten minutes old, so an invented
  timestamp is a newsletter that lands silently.
- **A newsletter changes nothing**. No `changed[]`, no statuses, no dates. It
  says where things stand; it does not move them.

Posting it is what rings his phone: the relay sees a fresh `news[]` on
`/agent/reply` and sends "Gavin, today's daily brief is ready". The
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
- **No filler.** "Great progress this week" is a line he scrolls past, and it
  teaches him the rest is skimmable too. Credit in **Nudges** is different: it
  names the thing he did and the day he did it, and it is only ever one line.
- **Never invent a date, an amount or a status.** If the board does not say it,
  the newsletter does not either.

## 6. Report

Say in the run log which edition you wrote, which sections it carried, and
anything you deliberately left out. Confirm the post landed — on the file route
that means the commit is pushed, and the commit message starts `Claude:` so the
Answer notes workflow does not spend a run on it.
