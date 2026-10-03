# MBA Command Center

Single-file action board for the INSEAD MBA'27D run-up. No build step, no server,
no accounts: open `index.html` and it works.

State (statuses, dates you have pushed, notes) lives in the browser's
localStorage, per device. "For Claude" exports notes and changes as JSON.

Views: Overview, Board, Timeline, Calendar, Dependencies, List.
Drag a card between columns, onto the snooze rail (+1/+3/+5/done), or onto a
calendar day to reschedule. Double-click a card, or hit the pencil, to leave a note.
Cmd-K opens search.

Deployed with GitHub Pages from `main`, root.
