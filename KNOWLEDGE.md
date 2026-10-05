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
- One `##` per category, one bullet per node, nested under its parent. The
  node's id is in backticks, which is what makes a correction possible: same
  id, new text, in both places. A node tied to a task names the task and its
  `SEED` id, so a future session can find it in `index.html`.
- **Only what he actually told us, or what a document he gave us says.**
  Inventing a fact here is worse than inventing one anywhere else on this
  board, because he will come back to it in six months and trust it.
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

## Financial

*Nothing filed yet.*

## Student Life

- **Immigration and logistics** — P0 explicitly tells you to start early on visa, housing, a bank account and a phone plan, and to register a partner if you have one. — task: Complete MyINSEAD profile and practical info `portal` `k-visa`
- **MyINSEAD** — Profile, INSEAD email and practical information due by 22 October 2026. The email has to exist before then; the how-to was in the acceptance email. — task: Complete MyINSEAD profile and practical info `portal` `k-myinsead` (see also: `k-news`)
  - **Newsletters** — Every Sunday. From 25 October they go only to the INSEAD address, so an email that is not set up means missing them. — task: INSEAD email provisioned `insead-mail` `k-news`
- **Optional P0 sessions** — IAA Alumni Meet & Greet 28 October, AMA on student platforms 10 November. Both optional. `k-p0life`
- **Student clubs** — Introduction and registration from 26 October through the LMS. Club leadership elections and the handover to 27Ds come in P1-P2. `k-clubs` (see also: `k-takeaways`)
  - **Student Council** — 27D Student Council and Student Representative elections in January 2027. Team diversity is required. `k-council`
- **Who to email** — degree.programmes@insead.edu for programme questions, careerdevelopmentcentre@insead.edu for CDC. `k-contacts`

## Academics

- **Academics Overview webinar** — 26 November, Zoom. The MBA Programme Management Director and current students on the curriculum and how to prepare. Highly recommended. — task: Academics overview webinar `acad-webinar` `k-acadweb`
- **Business Foundations** — One week online, 16-20 November, intensive intro to Financial Accounting, Finance and Quantitative Methods for people without a quant background. Optional. Registration via MyINSEAD by 30 October. — task: Decide on Business Foundations and register `bizfound` `k-bizfound`
- **Exemption exams** — P1 core exemptions are examined in Launch Week; P2 and P3 exemptions during P1. Passing one frees a slot for an elective. `k-exempt`
- **LMS** — Live from 26 October. All academic content goes through it, and some of the CDC curriculum too. Club registration also runs on it. — task: Work through the LMS tutorials `lms-start` `k-lms`
- **P0** — The pre-programme period, 26 Oct 2026 to 17 Jan 2027. Three pillars: Academics, Careers, Student Life. The point is to hit P1 running. `k-p0`
  - **Prioritisation** — INSEAD's own framing: everything on offer adds value but you cannot do it all. Items are marked Must do, Highly recommended or Optional, and CDC and PLDP are the high-importance must-dos. `k-prio`
- **PLDP** — Personal Leadership Development Programme. Individual and group coaching that runs the whole year, starting with P0 assignments. `k-pldp` (see also: `k-cdc`)
  - **Intro webinar** — 5 November, Zoom. Clarifies the assignments. Marked MUST DO. — task: PLDP webinar `pldp-webinar` `k-pldp-web`
  - **P0 assignments** — 6 Nov to 28 Dec 2026, online on the LMS. Marked MUST DO. They are what your coach reads before meeting you, so they shape the coaching you get. — task: Complete the PLDP assignments `pldp-work` `k-pldp-p0`
- **Programme calendar** — P1 18 Jan-10 Mar 27, P2 15 Mar-4 May 27, P3 10 May-30 Jun 27, P4 23 Aug-12 Oct 27, P5 18 Oct-4 Dec 27. Dates may still change. `k-cal`
  - **Breaks** — 11-14 Mar, 5-9 May, summer 1 Jul-22 Aug, 13-17 Oct. Career and club treks run in the short ones. `k-breaks` (see also: `k-intern`)
  - **Campus exchange** — Bidding for P3-P5 exchange happens during P1. Rules can change. `k-exchange`
  - **Graduation** — Singapore, 15 Dec 2027, grad trip after. Campus is FBL or SGP in P1-P2; exchange opens from P3. `k-grad`
  - **Launch Week** — 7-17 Jan 2027. P1 core course exemption exams sit inside it, along with a lot of other sessions. `k-launch` (see also: `k-exempt`, `k-launchprep`)
  - **P1 core courses** — Six: Financial Accounting, Financial Markets & Valuation, Organisational Behaviour I, Prices & Markets, Uncertainty Data & Judgment, Introduction to Strategy. `k-p1cores`
    - **P1 pre-readings** — For Financial Accounting and Prices & Markets. Book recommendations are on the MBA Journey pages. Highly recommended, not required. — task: INSEAD pre-course work and pre-reading `prereads` `k-prereads`

## Career

