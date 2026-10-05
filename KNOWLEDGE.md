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
  same strings the `group` field carries, so the two copies read alike. The
  heading also names the group's `shape`, which is how it draws.
- One bullet per node: the label, then the date, then the paragraph. The node's
  id is in backticks, which is what makes a correction possible: same id, new
  text, in both places. A node tied to a task names the task and its `SEED` id,
  so a future session can find it in `index.html`.
- **The body is a paragraph, not a clause.** *"Don't be so brief on the details
  sub-text."* Two or three sentences that say what the thing is, when it bites
  and what it changes. A line that only restates the title is not a body.
- **Only what he actually told us, or what a document he gave us says.**
  Inventing a fact here is worse than inventing one anywhere else on this
  board, because he will come back to it in six months and trust it.
- **Nothing that is already done, and nothing with nothing to act on.** Eight
  nodes went on 2026-10-05 for exactly that: MyINSEAD and the newsletters (both
  tasks Done), "P0 tells you to start early on visa and housing" (he is already
  doing it), and the framing nodes that restated INSEAD's own motivation.
- **This repository is public.** No account, passport, visa, loan or reference
  numbers, ever.

## How a group draws itself

`shape` is a field on the node and the group takes it from its first node. He
asked for this directly: *"each block might be best displayed in a completely
different way. The academic schedule might be better displayed as a mini
simplied calender infographic. The timelines might be better depicted as a
vertical timeline with dots representing each items."*

- **`calendar`** — a month axis with a bar per span. Every `rows[]` in the
  group is pooled onto one axis, so periods, breaks and single dates share a
  scale. A row is `{t,a,b,k}`: `t` the label, `a`/`b` ISO dates, `k` one of
  `period`, `break`, `point`. The prose still reads under the chart, because a
  bar says when and never why.
- **`timeline`** — a vertical rail with a dot per item, in date order. A dot
  whose date has passed is hollow, so where he is in the sequence is derived
  rather than stored.
- **`cards`** — a grid, for peers where nothing is a sequence.
- **`list`** — the default, for prose facts.

An unrecognised shape falls back to `list`, so a future Claude can name one
before the view has learned it.

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
*Draws as: `timeline`*

- **IAA Alumni Meet & Greet** — 28 October 2026 — The INSEAD Alumni Association's own introduction to the network: who they are, what the regional chapters do, and how alumni actually get used during and after the MBA. Optional in INSEAD's own rating, and the one P0 session that is about the twenty years after the degree rather than the year of it. `k-iaa`
- **PLDP intro webinar** — 05 November 2026 — On Zoom. Walks through the Personal Leadership Development Programme: what the P0 assignments ask for, how individual and group coaching fit together across the year, and what your coach does with what you write. INSEAD marks this MUST DO, and it is the session that makes the assignment window make sense rather than feel like homework. — task: PLDP webinar `pldp-webinar` `k-pldp-web` (see also: `k-pldp`, `k-pldp-p0`)
- **AMA on student platforms** — 10 November 2026 — An open question session on the tools you are about to live in: the LMS, CareerGlobe, and the rest of the stack. Optional, and worth it only if something in the platforms is already confusing you by then. `k-ama` (see also: `k-lms`, `k-careerglobe`)
- **INSEAD CV & Cover Letter webinar** — 13 November 2026 — 13:00 Paris / 20:00 Singapore. What belongs in the INSEAD CV format and what gets cut, how recruiters read it, and where the CV work sits in the year: a first draft through VMock before a human sees it, then review with your coach, and the CV Book after that. Must-do for career switchers. — task: INSEAD CV and cover letter webinar `cv-webinar` `k-cvweb` (see also: `k-cvbook`, `k-vmock`)
- **Academics overview webinar** — 26 November 2026 — On Zoom, with the MBA Programme Management Director and current students. The curriculum end to end, how the core and electives fit, exemptions, and what people wish they had done before arriving. Highly recommended rather than required, and the one place to ask a second-hand question about workload. — task: Academics overview webinar `acad-webinar` `k-acadweb` (see also: `k-p1cores`, `k-exempt`)
- **Your Summer Experience & Prep for Arrival** — 04 December 2026 — The three honest ways to spend the eight-week break after P3: a short-term summer project with a company, a startup tour, or deliberate time off to prepare for full-time recruitment. Also covers arrival logistics. This is the session that decides what you spend P2 recruiting for. — task: Summer experience webinar `summer-webinar` `k-sumweb` (see also: `k-intern`, `k-interntiming`)

