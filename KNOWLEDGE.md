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
- **One `##` per group, and a group names what a thing is** — Webinars and
  sessions, Deadlines, Platforms and tools. Not Academics / Career / Student
  Life: he threw that version out in those words, and the groups here are the
  same strings the `group` field carries, so the two copies read alike.
- One bullet per node: the label, then the date, then the line underneath. The
  node's id is in backticks, which is what makes a correction possible: same
  id, new text, in both places. A node tied to a task names the task and its
  `SEED` id, so a future session can find it in `index.html`.
- **Only what he actually told us, or what a document he gave us says.**
  Inventing a fact here is worse than inventing one anywhere else on this
  board, because he will come back to it in six months and trust it.
- **Nothing that is already done, and nothing with nothing to act on.** Eight
  nodes went on 2026-10-05 for exactly that: MyINSEAD and the newsletters (both
  tasks Done), "P0 tells you to start early on visa and housing" (he is already
  doing it), and the framing nodes that restated INSEAD's own motivation.
- **This repository is public.** No account, passport, visa, loan or reference
  numbers, ever.

## Where this came from

Seeded on 2026-10-05 from two decks he shared, and nothing else:

- **P0 intro 27D** — the 24 September 2026 P0 introduction session: the
  programme calendar, the P0 checklist with its Must do / Highly recommended /
  Optional ratings, and the Academics, Careers and Student Life tables.
- **P0 Webinar 1 — Your Career Journey 27D** — the 2 October 2026 CDC webinar:
  how CDC works, the coaching model, the three-stage journey, the P0 career
  checklist and CDC's own key takeaways.

He added one thing himself, and the decks agree with it: the summer internship
is optional and sits in the 8-week break after P3, and his plan is to start
looking from the day the course starts. A couple of web sources describe that
internship as obligatory for the January intake; the 27D decks do not, and they
are the authority for his cohort, so the map follows them.


## Webinars and sessions

- **IAA Alumni Meet & Greet** — 28 October 2026 — Optional. The alumni association's own introduction session. `k-iaa`
- **PLDP intro webinar** — 05 November 2026 — Zoom. Clarifies the P0 leadership assignments and how the coaching year works. INSEAD marks it MUST DO. — task: PLDP webinar `pldp-webinar` `k-pldp-web` (see also: `k-pldp`)
- **AMA on student platforms** — 10 November 2026 — Optional. Open questions on the LMS, CareerGlobe and the rest. `k-ama`
- **INSEAD CV & Cover Letter webinar** — 13 November 2026 — 13:00 Paris / 20:00 Singapore. What goes in the INSEAD format and what stays out, and when the CV work happens during the year. — task: INSEAD CV and cover letter webinar `cv-webinar` `k-cvweb` (see also: `k-cvbook`)
- **Academics overview webinar** — 26 November 2026 — Zoom, with the MBA Programme Management Director and current students: the curriculum and how to prepare. Highly recommended. — task: Academics overview webinar `acad-webinar` `k-acadweb`
- **Your Summer Experience & Prep for Arrival webinar** — 04 December 2026 — The three ways to spend the summer break -- an 8-week internship, a startup tour, or time off to prepare for recruitment. — task: Summer experience webinar `summer-webinar` `k-sumweb` (see also: `k-intern`)

## Deadlines

- **Business Foundations: register by 30 October** — 30 October 2026 — One week online, 16-20 November. Intensive intro to Financial Accounting, Finance and Quantitative Methods for people without a quant background. Optional, registered through MyINSEAD. — task: Decide on Business Foundations and register `bizfound` `k-bizfound`
- **CareerLeader and Career Anchors, before the first coaching session** — Before November 2026 — Two questionnaires plus the workbook questions. They are the raw material for that first session, so turning up without them wastes the slot. — task: Do the CareerLeader and Career Anchors questionnaires `cdc-quests` `k-quest`
- **PLDP assignments window** — 06 Nov - 28 Dec 2026 — Online on the LMS. Your coach reads these before meeting you, so they shape the coaching you get. MUST DO. — task: Complete the PLDP assignments `pldp-work` `k-pldp-p0` (see also: `k-pldp`)
- **Launch Week career pre-work appears on the LMS** — Early December 2026 — To be done before Launch Week, not during it. — task: Pre-work for the Launch Week career workshop `launch-prework` `k-launchprep`

## Programme calendar

- **Launch Week** — 07 - 17 January 2027 — Fontainebleau. The P1 core exemption exams sit inside it, alongside a lot of other sessions. `k-launch` (see also: `k-exempt`)
- **Period dates, P1 to P5** — 18 Jan - 4 Dec 2027 — P1 18 Jan-10 Mar 27, P2 15 Mar-4 May 27, P3 10 May-30 Jun 27, P4 23 Aug-12 Oct 27, P5 18 Oct-4 Dec 27. INSEAD says these can still move. `k-cal`
- **Campus exchange bidding happens during P1** — P1, Jan - Mar 2027 — Exchange runs P3-P5; campus is Fontainebleau or Singapore for P1-P2. The rules can change year to year. `k-exchange`
- **Breaks** — Mar / May / Jul-Aug / Oct 2027 — 11-14 Mar, 5-9 May, summer 1 Jul-22 Aug, 13-17 Oct. Career and club treks run in the short ones. `k-breaks` (see also: `k-intern`)
- **Graduation, Singapore** — 15 December 2027 — Grad trip after. `k-grad`

