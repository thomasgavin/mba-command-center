# relay — one-press sending

The board is a static page, so it cannot commit to this repo by itself. It needs
a credential, and a credential in the browser is the thing we were trying to
avoid: WebKit drops script-writable storage after about a week without a visit,
which on an iPhone means pasting a GitHub token in again, forever.

This Worker holds the token instead. The board posts a note to the Worker, the
Worker commits it. Nothing secret reaches either device, so nothing on them can
expire. `worker.js` is the whole thing, about 110 lines, no dependencies.

## What it costs

Nothing. Cloudflare's free Workers plan allows 100,000 requests a day. A few
notes a day uses a rounding error of that, and the Worker makes one outbound
call to GitHub per note.

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

**2. The Worker.**

Sign in at <https://dash.cloudflare.com> (a free account is enough), then:

- **Compute (Workers)** → **Create** → **Start with Hello World** → **Deploy**.
  Name it `mba-note-relay`.
- Open **Edit code**, delete what is there, paste all of `worker.js`, **Deploy**.
- **Settings** → **Variables and Secrets** → **Add**:
  - Type **Secret**, name `GH_TOKEN`, value the token from step 1.
  - Optionally type **Secret**, name `RELAY_KEY`, value any random string.
- **Deploy** once more so the secrets take effect.

Copy the Worker's address, which looks like
`https://mba-note-relay.<your-subdomain>.workers.dev`.

**3. Point the board at it.**

Set `RELAY` in `index.html` to that address. If you set `RELAY_KEY`, set the
matching constant too.

Note what `RELAY_KEY` is and is not. It sits in `index.html`, and this
repository is public, so anyone reading the page can read the key. It turns away
bots that stumble on the address; it does not keep out a person who looks. Treat
the endpoint as world-writable and skip the key if you prefer.

## Why that is safe enough

The address ends up in public page source, so the Worker is built to be
uninteresting to abuse:

- It writes one shape of file: a board export with `notes[]` and `changed[]`.
  Anything else is refused.
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