## Deadlines  
*Draws as: `timeline`*

- **Business Foundations: register by 30 October** — Register by 30 October 2026 — The course itself runs one week online, 16-20 November: an intensive introduction to Financial Accounting, Finance and Quantitative Methods aimed at people arriving without a quant background. Optional, registered through MyINSEAD, and the decision has to be made three weeks before it runs. — task: Decide on Business Foundations and register `bizfound` `k-bizfound` (see also: `k-p1cores`)
- **CareerLeader and Career Anchors, before the first coaching session** — Before November 2026 — Two profiling questionnaires plus the workbook questions that go with them. They are the entire raw material for the first coaching conversation, so the session is only as good as what you put in: arriving without them turns a 45-minute slot into an introduction you could have had by email. — task: Do the CareerLeader and Career Anchors questionnaires `cdc-quests` `k-quest` (see also: `k-coach1`, `k-coach-ses`)
- **PLDP assignments window** — 06 Nov - 28 Dec 2026 — Delivered online through the LMS across roughly seven weeks. Your coach reads these before meeting you, so they are what shapes the coaching you get rather than a box to tick. INSEAD marks them MUST DO, and the window deliberately spans the December break because they are not a single sitting. — task: Complete the PLDP assignments `pldp-work` `k-pldp-p0` (see also: `k-pldp`, `k-pldp-web`)
- **Launch Week career pre-work appears on the LMS** — Early December 2026 — Posted in early December, to be completed before Launch Week rather than during it. Launch Week is dense enough that anything left undone gets done badly or not at all, and the career workshop assumes the pre-work is behind you. — task: Pre-work for the Launch Week career workshop `launch-prework` `k-launchprep` (see also: `k-launch`)

## Programme calendar  
*Draws as: `calendar`*

- **P0, the pre-programme period** — 26 Oct 2026 - 17 Jan 2027 — Where the board is right now: the twelve weeks between the LMS going live and Launch Week. Three strands run through it at once -- Academics, Careers and Student Life -- and almost everything in the Webinars and Deadlines blocks sits inside this stretch. It ends the day Launch Week begins. Spans: P0 2026-10-26–2027-01-17 (period). `k-p0span` (see also: `k-launch`)
- **Launch Week** — 07 - 17 January 2027 — Fontainebleau, eleven days. The P1 core exemption exams sit inside it along with orientation, the career workshop and the first run of sessions that set up P1. The pre-work that goes with it lands on the LMS in early December. Spans: Launch Week 2027-01-07–2027-01-17 (period). `k-launch` (see also: `k-exempt`, `k-launchprep`)
- **Period dates, P1 to P5** — 18 Jan - 4 Dec 2027 — Five eight-week periods across eleven months, with a long summer gap in the middle. INSEAD publishes these as provisional and says they can still move, so treat anything booked around the edges as provisional too. Spans: P1 2027-01-18–2027-03-10 (period); P2 2027-03-15–2027-05-04 (period); P3 2027-05-10–2027-06-30 (period); P4 2027-08-23–2027-10-12 (period); P5 2027-10-18–2027-12-04 (period). `k-cal`
- **Campus exchange bidding happens during P1** — Bid during P1, Jan - Mar 2027 — Campus is Fontainebleau or Singapore for P1 and P2; exchange opens from P3 onwards, and the bidding for it runs inside P1 while you are still finding your feet. The rules change year to year, so the P1 briefing is the authority rather than anything written now. `k-exchange`
- **Breaks** — Mar / May / Jul-Aug / Oct 2027 — Three short ones and the long summer. The short breaks are not empty: career treks and club treks run in them, which is most of what people mean when they say the MBA has no holidays. The 1 July to 22 August gap is the one the summer project fits inside. Spans: Break 2027-03-11–2027-03-14 (break); Break 2027-05-05–2027-05-09 (break); Summer 2027-07-01–2027-08-22 (break); Break 2027-10-13–2027-10-17 (break). `k-breaks` (see also: `k-intern`)
- **Graduation, Singapore** — 15 December 2027 — Singapore campus, with the grad trip after it. Twenty-three months from the deposit to the gown. Spans: Graduation 2027-12-15 (point). `k-grad`