- **CDC** — The Career Development Centre. Two teams behind you: a Career Coach and the Employer Engagement team. `k-cdc`
  - **CDC's key takeaways** — Networking is what works: alumni, target industry, classmates. Pick a few priorities rather than defaulting to consulting. Take a leadership role in a club. A radical career changer should start before the programme, and if targeting one country with no experience there, explore everything early and aim at easier roles given local competition. Be authentic and only apply where you genuinely fit. `k-takeaways`
  - **Career Coach** — Your primary contact all year. Career strategy, target and transferable skills, networking approach, CV and cover letter review, elevator pitch, mock interviews, choosing between offers, and holding you accountable. `k-coach`
    - **CareerLeader and Career Anchors** — Two questionnaires to finish before the first coaching session, plus the workbook questions. They are the raw material for that session. — task: Do the CareerLeader and Career Anchors questionnaires `cdc-quests` `k-quest`
    - **Coach allocation** — Allocated on your P1 location, follows you the whole MBA, deliberately coach-agnostic, and there are no coach changes. `k-coach-alloc`
    - **Coaching sessions** — 45 minutes, so they fit before class. You set the agenda, bring the update and agree the next steps; the coach pressure-tests and plans. Turning up without homework wastes the slot. `k-coach-ses`
    - **First coaching session** — From November. Covers how the partnership works, what the profiling tools said, and the steps of the career journey. — task: Book the first CDC coaching session `cdc-coach1` `k-coach1`
  - **Career switcher status** — Most CDC items are marked must-do for career switchers by Location, Sector or Function and only highly recommended for everyone else. Which of the three you are switching decides how much of this is optional. — task: Write down post-MBA function, industry, geography `postmba` `k-switcher`
  - **CareerGlobe** — The CDC platform, live from 27 October. Your profile has to be set up before you can book the first coaching appointment. — task: Set up CareerGlobe profile `careerglobe` `k-careerglobe`
  - **Company events and treks** — Pre-MBA company event invitations arrive through the newsletters. Treks, networking forums, the Tech Symposium and the Industry Expert Series run through the year. `k-events`
  - **Employer Engagement** — Sector Advisors: subject-matter experts who spend half their time advising students and half talking to companies. Market intelligence, who to connect with, sharpening your pitch for a sector, and help with offer negotiation. `k-ee`
    - **Careers Across Geographies & Sectors** — February 2027 workshop for FBL and SGP. CDC asks 27Ds not to book Sector Advisor appointments until after it, because most sector information is delivered there. The one exception is early internship application roles. `k-cags` (see also: `k-intern`)
  - **P0 career webinars** — Three. Let's Start Your Career Journey (2 Oct, done), INSEAD CV & Cover Letter Tips (13 Nov), Your Summer Experience & Prep for Arrival (4 Dec). Must-do for career switchers. `k-webinars`
    - **CV & Cover Letter webinar** — Friday 13 November 2026, 13:00 Paris / 20:00 Singapore. What to put in and what to leave out, and when you work on the CV during the year. — task: INSEAD CV and cover letter webinar `cv-webinar` `k-cvweb`
    - **Summer Experience webinar** — 4 December. The options for the summer break: 8-week internships, a startup tour, or time off to prepare for recruitment. — task: Summer experience webinar `summer-webinar` `k-sumweb` (see also: `k-intern`)
  - **The career journey** — Three stages: Self Awareness (strengths, interests, values, what you bring), Market Exploration (industry knowledge through networking, turn ideas into 2-3 target plans), Execution (a value proposition, and recruiting to each sector's real timetable). — task: Write down post-MBA function, industry, geography `postmba` `k-journey`
  - **Who does the work** — CDC's framing, stated plainly: they coach, you play. You do the networking, build the relationships, articulate your value, front the interviews and hold yourself accountable. The employer is buying you. `k-partnership`
- **INSEAD CV** — One INSEAD format, used as a networking and marketing document, and the basis for the INSEAD CV Book. The CV process runs on through P1. — task: Rebuild CV in INSEAD format `cv` `k-cvbook` (see also: `k-vmock`)
- **Launch Week career pre-work** — Available on the LMS in early December, to be done before Launch Week. — task: Pre-work for the Launch Week career workshop `launch-prework` `k-launchprep`
- **Summer internship** — Optional. An 8-week Short-Term Summer Project in the 1 Jul - 22 Aug break after P3; the alternatives are a startup tour or time off. Gavin's own plan is to start looking from the day the course starts and prepare accordingly. `k-intern` (see also: `k-breaks`, `k-interntiming`, `k-sumweb`)
  - **Internship timetable** — Internship recruitment activities run through P2 (Mar-May 27). Some internships can start as early as June 2027, before P3 finishes. Early internship application roles are the one reason to contact Employer Engagement before the February workshop. `k-interntiming` (see also: `k-cags`)
- **VMock** — The CV tool in Part 1 of the INSEAD CV process. It scores a draft and says what to fix before a human sees it. — task: Activate VMock CV platform access `vmock` `k-vmock` (see also: `k-cvbook`)

## Unfiled

*Nothing filed yet.*
