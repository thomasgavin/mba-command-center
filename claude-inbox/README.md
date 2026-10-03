# claude-inbox

The bridge between the board in your browser and Claude.

Your notes and board state live in `localStorage`, which nothing outside your
browser can read. Pressing **For Claude** in the app commits a JSON file here;
a Claude session reads this folder and can write a correction back into it,
which the app picks up on its next load.

Two file shapes, both named `YYYY-MM-DD-HHMM.json`:

- **snapshot** — written by the "For Claude" button. Describes a whole board.
  Applied by resetting to `SEED` and laying `changed[]` over it, and ignored if
  the device's own edits are newer.
- **patch** — `"op":"patch"`, written by Claude. Touches only the items it
  names, so unrelated local changes survive, and applies even when local edits
  are newer, because it was written in response to them. Carries `why`, shown
  in the app's toast.

Only `.json` files here are read; this README is ignored.

**This repository is public.** Everything committed here is publicly readable.
Never put account numbers, passport or visa numbers, loan references or
credentials in a note that gets sent.