## Platforms and tools  
*Draws as: `cards`*

- **LMS** — Live 26 October 2026 — Live from 26 October. Every piece of academic content runs through it, a chunk of the CDC curriculum as well, and club registration too. The PLDP assignments are delivered here. — task: Work through the LMS tutorials `lms-start` `k-lms` (see also: `k-pldp-p0`, `k-clubs`)
- **CareerGlobe** — Live 27 October 2026 — Live from 27 October. The CDC platform: appointments, jobs, events. The profile has to be set up before you can book the first coaching appointment, which makes it the gate on everything else CDC. — task: Set up CareerGlobe profile `careerglobe` `k-careerglobe` (see also: `k-coach1`)
- **The INSEAD CV format** — One format, used as a networking and marketing document rather than a record of employment, and the basis for the INSEAD CV Book that goes to recruiters. The process runs on through P1, so the first version is not the last. — task: Rebuild CV in INSEAD format `cv` `k-cvbook` (see also: `k-vmock`, `k-cvweb`)
- **VMock** — Part 1 of the INSEAD CV process. It scores a draft against the format and tells you what to fix, so the version a human finally reads is not the first one you wrote. — task: Activate VMock CV platform access `vmock` `k-vmock` (see also: `k-cvbook`, `k-cvweb`)

## Coaching: CDC and PLDP  
*Draws as: `list`*

- **First coaching session, from November** — From November 2026 — Covers how the partnership works, what CareerLeader and Career Anchors said about you, and the three stages of the career journey. CareerGlobe has to be set up before you can book it. — task: Book the first CDC coaching session `cdc-coach1` `k-coach1` (see also: `k-quest`, `k-careerglobe`)
- **Careers Across Geographies & Sectors workshop** — February 2027 — February 2027, for Fontainebleau and Singapore. CDC asks 27Ds not to book Sector Advisor appointments until after it, because most of the sector information is delivered there and a one-to-one before it just repeats the workshop. The one exception is roles with early internship application deadlines. `k-cags` (see also: `k-ee`, `k-interntiming`)
- **CDC's own key takeaways** — Networking is what works: alumni first, then people in the target industry, then classmates. Pick a few priorities rather than defaulting to consulting because it recruits loudest. Take a leadership role in a club. A radical career changer should start before the programme, not in P1. If you are targeting one country with no experience there, explore widely early and aim at roles where local competition is thinner. And only apply where you genuinely fit, because the interview exposes the rest. `k-takeaways` (see also: `k-journey`)
- **Career switcher status decides how much of CDC is must-do** — Most CDC items are marked must-do for people switching Location, Sector or Function, and only highly recommended for everyone else. Which of the three you are switching is therefore the single input that sets your CDC workload, and it is worth writing down early. — task: Write down post-MBA function, industry, geography `postmba` `k-switcher`
- **Coaching sessions are 45 minutes and you set the agenda** — Short enough to fit before class, which is deliberate. You bring the update and the question and agree the next steps; the coach pressure-tests the plan rather than making it. A session you arrive at without having done the last set of next steps is a session spent recapping. `k-coach-ses` (see also: `k-quest`, `k-coach1`)
- **Company events, treks and the Industry Expert Series** — Pre-MBA company event invitations arrive through the Sunday newsletters, which is the practical reason to read them. During the year there are treks, networking forums, the Tech Symposium and the Industry Expert Series. `k-events`
- **Employer Engagement are Sector Advisors** — Subject-matter experts who split their time between advising students and talking to companies, which is what makes their market read current. They give market intelligence, name who to connect with, sharpen a pitch for a specific sector, and help with offer negotiation. `k-ee` (see also: `k-cags`)
- **PLDP runs the whole year, not just P0** — The Personal Leadership Development Programme: individual and group coaching that starts with the P0 assignments and continues across the periods. It is the leadership counterpart to CDC's career coaching, and it is the one INSEAD flags as high-importance alongside CDC. `k-pldp` (see also: `k-pldp-p0`, `k-pldp-web`)
- **The career journey is three stages** — Self Awareness: strengths, interests, values, and what you actually bring. Market Exploration: industry knowledge built through networking, narrowed to two or three target plans rather than one bet or ten. Execution: a value proposition you can say out loud, and recruiting to each sector's real timetable, which differs by months. — task: Write down post-MBA function, industry, geography `postmba` `k-journey` (see also: `k-takeaways`)
- **Two teams behind you: a Career Coach and Employer Engagement** — That is the whole of CDC's structure, and it is worth knowing which one to ask. The coach is your primary contact for strategy, materials and accountability. Employer Engagement are the sector specialists who know what a given industry is actually hiring for this year. `k-cdc` (see also: `k-coach-ses`, `k-ee`)
- **Your coach is allocated on P1 location and never changes** — Deliberately coach-agnostic: they are allocated by where you start, follow you the whole MBA including exchange, and there are no coach changes. So the relationship is worth investing in early rather than shopping around. `k-coach-alloc`

