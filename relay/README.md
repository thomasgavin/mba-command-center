# relay — the board's little server

It started as a mailman. The board is a static page, so it cannot commit to this
repo by itself, and a credential in the browser was the thing to avoid: WebKit
drops script-writable storage after about a week without a visit, which on an
iPhone means pasting a GitHub token in again, forever. The Worker holds the
token instead, and nothing secret reaches either device.

It is now also the board's **memory and loudspeaker**. It keeps the last 7 days
of chat and board edits as a numbered, append-only log, hands every device an
open WebSocket, and pushes each new event down it. A note typed on the laptop
appears on the phone as it is typed; a reply from the GitHub job appears the
moment the job writes it. Chat no longer passes through git at all, apart from
one archive commit a day so the history survives this Worker being deleted.

## Why a Durable Object

A plain Worker cannot push. Two requests to the same Worker land in different
isolates with no way to reach each other, so a reply written by the GitHub job
could never find the socket the phone is holding. A Durable Object is the one
place they can meet.

SQLite backed, because that is the only kind Cloudflare's free plan allows, and
sockets are accepted with `acceptWebSocket` rather than `accept`: the standard
API bills for the whole time a socket is open, which for a board left on a desk
all day is the difference between free and not.

## What it costs

Nothing. The free plan allows 100,000 Durable Object requests a day and 13,000
GB-s of compute, and an idle socket hibernates, so it costs nothing while it
waits. A few notes a day is a rounding error against that.

## Setting it up

**1. A GitHub token for the Worker to use.**

At <https://github.com/settings/personal-access-tokens/new>:

- Token name: `MBA note relay`
- Expiration: your choice. The Worker keeps working until this lapses, and
  renewing means pasting a new value into one Cloudflare field.
- Resource owner: your own account
- Repository access: **Only select repositories** → `mba-command-center`
- Permissions → Repository permissions → **Contents: Read and write**. Leave
  everything else on No access.

Copy the `github_pat_…` value. GitHub shows it once.

**2. Deploying the Worker.**

Not by pasting into the dashboard any more. A Durable Object namespace is
created by a deploy, not by a dashboard field, so `wrangler` has to do it.
Either way is one-off; after that `.github/workflows/relay.yml` redeploys on
every push that touches `relay/`.

*From CI, which is the one to pick* — add two repository secrets at
**Settings → Secrets and variables → Actions**:

- `CLOUDFLARE_API_TOKEN` — <https://dash.cloudflare.com/profile/api-tokens>,
  **Create Token** → use the **Edit Cloudflare Workers** template.
- `CLOUDFLARE_ACCOUNT_ID` — the Account ID on the Workers overview page.

Then **Actions → Deploy relay → Run workflow**.

*Or from a Mac*, once:

```sh
cd relay && npx wrangler@4 login && npx wrangler@4 deploy
```

**3. The Worker's own secrets — as repository secrets, not in the dashboard.**

Add these at **Settings → Secrets and variables → Actions** alongside the two
above. The deploy pushes them onto the Worker every time it runs:

- `RELAY_GH_TOKEN` — the GitHub token from step 1. It becomes `GH_TOKEN` on the
  Worker.
- `RELAY_AGENT_KEY` — any long random string. It becomes `AGENT_KEY` on the
  Worker, and the Answer-notes job reads the same repository secret, so the two
  ends match by construction. This one is genuinely secret: it is the only
  thing that can read the whole conversation or write a message as Claude.

Setting them in the Cloudflare dashboard works too, but do not do only that.
`GH_TOKEN` was added by hand and then answered `401 Bad credentials` after the
first deploy from CI, and the symptom was a relay that accepted every note and
silently never asked for a run. Keeping them here makes the Worker reproducible
and a deploy unable to leave it half configured.

`RELAY_KEY` stays optional and dashboard-only if you want it. It is public by
construction — bots only.

**4. Point the board at it.**

Set `RELAY` in `index.html` to the Worker's address. If you set `RELAY_KEY`, set
the matching constant too. The board derives the socket address from `RELAY`, so
there is nothing else to configure.

Note what `RELAY_KEY` is and is not. It sits in `index.html`, and this
repository is public, so anyone reading the page can read the key. It turns away
bots that stumble on the address; it does not keep out a person who looks. Treat
the endpoint as world-writable and skip the key if you prefer.

## Why that is safe enough

The address ends up in public page source, so the Worker is built to be
uninteresting to abuse:

- It writes one shape of file: a board export with `notes[]` and `changed[]`.
  Anything else is refused.
- **It will start at most 20 Claude runs an hour**, counted across every caller
  together. This is the cap that matters now. Junk in a public folder costs a
  `git rm`; a Claude run costs the owner's subscription, so the ceiling is the
  difference between a public address being survivable and being a bill.
- Reading the whole conversation, or writing a message as Claude, needs
  `AGENT_KEY`, which is not in the page and not in this repo.
- It writes to `claude-inbox/` on `main` and nowhere else. The caller never
  supplies a path. It may supply a timestamp, which has to match
  `YYYY-MM-DD-HHMM` exactly, and the folder and `.json` extension are added by
  the Worker.
- It caps a request at 64 KB, and at 200 notes and 200 changes.
- Two sends in the same minute get `-1`, `-2` suffixes rather than overwriting
  each other.
- The GitHub token never appears in a response.

So the worst an abuser achieves is junk JSON in a folder that is already public,
which is a `git rm` to clean up. Nothing private is exposed, because nothing
private is there: see the privacy note in `CLAUDE.md`.

## The audit log

The daily alarm also writes `history/YYYY-MM-DD.md` — every board change that
day as a table, kept for `HIST_DAYS` (30) and then deleted. Entries are
recorded in `fold()`, which is the only place that sees both the old value and
the new one. The write and the prune sit inside a `try` after the snapshot: the
archive keeps the GitHub fallback alive and the log must never cost it, so a
failed write leaves the day pending for the next run instead of dropping it.

This needs the same `GH_TOKEN` as the archive, with Contents: read and write —
the prune issues DELETEs, which nothing here did before.

## If it breaks

The board falls back on its own. A failed send keeps your notes on the device,
says why, and opens GitHub's editor so you can commit by hand. Notes are only
marked as sent once the file is confirmed in the repo, so a failure can never
look like a success.

To check the Worker directly:

```
curl -X POST https://mba-note-relay.<your-subdomain>.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"v":1,"exportedAt":"2026-01-01T00:00:00.000Z","notes":[],"changed":[]}'
```

A healthy Worker answers `{"ok":true,"path":"claude-inbox/…json", …}`. `403`
means the relay key does not match, `400` means the payload was rejected, and
`502` means GitHub refused the commit, usually an expired token.

If a send comes back `"job":{"ok":false,...}`, or replies stop arriving,
`/state` reports the last attempt as `lastJob` with GitHub's own status and
message. `401` means the Worker's `GH_TOKEN` is missing or expired; `403` means
it lacks **Contents: Read and write** on this repository.

For the log and the push side:

```
curl https://mba-cc-relay.<your-subdomain>.workers.dev/state
```

answers `{"seq":N,"evs":[…]}`. If a `/send` comes back with
`"job":{"ok":false,"why":"github 403"}`, the relay reached GitHub but was not
allowed to start a run: the `GH_TOKEN` needs **Contents: Read and write** on
this repository, which is also what it needs to commit. Nothing is lost when a
start fails — the note is already in the log and already on the other device,
and the twice-daily Routine is still the backstop.