## Platforms and tools

- **LMS goes live** — 26 October 2026 — All academic content runs through it, some of the CDC curriculum too, and club registration as well. — task: Work through the LMS tutorials `lms-start` `k-lms`
- **CareerGlobe goes live** — 27 October 2026 — The CDC platform. The profile has to be set up before the first coaching appointment can be booked. — task: Set up CareerGlobe profile `careerglobe` `k-careerglobe`
- **One INSEAD CV format, and the CV Book** — Used as a networking and marketing document, and the basis for the INSEAD CV Book. The process runs on through P1. — task: Rebuild CV in INSEAD format `cv` `k-cvbook` (see also: `k-vmock`)
- **VMock scores a CV draft** — Part 1 of the INSEAD CV process: it scores the draft and says what to fix before a human reads it. — task: Activate VMock CV platform access `vmock` `k-vmock` (see also: `k-cvbook`)

## Coaching: CDC and PLDP

- **First coaching session, from November** — November 2026 — Covers how the partnership works, what the profiling tools said, and the steps of the career journey. — task: Book the first CDC coaching session `cdc-coach1` `k-coach1` (see also: `k-quest`)
- **Careers Across Geographies & Sectors workshop** — February 2027 — For Fontainebleau and Singapore. CDC asks 27Ds not to book Sector Advisor appointments until after it, because most sector information is delivered there -- the one exception being early internship application roles. `k-cags` (see also: `k-interntiming`)
- **CDC's own key takeaways** — Networking is what works: alumni, target industry, classmates. Pick a few priorities rather than defaulting to consulting. Take a leadership role in a club. A radical career changer should start before the programme. Only apply where you genuinely fit. `k-takeaways`
- **Career switcher status decides how much of CDC is must-do** — Most CDC items are must-do for people switching Location, Sector or Function and only highly recommended for everyone else. — task: Write down post-MBA function, industry, geography `postmba` `k-switcher`
- **Coaching sessions are 45 minutes and you set the agenda** — Short enough to fit before class. You bring the update and agree the next steps; the coach pressure-tests and plans. `k-coach-ses` (see also: `k-quest`)
- **Company events, treks and the Industry Expert Series** — Pre-MBA company event invitations arrive through the Sunday newsletters. Treks, networking forums and the Tech Symposium run through the year. `k-events`
- **Employer Engagement are Sector Advisors** — Subject-matter experts who spend half their time advising students and half talking to companies: market intelligence, who to connect with, sharpening a sector pitch, and offer negotiation. `k-ee` (see also: `k-cags`)
- **PLDP runs the whole year, not just P0** — Personal Leadership Development Programme: individual and group coaching, starting with the P0 assignments and continuing across the periods. `k-pldp` (see also: `k-pldp-p0`)
- **The career journey is three stages** — Self Awareness (strengths, interests, values), Market Exploration (industry knowledge through networking, narrowed to 2-3 target plans), Execution (a value proposition, recruiting to each sector's real timetable). — task: Write down post-MBA function, industry, geography `postmba` `k-journey`
- **Two teams behind you: a Career Coach and Employer Engagement** — That is the whole of CDC's structure. The coach is your primary contact; Employer Engagement is the sector expertise. `k-cdc` (see also: `k-coach-ses`, `k-ee`)
- **Your coach is allocated on P1 location and never changes** — Deliberately coach-agnostic, follows you the whole MBA, and there are no coach changes. `k-coach-alloc`

## The summer internship

- **Recruiting runs through P2, and some internships start in June** — Mar - May 2027 — Early internship application roles are the one reason to contact Employer Engagement before the February workshop. `k-interntiming` (see also: `k-cags`)
- **Optional, 8 weeks in the break after P3** — 01 Jul - 22 Aug 2027 — A Short-Term Summer Project; the alternatives are a startup tour or time off to prepare for recruitment. Gavin's own plan is to start looking from the day the course starts. `k-intern` (see also: `k-interntiming`, `k-sumweb`)

## Courses and exemptions

- **Core exemption exams** — Launch Week, Jan 2027 — P1 exemptions are examined in Launch Week; P2 and P3 exemptions during P1. Passing one frees a slot for an elective. `k-exempt` (see also: `k-launch`)
- **Pre-readings for Financial Accounting and Prices & Markets** — Book recommendations are on the MBA Journey pages. Highly recommended, not required. — task: INSEAD pre-course work and pre-reading `prereads` `k-prereads`
- **Six P1 core courses** — Financial Accounting, Financial Markets & Valuation, Organisational Behaviour I, Prices & Markets, Uncertainty Data & Judgment, Introduction to Strategy. `k-p1cores`

## Clubs and elections

- **Club introduction and registration, on the LMS** — From 26 October 2026 — Club leadership elections and the handover to 27Ds come in P1-P2. `k-clubs` (see also: `k-lms`)
- **27D Student Council and Student Rep elections** — January 2027 — Team diversity is a requirement. `k-council`

## Who to contact

- **Who to email** — degree.programmes@insead.edu for programme questions, careerdevelopmentcentre@insead.edu for CDC. `k-contacts`