## The summer internship  
*Draws as: `timeline`*

- **Internship recruiting runs through P2** — Mar - May 2027 — March to May 2027. Some internships start as early as June, before P3 finishes. Roles with early application deadlines are the one reason to approach Employer Engagement before the February workshop. `k-interntiming` (see also: `k-cags`)
- **The summer project itself: optional, 8 weeks** — 01 Jul - 22 Aug 2027 — A Short-Term Summer Project in the break after P3. The alternatives INSEAD names are a startup tour or deliberate time off to prepare for full-time recruitment, and it does not treat the internship as obligatory for this cohort. Gavin's own plan is to start looking from the day the course starts rather than waiting for P2. `k-intern` (see also: `k-interntiming`, `k-sumweb`, `k-breaks`)

## Courses and exemptions  
*Draws as: `cards`*

- **Core exemption exams** — Launch Week, Jan 2027 — P1 core exemptions are examined during Launch Week; P2 and P3 exemptions are taken during P1. Passing one frees the slot for an elective, so an exemption is worth a course you would rather take than a week of revision saved. `k-exempt` (see also: `k-launch`)
- **P1 pre-readings** — For Financial Accounting and Prices & Markets specifically, with book recommendations on the MBA Journey pages. Highly recommended rather than required, which in practice means the people who do them have an easier first three weeks. — task: INSEAD pre-course work and pre-reading `prereads` `k-prereads` (see also: `k-p1cores`)
- **Six P1 core courses** — Financial Accounting, Financial Markets & Valuation, Organisational Behaviour I, Prices & Markets, Uncertainty Data & Judgment, and Introduction to Strategy. Three of the six are quantitative, which is what Business Foundations exists for. `k-p1cores` (see also: `k-bizfound`, `k-prereads`)

## Clubs and elections  
*Draws as: `timeline`*

- **Club introduction and registration** — From 26 October 2026 — Runs through the LMS from 26 October. Club leadership elections and the handover to the 27D cohort come in P1 and P2, so the clubs you join now are the ones you can take a leadership role in later, which CDC names as one of its key takeaways. `k-clubs` (see also: `k-lms`, `k-takeaways`)
- **27D Student Council and Student Rep elections** — January 2027 — January 2027. Team diversity is a stated requirement for the slates, so the teams form before the election rather than after it. `k-council`

## Who to contact  
*Draws as: `cards`*

- **Career questions** — careerdevelopmentcentre@insead.edu for CDC: coaching, CareerGlobe, Employer Engagement, anything career. `k-contact-cdc` (see also: `k-cdc`)
- **Programme questions** — degree.programmes@insead.edu for anything about the programme itself: dates, registration, admin, documents. `k-contacts`
