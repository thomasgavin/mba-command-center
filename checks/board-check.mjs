/* The invariants in REVIEW.md, as something that actually runs.

   Every rule here was a bug first. A rule nobody can execute is a rule that
   gets broken by the next change, which is the whole reason this file exists
   rather than another paragraph of prose.

       node checks/board-check.mjs

   It serves index.html on a local port with the relay and the GitHub API
   pointed back at itself -- the page must be served over HTTP, because the
   pull path is skipped on file:// by design -- drives a real Chromium at
   three widths, and exits non-zero on the first broken invariant.

   Needs Playwright and a Chromium, and finds them wherever it is run: the
   cloud container keeps them at fixed paths, a GitHub runner has them in
   node_modules after `npm i playwright`, and a Mac has whatever `npm i` put
   there. PW and PW_CHROMIUM override either. It has to work on the runner,
   because the board's own chat can ask for a code change and the run that
   answers must be able to prove the change before it pushes it. */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

var PW_TRIES = [process.env.PW, "playwright",
                "/opt/node-tools/node_modules/playwright/index.mjs"].filter(Boolean);
var CHROMIUM = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";
var PORT     = Number(process.env.PORT || 8391);
var ROOT     = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
var WIDTHS   = [390, 768, 1280];
var VIEWS    = ["over", "board", "time", "cal", "map", "chat"];
/* Chat has no tab any more -- the floating button is the way in -- so the
   loops that click a tab use this list and reach Chat through setView. */
var TABS     = ["over", "board", "time", "cal", "map"];

var out = [], bad = 0;
function ok(name, pass, detail) {
  if (!pass) bad++;
  out.push((pass ? "PASS  " : "FAIL  ") + name + (detail ? "  " + detail : ""));
}

/* the page with its two outbound calls pointed at this server, so a run
   exercises the board and not the network */
function page() {
  var t = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  t = t.replace(/var RELAY="[^"]*"/, 'var RELAY=""');
  t = t.replace(/var API="[^"]*"\+REPO\+"[^"]*"\+INBOX/,
                'var API="http://127.0.0.1:' + PORT + '/contents"');
  return t;
}

var server = http.createServer(function (req, res) {
  var u = req.url.split("?")[0];
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (u === "/contents") { res.setHeader("Content-Type", "application/json"); return res.end("[]"); }
  /* a relay that accepts everything, so the success path of an automatic send
     can actually be exercised rather than only its failure */
  if (u === "/send") { res.setHeader("Content-Type", "application/json"); return res.end('{"ok":true,"seq":1}'); }
  /* sw.js is served as a real script or the browser refuses to register it --
     GitHub Pages gets this right, and a harness that does not cannot see the
     service worker at all */
  if (u === "/sw.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Service-Worker-Allowed", "/");
    return res.end(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"));
  }
  if (u === "/manifest.webmanifest") {
    res.setHeader("Content-Type", "application/manifest+json");
    return res.end(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
  }
  res.setHeader("Content-Type", "text/html");
  res.end(page());
});
await new Promise(function (r) { server.listen(PORT, "127.0.0.1", r); });
var URL_ = "http://127.0.0.1:" + PORT + "/";

var chromium = null, why = [];
for (var cand of PW_TRIES) {
  try { chromium = (await import(cand)).chromium; break; }
  catch (e) { why.push(cand + ": " + e.code); }
}
if (!chromium) {
  console.error("No Playwright found. Tried " + why.join(", ") +
                ". Install it (npm i playwright) or set PW to its entry point.");
  process.exit(2);
}
/* an explicit binary when there is one, otherwise Playwright's own download --
   the runner installs that, the container has the binary at a fixed path */
var launch = {};
if (fs.existsSync(CHROMIUM)) launch.executablePath = CHROMIUM;
var browser = await chromium.launch(launch);

async function open(width, seed) {
  var ctx = await browser.newContext({
    viewport: { width: width, height: width < 720 ? 844 : 900 },
    hasTouch: width < 720, isMobile: width < 720
  });
  var p = await ctx.newPage();
  var errs = [];
  p.on("console", function (m) {
    /* the relay is not running here, so its socket and its fetch are expected
       to fail; anything else is the page's own fault */
    if (m.type() === "error" && !/WebSocket|Failed to load resource/.test(m.text())) errs.push(m.text());
  });
  p.on("pageerror", function (e) { errs.push(String(e)); });
  /* An array is notes, the back-compatible form. An object seeds whatever it
     names -- the map has no SEED to fall back on, so a check about the map's
     shapes or about the Overview News tile cannot exercise anything without
     putting nodes in storage first. */
  if (seed) await p.addInitScript(function (s) {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      var blob = Array.isArray(s) ? { notes: s } : s;
      blob.v = 3; blob.notes = blob.notes || []; blob.changed = blob.changed || [];
      blob.touched = blob.touched || {};
      localStorage.setItem("mbacc_v3", JSON.stringify(blob));
    }
  }, seed);
  await p.goto(URL_, { waitUntil: "load" });
  await p.waitForTimeout(600);
  return { p: p, ctx: ctx, errs: errs };
}

/* ---- 1. the page itself never scrolls, in any direction, on any view ---- */
for (var w of WIDTHS) {
  var s = await open(w);
  ok(w + "px: the document is locked", await s.p.evaluate(function () {
    return getComputedStyle(document.body).position === "fixed";
  }), "a fixed body is the only thing iOS respects when the keyboard opens");
  for (var v of VIEWS) {
    if (TABS.indexOf(v) >= 0) await s.p.click('.vt[data-v="' + v + '"]');
    else await s.p.evaluate(function (x) { setView(x); }, v);
    await s.p.waitForTimeout(220);
    var m = await s.p.evaluate(function () {
      var d = document.scrollingElement, st = document.querySelector(".stage");
      return { dw: d.scrollWidth, dc: d.clientWidth, dt: d.scrollTop,
               sw: st.scrollWidth, sc: st.clientWidth };
    });
    ok(w + "px " + v + ": nothing runs off the side", m.dw <= m.dc + 1 && m.sw <= m.sc + 1, JSON.stringify(m));
  }
  /* a focused control must not be able to shift the document under the header */
  await s.p.evaluate(function () { setView("chat"); });
  await s.p.waitForTimeout(200);
  var top1 = await s.p.$eval(".top", function (n) { return n.getBoundingClientRect().top; });
  await s.p.focus("#cin");
  await s.p.evaluate(function () { window.scrollTo(0, 500); document.scrollingElement.scrollTop = 500; });
  await s.p.waitForTimeout(200);
  var top2 = await s.p.$eval(".top", function (n) { return n.getBoundingClientRect().top; });
  var sc = await s.p.evaluate(function () { return document.scrollingElement.scrollTop; });
  ok(w + "px: the header stays put", top1 === top2 && sc === 0, "top " + top1 + "->" + top2 + " scrollTop " + sc);
  ok(w + "px: no console errors", s.errs.length === 0, s.errs.join(" | "));
  await s.ctx.close();
}

/* ---- 2. the drawer fits the screen, for every task ---- */
for (var w2 of [390, 1280]) {
  var s2 = await open(w2);
  await s2.p.click('.vt[data-v="time"]');
  await s2.p.waitForTimeout(250);
  var ids = await s2.p.evaluate(function () { return Object.keys(items); });
  var over = [];
  for (var id of ids) {
    await s2.p.evaluate(function (i) { openId = i; dMode = "item"; renderDrawer(); showDrawer(); }, id);
    await s2.p.waitForFunction(function () {
      return document.getElementById("drawer").getBoundingClientRect().right <= innerWidth + 1;
    }, null, { timeout: 2500 });
    var d = await s2.p.$eval("#dBody", function (n) { return { sw: n.scrollWidth, cw: n.clientWidth }; });
    if (d.sw > d.cw + 1) over.push(id + " " + d.sw + ">" + d.cw);
    var wide = await s2.p.$$eval("#dBody *", function (ns) {
      return ns.filter(function (n) {
        return n.getBoundingClientRect().right > n.ownerDocument.documentElement.clientWidth + 1;
      }).map(function (n) { return (n.className || n.tagName) + "|" + n.textContent.slice(0, 24); });
    });
    if (wide.length) over.push(id + " overruns " + JSON.stringify(wide.slice(0, 2)));
    /* The collapsed card is the easy case. Every row has to fit open too --
       the date input is the one that ignores width:100% in Safari, and it only
       exists while the Due row is expanded. */
    var rows = await s2.p.evaluate(function () {
      var bad = [], cw = document.documentElement.clientWidth;
      ["status", "due", "priority", "effort"].forEach(function (k) {
        dRow = k; renderDrawer();
        var b = document.getElementById("dBody");
        if (b.scrollWidth > b.clientWidth + 1) bad.push(k + " " + b.scrollWidth + ">" + b.clientWidth);
        Array.prototype.forEach.call(b.querySelectorAll(".pex *"), function (n) {
          if (n.getBoundingClientRect().right > cw + 1) bad.push(k + ":" + (n.className || n.tagName));
        });
      });
      dRow = null; renderDrawer();
      return bad;
    });
    if (rows.length) over.push(id + " open " + JSON.stringify(rows.slice(0, 2)));
  }
  ok(w2 + "px: the drawer fits, for every task", over.length === 0, over.slice(0, 4).join(" ; "));
  await s2.ctx.close();
}

/* ---- 3. no control a finger lands on is under 16px on a phone ---- */
{
  var s3 = await open(390);
  await s3.p.evaluate(function () {
    var k = Object.keys(items)[0]; openId = k; dMode = "item"; renderDrawer(); showDrawer();
  });
  await s3.p.waitForTimeout(400);
  /* the date input and the note composer only exist while their row is open,
     so a check that never opens one is a check that cannot see them */
  await s3.p.evaluate(function () { dNote = true; dRow = "due"; renderDrawer(); });
  await s3.p.waitForTimeout(200);
  var small = await s3.p.$$eval("input,textarea,select", function (ns) {
    return ns.filter(function (n) { return parseFloat(getComputedStyle(n).fontSize) < 16; })
             .map(function (n) { return (n.id || n.tagName) + " " + getComputedStyle(n).fontSize; });
  });
  ok("390px: every focusable control is 16px or more", small.length === 0, JSON.stringify(small));
  await s3.ctx.close();
}

/* ---- 4. the thread is honest about time ---- */
{
  var now = Date.now(), iso = function (ms) { return new Date(ms).toISOString(); };
  var seed = [
    { id: "claude-ahead", from: "claude", text: "a reply stamped in the future",
      createdAt: iso(now + 6 * 3600 * 1000), state: "read" },
    { id: "n-old", from: "me", text: "written a minute ago", createdAt: iso(now - 60000), state: "read" }
  ];
  var s4 = await open(390, seed);
  var future = await s4.p.evaluate(function () {
    var n = new Date().toISOString();
    return notes.filter(function (x) { return (x.createdAt || "") > n; }).map(function (x) { return x.id; });
  });
  ok("no note is dated in the future", future.length === 0, JSON.stringify(future));
  var before = await s4.p.evaluate(function () {
    return notes.map(function (n) { return n.id + "@" + n.createdAt; }).join(",");
  });
  await s4.p.reload({ waitUntil: "load" });
  await s4.p.waitForTimeout(500);
  var after = await s4.p.evaluate(function () {
    return notes.map(function (n) { return n.id + "@" + n.createdAt; }).join(",");
  });
  ok("the repair is written back, so a reload does not redo it", before === after,
     before === after ? "" : before + " -> " + after);
  await s4.ctx.close();
}

/* ---- 5. the chat view opens to be read, and shows all of itself ---- */
{
  var s5 = await open(390, [{ id: "n1", from: "me", text: "a message, so the tip has text",
                              createdAt: new Date().toISOString(), state: "read" }]);
  await s5.p.click("#fab");
  await s5.p.waitForTimeout(400);
  var focused = await s5.p.evaluate(function () {
    return document.activeElement && document.activeElement.id;
  });
  ok("the chat button does not raise the keyboard", focused !== "cin",
     "focus is on " + focused + "; focusing the composer covers half the thread before he has read it");
  /* The line under the composer is gone -- it explained once a day, for as
     long as the thread exists, that replies arrive on their own, and took two
     lines of a 390px screen off the thread. What must hold is that the last
     message still clears the composer: *"the got your note gets cut off by
     the textbox"*. */
  var tip = await s5.p.evaluate(function () {
    var w = document.getElementById("chatw"), f = document.querySelector("#v-chat .cfoot");
    w.scrollTop = w.scrollHeight;
    var last = w.lastElementChild;
    return { tip: !!document.getElementById("chatTip"),
             clear: Math.round(f.getBoundingClientRect().top - last.getBoundingClientRect().bottom) };
  });
  ok("the thread has no standing footnote under it", tip.tip === false, JSON.stringify(tip));
  ok("and the last message clears the composer", tip.clear >= 0, JSON.stringify(tip));
  /* a message typed in Chat is already on screen with its own state under it */
  await s5.p.fill("#cin", "typed in the chat window");
  await s5.p.click("#csend");
  await s5.p.waitForTimeout(350);
  var toasted = await s5.p.evaluate(function () {
    return document.getElementById("toast").classList.contains("on");
  });
  ok("no toast for a message typed in Chat", !toasted);
  await s5.p.evaluate(function () { addNote(Object.keys(items)[0], "left on a task"); });
  await s5.p.waitForTimeout(300);
  var toasted2 = await s5.p.evaluate(function () {
    return document.getElementById("toast").classList.contains("on");
  });
  ok("a note left on a task still says so", toasted2, "the drawer gives no other sign it was taken");
  await s5.ctx.close();
}

/* ---- 6. a deleted task leaves every view except Tasks ---- */
{
  /* the Visa tile read items[] directly and kept showing a deleted step */
  var sv = await open(390);
  var kv = await sv.p.evaluate(function () {
    delItem("cf-interview");
    return { step: !!document.querySelector('.step[data-go="cf-interview"]'), html: renderVisa().indexOf('data-go="cf-interview"') >= 0 };
  });
  ok("a deleted task is out of the Visa tile", !kv.step && !kv.html, JSON.stringify(kv));
  await sv.ctx.close();
  var s6 = await open(390);
  var k6 = await s6.p.evaluate(function () {
    var k = Object.keys(items)[0];
    delItem(k);
    return { id: k, board: board(k), list: list(k), alive: alive().length, gone: gone().length };
    function board(x) { return !!document.querySelector('.card[data-id="' + x + '"]'); }
    /* Tasks is where a deleted task is still reachable; it inherited that job
       from the list when the two views merged. */
    function list(x) { return !!document.querySelector('.grow.dl[data-id="' + x + '"]'); }
  });
  ok("a deleted task is out of the board", !k6.board, JSON.stringify(k6));
  ok("a deleted task is still in Tasks", k6.list, JSON.stringify(k6));
  ok("a deleted task is out of alive()", k6.gone === 1, JSON.stringify(k6));
  /* the whole point of deleting being a field rather than a removal */
  var back = await s6.p.evaluate(function (id) {
    undelItem(id);
    return { gone: gone().length, board: !!document.querySelector('.card[data-id="' + id + '"]') };
  }, k6.id);
  ok("and it comes back", back.gone === 0 && back.board, JSON.stringify(back));
  /* a task deleted and restored must not take the dependency cascade with it:
     patch() is called with derived, so nothing is marked manual by a delete */
  var man = await s6.p.evaluate(function (id) { return !!items[id].manual; }, k6.id);
  ok("deleting does not mark the task manual", !man);
  await s6.ctx.close();
}

/* ---- 7. the notes badge is a notification, not an inventory ---- */
{
  var s7 = await open(390, [
    { id: "nr", from: "me", text: "already delivered", createdAt: new Date().toISOString(), state: "read" }
  ]);
  var b1 = await s7.p.evaluate(function () {
    var n = document.getElementById("notesN");
    return { txt: n.textContent, off: n.classList.contains("off"), total: notes.length };
  });
  ok("the badge is hidden when nothing is new", b1.off && b1.txt === "0" && b1.total === 1, JSON.stringify(b1));
  /* a note of his own is NOT news: on his note `state:"new"` means "not yet
     delivered", which is what the thread's "sending..." line reads, and a
     badge over a message he just typed is the board telling him to go and
     read himself. */
  var b2 = await s7.p.evaluate(function () {
    addNote(Object.keys(items)[0], "something new", true);
    var n = document.getElementById("notesN");
    return { txt: n.textContent, off: n.classList.contains("off"), total: notes.length };
  });
  ok("a note he wrote himself never lights it", b2.off && b2.txt === "0" && b2.total === 2, JSON.stringify(b2));
  var b3 = await s7.p.evaluate(function () {
    notes.unshift({ id: "claude-x", from: "claude", text: "a reply",
                    createdAt: new Date().toISOString(), state: "new" });
    render();
    var n = document.getElementById("notesN");
    return { txt: n.textContent, off: n.classList.contains("off"), chat: unread() };
  });
  ok("and a reply from Claude is the only thing that does",
     !b3.off && b3.txt === "1" && b3.chat === 1, JSON.stringify(b3));
  await s7.ctx.close();
}

/* ---- 8. a note he keeps to himself does not travel ---- */
{
  var s8 = await open(390);
  var keep = await s8.p.evaluate(function () {
    var k = Object.keys(items)[0];
    addNote(k, "mine only", true, false);
    addNote(k, "for Claude", true, true);
    return { out: outNotes().map(function (n) { return n.text; }),
             unread: unread(), thread: notesFor(k).length };
  });
  ok("an unticked note is not sent", keep.out.length === 1 && keep.out[0] === "for Claude", JSON.stringify(keep));
  ok("and neither of his own notes is something to read", keep.unread === 0, JSON.stringify(keep));
  ok("but it is still in the task's thread", keep.thread === 2, JSON.stringify(keep));
  await s8.ctx.close();
}

/* ---- 8b. a new version must not hand back a board he has already read ----
   He asked it as a question -- "everytime there is a new version why does the
   notes and brief and chat get unread" -- and the three mechanisms that could
   do it are each checked here rather than reasoned about: the reload itself,
   the send that follows an edit, and what the payload carries out. */
{
  var now8 = new Date().toISOString();
  var s8b = await open(390, [
    { id: "claude-r", from: "claude", text: "a reply", createdAt: now8, state: "new" }
  ]);
  /* reading the thread, then a new version arriving */
  await s8b.p.evaluate(function () { setView("chat"); });
  await s8b.p.waitForTimeout(300);
  var did = await s8b.p.evaluate(function () {
    news.push({ id: "news-daily-x", period: "daily", date: "2026-10-06",
                at: new Date().toISOString(), body: "## A\n- b\nc" });
    openNews();
    return { notes: unread(), briefs: unreadNews() };
  });
  await s8b.p.waitForTimeout(300);
  ok("reading the thread and the briefs clears both", did.notes === 0 && did.briefs === 0, JSON.stringify(did));
  await s8b.p.goto(URL_ + "?v=next-" + Date.now(), { waitUntil: "load" });
  await s8b.p.waitForTimeout(600);
  var after = await s8b.p.evaluate(function () {
    return { notes: unread(), briefs: unreadNews(), n: notes.length, w: news.length };
  });
  ok("and a new version's reload hands them back read, not new",
     after.n === 1 && after.w === 1 && after.notes === 0 && after.briefs === 0, JSON.stringify(after));
  /* the send after an edit used to pass every note on the board to markSent,
     so an unread reply was swallowed by the next date he moved */
  var swal = await s8b.p.evaluate(function () {
    notes.unshift({ id: "claude-r2", from: "claude", text: "newer reply",
                    createdAt: new Date().toISOString(), state: "new" });
    markSent(notes.map(function (n) { return n.id; }));
    return { unread: unread() };
  });
  ok("a confirmed send never marks a reply he has not opened read", swal.unread === 1, JSON.stringify(swal));
  /* and `read` is per device: the relay strips it from its archive, so the
     live payload must not carry it over the top of that */
  var trav = await s8b.p.evaluate(function () {
    news.forEach(function (n) { n.read = true; });
    return { out: outNews().filter(function (n) { return "read" in n; }).length, kept: news[0].read };
  });
  ok("and a brief read here does not travel to his other device",
     trav.out === 0 && trav.kept === true, JSON.stringify(trav));
  await s8b.ctx.close();
}

/* ---- 9. "What I changed" never claims a change that did not happen ---- */
{
  var now9 = new Date().toISOString();
  var s9 = await open(390, [
    { id: "claude-none", from: "claude", text: "nothing needed doing", state: "read", createdAt: now9,
      acted: ["No board changes: the flight being Done is what ticks the milestone"] },
    { id: "claude-did", from: "claude", text: "moved it", state: "read", createdAt: now9,
      acted: ["Pushed the visa appointment to 12 Nov"] }
  ]);
  var boxes = await s9.p.evaluate(function () {
    return { shown: document.querySelectorAll("#chatw .cdid").length,
             none: actedOf({ acted: ["No board changes: nothing to do"] }).length,
             did:  actedOf({ acted: ["Pushed the visa appointment"] }).length };
  });
  ok("a no-change receipt renders no box", boxes.none === 0 && boxes.did === 1, JSON.stringify(boxes));
  ok("and only the real one is on the thread", boxes.shown === 1, JSON.stringify(boxes));
  await s9.ctx.close();
}

/* ---- 10. the things a tap has to still do ---- */
{
  var s10 = await open(390);
  await s10.p.click(".brand");
  await s10.p.waitForTimeout(250);
  var v = await s10.p.evaluate(function () { return view; });
  ok("the logo goes back to Overview", v === "over", String(v));
  /* the swipe between sections is gone: it fired on the gestures that belong
     to the cards and the sideways rails */
  var swipe = await s10.p.evaluate(function () { return typeof scrollableX; });
  ok("no swipe-between-views handler is left", swipe === "undefined", swipe);
  await s10.ctx.close();
}

/* ---- 11. what save() writes is what DFIELDS says it merges ---- */
{
  /* This is the check that would have caught the deletion never persisting:
     `deleted` was in DFIELDS from the first day and diffOf never produced it,
     so a deleted task came back on the next load and never reached the other
     device. An in-memory assertion cannot see it -- only a reload can. */
  var s11 = await open(390);
  var id11 = await s11.p.evaluate(function () {
    var k = Object.keys(items)[0];
    delItem(k); hideToast();
    patch(Object.keys(items)[1], { effort: "wait" });
    return k;
  });
  await s11.p.waitForTimeout(300);
  await s11.p.reload({ waitUntil: "load" });
  await s11.p.waitForTimeout(600);
  var kept = await s11.p.evaluate(function (k) {
    return { deleted: !!items[k].deleted, gone: gone().length,
             effort: items[Object.keys(items)[1]].effort };
  }, id11);
  ok("a deletion survives a reload", kept.deleted && kept.gone === 1, JSON.stringify(kept));
  ok("and so does effort", kept.effort === "wait", JSON.stringify(kept));
  /* every field the merge knows about has to be a field save() can write */
  var holes = await s11.p.evaluate(function () {
    var k = Object.keys(items)[0], i = items[k], s = seedOf(k), out = [];
    DFIELDS.forEach(function (f) {
      if (f === "snoozes" || f === "origDue") return;    /* only set by snoozing */
      var was = i[f];
      i[f] = (f === "due" ? "2099-01-01" : f === "effort" ? "multi"
            : f === "status" ? "doing" : f === "priority" ? "Low"
            : f === "title" ? "A renamed task" : true);
      if (diffOf(i)[f] === undefined) out.push(f);
      i[f] = was;
    });
    return out;
  });
  ok("every DFIELD is one diffOf actually emits", holes.length === 0, JSON.stringify(holes));
  await s11.ctx.close();
}

/* ---- 12. effort is what turns a due date into a start date ---- */
{
  var s12 = await open(390);
  var lead = await s12.p.evaluate(function () {
    var k = Object.keys(items)[0], i = items[k];
    i.due = "2026-12-01";
    i.effort = "wait";   var w = startBy(i);
    i.effort = "quick";  var q = startBy(i);
    i.effort = null;     var n = startBy(i);
    return { wait: w, quick: q, none: n };
  });
  /* 21 days of runway for something that is mostly waiting on a bank, 1 for
     something that takes an hour -- the whole point of the field */
  ok("a long lead starts earlier than a short one",
     lead.wait === "2026-11-10" && lead.quick === "2026-11-30", JSON.stringify(lead));
  ok("and no effort means no claim about when to start", lead.none === null, JSON.stringify(lead));
  await s12.ctx.close();
}

/* ---- 13. a nudge does not look like a reply ---- */
{
  var now13 = new Date().toISOString();
  var s13 = await open(390, [
    { id: "claude-r", from: "claude", text: "an ordinary reply", state: "read", createdAt: now13 },
    { id: "claude-n1", from: "claude", kind: "nudge", about: "deposit",
      itemTitle: "EUR 12,000 tuition deposit paid", text: "start this now",
      state: "read", createdAt: now13, round: 1, was: { status: "todo", due: "2026-08-01" } },
    { id: "claude-n2", from: "claude", kind: "nudge", about: "deposit",
      itemTitle: "EUR 12,000 tuition deposit paid", text: "still nothing on this",
      state: "read", createdAt: now13, round: 2, was: { status: "todo", due: "2026-08-01" } }
  ]);
  var n13 = await s13.p.evaluate(function () {
    var heads = [].map.call(document.querySelectorAll("#chatw .cnh"), function (e) {
      return e.textContent.replace(/\s+/g, " ").trim();
    });
    return { nudges: document.querySelectorAll("#chatw .cnud").length,
             plain: document.querySelectorAll("#chatw .cmsg:not(.cnud)").length,
             heads: heads,
             linked: document.querySelectorAll('#chatw .cnh[data-go="deposit"]').length };
  });
  ok("a nudge renders as a nudge and a reply does not", n13.nudges === 2 && n13.plain === 1,
     JSON.stringify(n13));
  ok("the first ask and the second read differently",
     /^.?\s*Nudge/.test(n13.heads[0]) && /Following up/.test(n13.heads[1]), JSON.stringify(n13.heads));
  /* the only useful response to a nudge is to go to the task */
  ok("and it is a way back to the task", n13.linked === 2, JSON.stringify(n13));
  await s13.p.evaluate(function () { setView("chat"); });
  await s13.p.waitForTimeout(400);
  await s13.p.click('#chatw .cnh[data-go="deposit"]');
  await s13.p.waitForTimeout(400);
  var opened = await s13.p.evaluate(function () { return openId; });
  ok("tapping the nudge opens that task", opened === "deposit", String(opened));
  await s13.ctx.close();
}

/* ---- 13b. a note opens with a title, in the colour of its task ----
   Sixty-five same-sized grey paragraphs down a drawer read as *"a T&C
   document and not inviting to read"*. The title is the fix and the tint is
   the track, so neither may silently stop rendering; a note written before
   the field existed still has to draw. */
{
  var now13b = new Date().toISOString();
  var s13b = await open(390, [
    { id: "claude-t1", from: "claude", itemId: "deposit", title: "SBI wants confirmation",
      itemTitle: "EUR 12,000 tuition deposit paid", text: "the body of the note",
      state: "read", createdAt: now13b },
    { id: "claude-t2", from: "claude", text: "no title on this one",
      state: "read", createdAt: now13b }
  ]);
  var n13b = await s13b.p.evaluate(function () {
    var t = document.querySelectorAll("#chatw .ntt");
    /* the expected colour as the browser computes it, so the assertion is
       not a hex-to-rgb conversion written twice */
    var probe = document.createElement("span");
    probe.style.color = tc(items.deposit.track);
    document.body.appendChild(probe);
    var want = getComputedStyle(probe).color;
    probe.parentNode.removeChild(probe);
    openNotes();
    var drawer = document.querySelectorAll("#dBody .nitem .ntt").length;
    var edge = document.querySelector("#dBody .nitem");
    return { n: t.length, txt: t[0] ? t[0].textContent : "",
             colour: t[0] ? getComputedStyle(t[0]).color : "",
             want: want, drawer: drawer,
             edge: edge ? getComputedStyle(edge).borderLeftWidth : "" };
  });
  ok("a note with a title draws it, and one without draws nothing",
     n13b.n === 1 && n13b.txt === "SBI wants confirmation", JSON.stringify(n13b));
  ok("the title takes the colour of the task's track",
     !!n13b.colour && n13b.colour === n13b.want, JSON.stringify(n13b));
  ok("and the notes drawer carries both the title and a colour edge",
     n13b.drawer === 1 && parseFloat(n13b.edge) >= 3, JSON.stringify(n13b));
  await s13b.ctx.close();
}

/* ---- 14. two tabs on one device do not eat each other's edits ---- */
{
  /* The board saves on nearly everything -- a poll, a socket event, the clock
     repair -- and save() wrote the whole blob. So the board left open in a
     second tab held the state it loaded with and wrote it straight over an
     edit made in the first: the item did not lose a race, it vanished from the
     diff and showed its SEED value again on the next load. */
  var ctx14 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  var A = await ctx14.newPage(), B = await ctx14.newPage();
  await A.goto(URL_, { waitUntil: "load" });
  await B.goto(URL_, { waitUntil: "load" });
  await A.waitForTimeout(700);
  var K = "sbi-sanction";

  await A.evaluate(function (k) { patch(k, { due: "2026-12-25" }); patch(k, { status: "done" }); }, K);
  await A.waitForTimeout(300);
  /* B never saw that edit. Any ordinary save in B used to destroy it. */
  await B.evaluate(function () { save(); });
  await B.waitForTimeout(300);
  var stored = await B.evaluate(function (k) {
    return (JSON.parse(localStorage.getItem("mbacc_v3") || "null").items || {})[k] || null;
  }, K);
  ok("a stale tab's save does not wipe the other tab's edit",
     !!stored && stored.due === "2026-12-25" && stored.status === "done", JSON.stringify(stored));

  await A.reload({ waitUntil: "load" });
  await A.waitForTimeout(700);
  var survived = await A.evaluate(function (k) { return { d: items[k].due, s: items[k].status }; }, K);
  ok("and it is still there on the next page load",
     survived.d === "2026-12-25" && survived.s === "done", JSON.stringify(survived));

  /* the other half: the tab he is not typing in should show what he just did */
  var K2 = "poa-exec";
  await A.evaluate(function (k) { patch(k, { due: "2027-02-02" }); }, K2);
  await A.waitForTimeout(500);
  var live = await B.evaluate(function (k) { return items[k].due; }, K2);
  ok("the other tab picks up the edit without being reloaded", live === "2027-02-02", String(live));

  /* a revert is an edit too, and it has to survive a stale tab the same way */
  await A.evaluate(function (k) {
    var sd = seedOf(k); patch(k, { due: sd.d, status: sd.s, manual: false }, null, true);
  }, K2);
  await A.waitForTimeout(300);
  await B.evaluate(function () { save(); });
  await B.waitForTimeout(300);
  var rev = await B.evaluate(function (k) {
    return (JSON.parse(localStorage.getItem("mbacc_v3") || "null").items || {})[k] || null;
  }, K2);
  ok("a revert survives a stale tab too", rev === null || rev.due === undefined, JSON.stringify(rev));

  /* notes are append-only, so neither tab may drop the other's */
  await A.evaluate(function () { addNote(null, "written in tab A", true); });
  await B.evaluate(function () { addNote(null, "written in tab B", true); });
  await B.waitForTimeout(400);
  var both = await B.evaluate(function () {
    var n = JSON.parse(localStorage.getItem("mbacc_v3") || "null").notes || [];
    return n.map(function (x) { return x.text; });
  });
  ok("neither tab drops the other's note",
     both.indexOf("written in tab A") >= 0 && both.indexOf("written in tab B") >= 0,
     JSON.stringify(both));
  await ctx14.close();
}

/* ---- 16. the task card is a summary, not a form ----
   It was four segmented controls stacked down the page: every option of every
   field on screen at once, seventeen buttons to describe four values, with the
   loudest thing on the card an orange button that only closed it. */
{
  var s16 = await open(390);
  var k16 = await s16.p.evaluate(function () {
    var k = Object.keys(items)[0];
    patch(k, { status: "todo", priority: "High" }, null, true);
    openItem(k);
    return k;
  });
  await s16.p.waitForTimeout(350);
  var shut = await s16.p.evaluate(function () {
    return { rows: document.querySelectorAll("#dBody .prow[data-row]").length,
             trk: !!document.querySelector("#dBody .prow.ptrk"),
             loose: !!document.querySelector("#dBody > .fld .chip.tr"),
             open: document.querySelectorAll("#dBody .pex").length,
             nt: !!document.getElementById("nt"),
             add: !!document.querySelector("#dBody .nadd"),
             segs: document.querySelectorAll("#dBody .seg").length };
  });
  ok("a card opens closed: every row collapsed, nothing expanded",
     shut.rows === 4 && shut.open === 0 && shut.segs === 0, JSON.stringify(shut));
  /* "Shouldn't the visa sit inside the top box here?" -- it should: a lone chip
     above a bordered group reads as something that fell out of it. */
  ok("the track is a row of the box, not a chip floating above it",
     shut.trk && !shut.loose, JSON.stringify(shut));
  ok("and the composer is one line until he asks for it",
     !shut.nt && shut.add, JSON.stringify(shut));

  /* a row that does not say what it holds is just a label */
  var vals = await s16.p.evaluate(function () {
    return Array.prototype.map.call(document.querySelectorAll("#dBody .prow"), function (r) {
      return r.querySelector(".pkey").textContent + "=" + r.querySelector(".pval").textContent;
    });
  });
  /* by name, not by index: the row order is a design decision that moves, and
     an index here turns adding a row into a failing check about nothing */
  function val(k){ var v=vals.find(function(x){ return x.indexOf(k+"=")===0; }); return v?v.slice(k.length+1):null; }
  ok("every row states the value it holds",
     val("Status") === "To do" && val("Priority") === "High", JSON.stringify(vals));
  /* "no need to have a seperate action row just for rename, just add a pencil
     next to the title" -- a row whose only job was to open a text box is a tap
     and a line of card spent on a field already on screen. */
  ok("and renaming is a pencil on the header, not a row of its own",
     !val("Title"), JSON.stringify(vals));

  var one = await s16.p.evaluate(function () {
    document.querySelector('#dBody .prow[data-row="status"]').click();
    var a = document.querySelectorAll("#dBody .pex").length;
    document.querySelector('#dBody .prow[data-row="priority"]').click();
    return { first: a, after: document.querySelectorAll("#dBody .pex").length,
             which: document.querySelector('#dBody .prow[aria-expanded="true"]').dataset.row };
  });
  ok("one row is open at a time", one.first === 1 && one.after === 1 && one.which === "priority",
     JSON.stringify(one));

  /* answering the question closes it -- otherwise the stack of controls is back */
  var set = await s16.p.evaluate(function () {
    document.querySelector('#dBody [data-pr="Low"]').click();
    return { open: document.querySelectorAll("#dBody .pex").length,
             val: document.querySelector('#dBody .prow[data-row="priority"] .pval').textContent,
             real: items[openId].priority };
  });
  ok("choosing a value closes the row and shows it",
     set.open === 0 && set.val === "Low" && set.real === "Low", JSON.stringify(set));

  /* an overdue countdown on a task he has already finished is the board being
     wrong about something he closed */
  var done16 = await s16.p.evaluate(function () {
    patch(openId, { due: "2020-01-01", status: "done" }, null, true);
    return document.querySelector('#dBody .prow[data-row="due"] .pval').textContent;
  });
  ok("a Done task is never late", !/late|ago/.test(done16), done16);

  /* the composer unfolds where it stood, not somewhere else */
  var wrote = await s16.p.evaluate(function () {
    document.querySelector("#dBody .nadd").click();
    return { nt: !!document.getElementById("nt"), add: !!document.querySelector("#dBody .nadd") };
  });
  ok("tapping Add a note opens the composer", wrote.nt && !wrote.add, JSON.stringify(wrote));

  /* an orange full-width button that only closes the card is the loudest thing
     on it doing the least, and it read "Done" under a status button of the
     same word */
  var foot = await s16.p.evaluate(function () {
    var b = document.querySelector("#dBody [data-done]");
    return { txt: b.textContent, primary: b.classList.contains("o"),
             statuses: STATUS.map(function (x) { return x.label; }) };
  });
  ok("the close button is not the primary action, and is not called Done",
     !foot.primary && foot.statuses.indexOf(foot.txt) < 0, JSON.stringify(foot));
  await s16.ctx.close();
}

/* ---- 20. an automatic send that worked says nothing ----
   It toasted "Saved and sent to Claude." after every edit and every message
   typed in Chat. The thread already shows a message going from "sending…" to
   sent, and the board already shows the change he just made, so the toast was
   announcing the expected case over the top of what he was reading. */
{
  var s20 = await open(390);
  var quiet20 = await s20.p.evaluate(function () {
    RELAY = location.origin;
    setView("chat");
    addNote(null, "a message typed in chat", true);
    return new Promise(function (done) {
      /* past the 2.6s debounce and the round trip */
      setTimeout(function () {
        done({ toast: document.getElementById("toast").classList.contains("on"),
               txt: document.getElementById("toast").textContent,
               sent: notes[0] && notes[0].state });
      }, 4200);
    });
  });
  ok("a successful automatic send raises no toast",
     !quiet20.toast, JSON.stringify(quiet20));
  /* markSent writes "read": delivered, so no longer outstanding */
  ok("and the note is still marked delivered", quiet20.sent === "read", JSON.stringify(quiet20));
  await s20.ctx.close();
}

/* ---- 21. a failed send still speaks ----
   That is the case he cannot see any other way. */
{
  var s21 = await open(390);
  var loud21 = await s21.p.evaluate(function () {
    RELAY = location.origin + "/nope";
    AUTO_RETRY = 60;                        /* so the one retry is not a four-second wait */
    addNote(null, "this one cannot be delivered", true);
    return new Promise(function (done) {
      setTimeout(function () {
        done({ toast: document.getElementById("toast").classList.contains("on"),
               txt: document.getElementById("toast").textContent });
      }, 5200);
    });
  });
  ok("a send that failed says so", loud21.toast && /not sent/i.test(loud21.txt), JSON.stringify(loud21));
  await s21.ctx.close();
}

/* ---- 17. Needs attention opens Overview, with the next deadline under it ----
   It used to sit under the milestone rail; the rail moved to the foot on
   2026-10-05 (see 35) and Needs attention took the top. */
{
  var src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  var iMiles = src.indexOf("h+=renderMiles();"), iAtt = src.indexOf('class="tile att"'), iHero = src.indexOf('class="tile hero a"');
  /* "move next deadline to the top and needs attention second": the one
     thing with a date outranks the list of seven things that have dates, and
     the milestone rail is still the last tile on the view. */
  ok("the next deadline opens the view, then Needs attention", iHero > 0 && iHero < iAtt && iMiles > iAtt, iMiles + "/" + iAtt + "/" + iHero);
}

/* ---- 17. nudges reach the lock screen, and the worker stays out of the way ----
   "Notifications" meant his phone, not a card in Chat. On iOS that needs a
   service worker, and a service worker is the one thing that can quietly undo
   the BUILD stamp by serving a cached page. */
{
  var sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  ok("the service worker never intercepts a request",
     !/addEventListener\s*\(\s*["']fetch["']/.test(sw),
     "a cached index.html beats checkBuild() and the board stops updating itself");

  /* Drive the real push handler with a fake self: iOS revokes the permission of
     a worker that takes a push and shows nothing, so the failing fetch matters
     as much as the good one. */
  var shown = [];
  function runSW(fetchImpl) {
    shown = [];
    var listeners = {};
    var self_ = {
      addEventListener: function (k, fn) { listeners[k] = fn; },
      registration: {
        scope: "https://x/",
        showNotification: function (t, o) { shown.push({ title: t, body: o.body, tag: o.tag, data: o.data }); }
      },
      clients: { matchAll: async function () { return []; }, openWindow: function () {} },
      skipWaiting: function () {}
    };
    var fn = new Function("self", "fetch", "btoa", "atob", sw + "\nreturn arguments[0];");
    fn(self_, fetchImpl, null, null);
    return { listeners: listeners };
  }
  var waits = [];
  var ev = function () { return { waitUntil: function (p) { waits.push(p); } }; };

  var r17 = runSW(async function () {
    return { ok: true, json: async function () { return { title: "SBI sanction", body: "Where does it stand?", tag: "nudge-sbi", about: "sbi-sanction" }; } };
  });
  waits = []; r17.listeners.push(ev());
  await Promise.all(waits);
  ok("a push shows the nudge it was about",
     shown.length === 1 && shown[0].title === "SBI sanction" && shown[0].data.go === "sbi-sanction",
     JSON.stringify(shown));

  var r17b = runSW(async function () { throw new Error("offline"); });
  waits = []; r17b.listeners.push(ev());
  await Promise.all(waits);
  ok("a push whose fetch fails still shows something",
     shown.length === 1 && !!shown[0].title,
     "iOS revokes a worker that takes a push and shows nothing: " + JSON.stringify(shown));

  /* one nudge replaces the last rather than stacking five on his lock screen */
  ok("a nudge notification is tagged", shown.length === 1 && !!shown[0].tag, JSON.stringify(shown));
}

/* ---- 18. the offer to turn them on appears only where it can work ---- */
{
  var s18 = await open(390);
  var reg = await s18.p.evaluate(function () {
    return navigator.serviceWorker.getRegistration().then(function (r) {
      return { has: !!r, scope: r ? r.scope : null };
    });
  });
  ok("the service worker registers", reg.has, JSON.stringify(reg));

  /* the harness runs with no relay, and an offer to subscribe to nothing is an
     offer that fails when he taps it */
  var noRelay = await s18.p.evaluate(function () {
    syncPush();
    return document.getElementById("pbn").classList.contains("off");
  });
  ok("no relay, no offer", noRelay);

  var states = await s18.p.evaluate(function () {
    /* the banner lives inside the Chat view, so it has no box at all until
       that view is the open one */
    setView("chat");
    RELAY = "https://relay.example";
    var el = document.getElementById("pbn"), read = function () {
      var b = document.getElementById("pbnB");
      return { off: el.classList.contains("off"), quiet: el.classList.contains("quiet"),
               txt: document.getElementById("pbnT").textContent,
               btn: b.textContent,
               /* the label is not the button: it carried one for a whole
                  release while a CSS rule kept it off the screen */
               shown: b.getBoundingClientRect().width > 0 && getComputedStyle(b).display !== "none" };
    };
    pushSubbed = false; syncPush(); var offer = read();
    pushSubbed = true;  syncPush(); var done = read();
    return { offer: offer, done: done };
  });
  ok("it offers once, with a button to tap",
     !states.offer.off && !!states.offer.btn && states.offer.shown, JSON.stringify(states.offer));
  /* It carried a test button for one evening, which is what proved his phone
     was reachable; then it was a banner restating a working state at the top
     of the thread every time he opened Chat. "Perfect, now I got the
     notification. Remove the test banner." */
  ok("and goes away once he is subscribed", states.done.off, JSON.stringify(states.done));

  /* An iPhone in a Safari tab cannot be asked at all. A dead button there reads
     as the feature being broken; the sentence is the whole fix. */
  var safari = await s18.p.evaluate(function () {
    RELAY = "https://relay.example";
    iOS = function () { return true; };
    standalone = function () { return false; };
    pushOK = function () { return false; };
    syncPush();
    var el = document.getElementById("pbn");
    return { off: el.classList.contains("off"), quiet: el.classList.contains("quiet"),
             txt: document.getElementById("pbnT").textContent,
             btn: document.getElementById("pbnB").textContent };
  });
  ok("on an iPhone in Safari it says to install, and offers no dead button",
     !safari.off && safari.quiet && /Home Screen/.test(safari.txt) && !safari.btn,
     JSON.stringify(safari));
  await s18.ctx.close();
}

/* ---- 19. a tapped notification lands on the task it was about ---- */
{
  var s19 = await open(390);
  var id19 = await s19.p.evaluate(function () { return Object.keys(items)[0]; });
  await s19.p.goto(URL_ + "?go=" + id19, { waitUntil: "load" });
  await s19.p.waitForTimeout(600);
  var landed = await s19.p.evaluate(function () {
    return { open: openId, shown: document.getElementById("drawer").classList.contains("on") };
  });
  ok("a notification tapped from cold opens that task",
     landed.open === id19 && landed.shown, JSON.stringify(landed) + " wanted " + id19);
  await s19.ctx.close();
}

/* ---- 22. a task in Calendar opens, at every width ----
   The narrow agenda renders .calrow, which was missing from the click
   handler's list, so Calendar on the phone was the one view where a task
   could not be opened at all. Both widths, because the two render different
   elements and a fix for one says nothing about the other. */
for (var cw of [390, 1280]) {
  var s22 = await open(cw);
  var opened = await s22.p.evaluate(async function () {
    /* an OPEN task: a month holding only closed ones draws nothing on the
       grid now, because those live in the Done block under it */
    var a = alive().filter(function (i) { return i.due && i.status !== "done"; })
                   .sort(function (x, y) { return x.due < y.due ? -1 : 1; });
    if (!a.length) return { skip: true };
    setView("cal");
    calCur = new Date(+a[0].due.slice(0, 4), +a[0].due.slice(5, 7) - 1, 1);
    render();
    await new Promise(function (r) { setTimeout(r, 60); });
    var row = document.querySelector("#cgrid .calrow,#cgrid .ev");
    if (!row) return { none: true };
    row.click();
    await new Promise(function (r) { setTimeout(r, 60); });
    return { want: row.dataset.id, got: openId,
             shown: document.getElementById("drawer").classList.contains("on"),
             grab: getComputedStyle(row).cursor };
  });
  ok("a tap on a Calendar task opens it at " + cw,
     opened.got && opened.got === opened.want && opened.shown, JSON.stringify(opened));
  /* cursor:grab on something that is not draggable promises a gesture the
     page does not have, and that is what hid the missing handler. The wide
     .ev really is draggable (drag-to-a-day), so this is the narrow row only. */
  if (cw < 720) ok("and the agenda row does not pretend to be a drag handle",
     opened.grab !== "grab", JSON.stringify(opened.grab));
  await s22.ctx.close();
}

/* ---- 23. a title is his to change, and it has to survive a reload ----
   `deleted` shipped in DFIELDS alone and came back on the next load while
   every in-memory assertion passed, so a new field is checked through
   localStorage and a real reload, not in memory. The rename itself is driven
   through the header's pencil, which is the only way in. */
{
  var s23 = await open(390);
  var id23 = await s23.p.evaluate(function () { return Object.keys(items)[0]; });
  var ren = await s23.p.evaluate(async function (id) {
    openItem(id);
    await new Promise(function (r) { setTimeout(r, 80); });
    var opened = !document.getElementById("dTin").classList.contains("off");
    document.getElementById("dPen").click();
    var el = document.getElementById("dTin");
    var swapped = !el.classList.contains("off") && document.getElementById("dTitle").classList.contains("off");
    el.value = "Renamed from the header";
    document.getElementById("dPen").click();
    await new Promise(function (r) { setTimeout(r, 80); });
    return { wasClosed: !opened, swapped: swapped,
             live: items[id].title, head: document.getElementById("dTitle").textContent,
             back: document.getElementById("dTin").classList.contains("off"),
             stored: JSON.parse(localStorage.getItem("mbacc_v3") || "{}").items[id].title };
  }, id23);
  ok("a card opens on the name, not on a field", ren.wasClosed, JSON.stringify(ren));
  /* the field takes the title's place: showing both is the same name twice */
  ok("the pencil turns the title into the field", ren.swapped, JSON.stringify(ren));
  ok("a rename lands on the task and back in the header",
     ren.live === "Renamed from the header" && ren.head === "Renamed from the header" && ren.back,
     JSON.stringify(ren));
  ok("and save() actually wrote it", ren.stored === "Renamed from the header", JSON.stringify(ren));
  await s23.p.reload({ waitUntil: "load" });
  await s23.p.waitForTimeout(500);
  var after = await s23.p.evaluate(function (id) { return items[id].title; }, id23);
  ok("and it is still there after a reload", after === "Renamed from the header", String(after));
  /* an empty name is refused: a task with no title cannot be found again */
  var blank = await s23.p.evaluate(async function (id) {
    openItem(id);
    document.getElementById("dPen").click();
    document.getElementById("dTin").value = "   ";
    document.getElementById("dPen").click();
    await new Promise(function (r) { setTimeout(r, 80); });
    return items[id].title;
  }, id23);
  ok("an empty title is refused", blank === "Renamed from the header", String(blank));
  /* Escape abandons, and the Notes drawer has no name to change */
  var esc = await s23.p.evaluate(async function (id) {
    openItem(id);
    document.getElementById("dPen").click();
    document.getElementById("dTin").value = "thrown away";
    document.getElementById("dTin").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise(function (r) { setTimeout(r, 80); });
    var kept = items[id].title;
    openNotes();
    return { kept: kept, penOnNotes: !document.getElementById("dPen").classList.contains("off") };
  }, id23);
  ok("Escape abandons the edit", esc.kept === "Renamed from the header", JSON.stringify(esc));
  ok("and the Notes drawer offers no rename", !esc.penOnNotes, JSON.stringify(esc));
  await s23.ctx.close();

  /* The pencil and the close sit side by side in the same header, so a size
     that differs reads as a mistake. It was one: the phone rule grew the close
     button to a 40px thumb target and left the pencil at 29px, and the only
     place that shows is a real layout at 390. Measured at every width. */
  for (var w23 of [390, 768, 1280]) {
    var sB = await open(w23);
    var box = await sB.p.evaluate(function (id) {
      openItem(id);
      var r = function (el) { var b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
      var pen = document.getElementById("dPen"), x = document.getElementById("dClose");
      var cs = getComputedStyle(x);
      return { pen: r(pen), x: r(x), bg: cs.backgroundColor, bd: cs.borderTopColor, fg: cs.color };
    }, id23);
    ok("pencil and close are the same size at " + w23,
      box.pen[0] === box.x[0] && box.pen[1] === box.x[1], JSON.stringify(box));
    /* a tint, not a solid: the close button is still secondary to the content */
    var red = function (c) { var m = c.match(/\d+/g); return m && +m[0] > 150 && +m[1] < 90 && +m[2] < 90; };
    ok("close carries a red tint at " + w23,
      red(box.bg) && red(box.bd) && red(box.fg), JSON.stringify(box));
    await sB.ctx.close();
  }
}

/* ---- 24. the words on screen are the words he uses ----
   "Blocked" was the board's word, not his; "Target" was on every open task and
   told him nothing, so the whole dateType field went with it. Checked as text
   he can read, because a label is only ever wrong on screen. */
{
  var s24 = await open(1280);
  var words = await s24.p.evaluate(function () {
    var seen = { blocked: 0, target: 0, upcoming: 0 };
    ["over", "board", "time", "cal", "map", "chat"].forEach(function (v) {
      setView(v);
      var t = document.getElementById("v-" + v).innerText || "";
      if (/\bBlocked\b/.test(t)) seen.blocked++;
      if (/\bTarget\b/.test(t)) seen.target++;
      if (/\bUpcoming\b/.test(t)) seen.upcoming++;
    });
    openItem(Object.keys(items)[0]);
    var d = document.getElementById("dBody").innerText || "";
    return { seen: seen, drawerBlocked: /\bBlocked\b/.test(d), drawerTarget: /\bTarget\b/.test(d),
             statusLabels: STATUS.map(function (x) { return x.label; }),
             dfields: DFIELDS.join(","), seedDt: SEED.filter(function (x) { return x.dt; }).length };
  });
  ok("nothing on screen says Blocked any more",
     words.seen.blocked === 0 && !words.drawerBlocked, JSON.stringify(words.seen));
  ok("and the state he reads is Upcoming", words.seen.upcoming > 0 &&
     words.statusLabels.indexOf("Upcoming") >= 0, JSON.stringify(words.statusLabels));
  ok("the Target field is gone from the data, not just hidden",
     words.dfields.indexOf("dateType") < 0 && words.seedDt === 0, words.dfields);
  ok("and no view or card prints Target",
     words.seen.target === 0 && !words.drawerTarget, JSON.stringify(words.seen));
  await s24.ctx.close();
}

/* ---- 25. Tasks is one view, not two ----
   The list and the timeline were two tabs over the same rows grouped the same
   way. One row now carries both halves: if they ever come apart, a state and
   the date it moved would be a tab apart again. */
var STATUS_LABELS = ["In progress", "To do", "Upcoming", "Done"];
for (var tw of [390, 1280]) {
  var s25 = await open(tw);
  var k25 = await s25.p.evaluate(function () {
    setView("time");
    var rows = document.querySelectorAll("#gantt .grow");
    var first = rows[0];
    var done = null;
    Array.prototype.forEach.call(rows, function (r) { if (!done && r.classList.contains("done")) done = r; });
    return {
      tabs: Array.prototype.map.call(document.querySelectorAll(".vt"), function (b) { return b.dataset.v; }),
      rows: rows.length, items: pool().length,
      bothHalves: !!(first && first.querySelector(".gl") && first.querySelector(".gtrack")),
      tick: !!(first && first.querySelector(".tick")),
      /* the three things he asked off the row: the state pill, the date chip
         and the note button. The colour and the marker's position carry the
         first two; the third is one tap away inside the card. */
      pill: !!document.querySelector("#gantt .gst"),
      dateChip: !!document.querySelector("#gantt .chip.d"),
      noteBtn: !!document.querySelector('#gantt [data-act="note"]'),
      noteCount: !!document.querySelector("#gantt .chip.nt"),
      legend: Array.prototype.map.call(document.querySelectorAll("#glg .lgi"), function (e) { return e.textContent; }),
      doneTick: done ? getComputedStyle(done.querySelector(".tick")).backgroundColor : null,
      donePoint: done ? (done.querySelector(".gpt") || {}).style.background : null,
      anyNews: all().some(function (i) { return i.isNews; })
    };
  });
  ok(tw + "px: there is one Tasks tab and no List tab",
     k25.tabs.indexOf("list") < 0 && k25.tabs.indexOf("time") >= 0, JSON.stringify(k25.tabs));
  ok(tw + "px: every task is a row", k25.rows === k25.items && k25.rows > 0, JSON.stringify(k25));
  ok(tw + "px: a row carries the list and the timeline together",
     k25.bothHalves && k25.tick, JSON.stringify(k25));
  /* "Too cluttered, remove statuses ... Remove date ... Remove edit button and
     note count" -- all four, and the key is what makes that readable. */
  ok(tw + "px: the row is the title and nothing it already shows elsewhere",
     !k25.pill && !k25.dateChip && !k25.noteBtn && !k25.noteCount, JSON.stringify(k25));
  /* Every status, plus Late, plus News while any NEWS item is on the board --
     a NEWS task draws in its own colour, and a colour the key does not
     explain is a colour that means nothing. Nothing else may be in here. */
  ok(tw + "px: a key maps every state to its colour",
     k25.legend.length === STATUS_LABELS.length + (k25.anyNews ? 2 : 1) &&
     STATUS_LABELS.every(function (l) { return k25.legend.indexOf(l) >= 0; }) &&
     k25.legend.indexOf("Late") >= 0 &&
     (k25.anyNews === (k25.legend.indexOf("News") >= 0)), JSON.stringify(k25.legend));
  /* green, not grey: done is the one state worth spotting down a column of 35 */
  ok(tw + "px: a done task is green on both halves",
     k25.doneTick === "rgb(0, 169, 143)" && k25.donePoint === "rgb(0, 169, 143)", JSON.stringify(k25));
  /* "make the timeline more condensed so it fits more (at least the next 1.5
     months) in the mobile screen". Measured, not assumed: the label column and
     the month width are two numbers in CSS and either one can quietly eat the
     part of the timeline he can actually see. */
  var fit = await s25.p.evaluate(function () {
    var sc = document.querySelector("#v-time .gscroll");
    var gl = document.querySelector("#gantt .gax .gl");
    var mo = document.querySelector("#gantt .gax .gm div");
    if (!sc || !gl || !mo) return null;
    return { visible: sc.clientWidth - gl.getBoundingClientRect().width,
             month: mo.getBoundingClientRect().width };
  });
  ok(tw + "px: at least six weeks of the timeline is on screen beside the list",
     !!fit && fit.month > 0 && fit.visible / fit.month >= 1.5,
     JSON.stringify(fit) + (fit ? " = " + (fit.visible / fit.month).toFixed(2) + " months" : ""));
  await s25.ctx.close();
}

/* ---- 26. Everything is one date-sorted list, and done tasks collect at the
   bottom ----
   "when everything tab is selected, don't segregate by types ... Just show a
   single list sorted by due dates. Add a section for done at the bottom ... In
   the timeline chart, add a green dot to show when it was actually marked
   completed." Three things, and the third one is a stored field, so it is
   checked across a reload rather than in memory -- `doneAt` had to go into
   DFIELDS and diffOf together, which is the pair that fails silently. */
for (var tw26 of [390, 1280]) {
  var s26 = await open(tw26);
  var k26 = await s26.p.evaluate(function () {
    setView("time");
    function read() {
      var out = [], sec = null;
      Array.prototype.forEach.call(document.querySelectorAll("#gantt .gsec,#gantt .grow"), function (e) {
        if (e.classList.contains("gsec")) { sec = e.textContent; out.push({ sec: sec }); }
        else out.push({ sec: sec, id: e.dataset.id, done: e.classList.contains("done"),
                        dot: !!e.querySelector(".gdn") });
      });
      return out;
    }
    var flat = read();
    var heads = flat.filter(function (r) { return r.sec !== undefined && r.id === undefined; })
                    .map(function (r) { return r.sec; });
    var rows = flat.filter(function (r) { return r.id; });
    var dues = rows.map(function (r) { return (items[r.id].due || "9999-99-99") + "|" + !!items[r.id].doneAt; });
    /* open rows in date order, then every done row, also in date order */
    var openRows = rows.filter(function (r) { return !r.done; });
    var doneRows = rows.filter(function (r) { return r.done; });
    function sorted(a) {
      for (var n = 1; n < a.length; n++) if (a[n - 1] > a[n]) return false;
      return true;
    }
    var openDue = openRows.map(function (r) { return items[r.id].due || "9999-99-99"; });
    var doneDue = doneRows.map(function (r) { return items[r.id].due || "9999-99-99"; });
    /* and the same view with a category chosen keeps its track headings */
    cat = "life"; render(); setView("time");
    var grouped = Array.prototype.map.call(document.querySelectorAll("#gantt .gsec"),
      function (e) { return e.textContent; });
    cat = "all"; render(); setView("time");
    return {
      heads: heads, rowCount: rows.length,
      openSorted: sorted(openDue), doneSorted: sorted(doneDue),
      openCount: openRows.length, doneCount: doneRows.length,
      /* every done row sits after every open one */
      doneLast: rows.every(function (r, n) { return !r.done || rows.slice(n).every(function (q) { return q.done; }); }),
      doneHead: heads.some(function (h) { return /^Done/.test(h); }),
      groupedHeads: grouped, dues: dues.length
    };
  });
  /* one list, so the only headings are Open, Done and Deleted -- no track
     names, and no Events either: *"don't create a seperate section for
     webinar - it breaks the whole continuos timeline flow"*. An event is a
     row inside Open now, in its date's place. */
  ok(tw26 + "px: Everything is not split by track",
     k26.heads.every(function (h) { return /^(Open|Done|Deleted)/.test(h); }), JSON.stringify(k26.heads));
  ok(tw26 + "px: the open tasks are in due-date order", k26.openSorted && k26.openCount > 0, JSON.stringify(k26));
  ok(tw26 + "px: done tasks are all at the bottom, in a Done section",
     k26.doneHead && k26.doneLast && k26.doneCount > 0, JSON.stringify(k26));
  ok(tw26 + "px: the Done section is in due-date order", k26.doneSorted, JSON.stringify(k26));
  /* choosing a category is the one place the track headings still earn their
     keep, so flattening Everything must not have taken them with it */
  ok(tw26 + "px: a chosen category still groups by track",
     k26.groupedHeads.some(function (h) { return !/^(Open|Done|Deleted)/.test(h); }),
     JSON.stringify(k26.groupedHeads));
  await s26.ctx.close();
}

/* ---- 27. the day a task was closed is recorded, and drawn ---- */
{
  var s27 = await open(1280);
  var before = await s27.p.evaluate(function () {
    setView("time");
    var i = alive().filter(function (x) { return x.status !== "done" && x.due; })[0];
    patch(i.id, { status: "done" });
    setView("time");
    var r = document.querySelector('#gantt .grow[data-id="' + i.id + '"]');
    return { id: i.id, doneAt: items[i.id].doneAt, today: iso(todayD()),
             dot: !!(r && r.querySelector(".gdn")),
             dotColour: r && r.querySelector(".gdn") ? getComputedStyle(r.querySelector(".gdn")).backgroundColor : null };
  });
  ok("ticking a task records the day it closed", before.doneAt === before.today, JSON.stringify(before));
  ok("and the timeline draws a green dot for it",
     before.dot && before.dotColour === "rgb(0, 169, 143)", JSON.stringify(before));
  /* the DFIELDS / diffOf pair: in memory this passes either way */
  await s27.p.reload({ waitUntil: "load" });
  var after = await s27.p.evaluate(function (id) {
    setView("time");
    var r = document.querySelector('#gantt .grow[data-id="' + id + '"]');
    return { doneAt: items[id].doneAt, dot: !!(r && r.querySelector(".gdn")) };
  }, before.id);
  ok("and it survives a reload, so it reaches his other device",
     after.doneAt === before.doneAt && after.dot, JSON.stringify(after));
  /* reopening it is not a close, so the dot has to go */
  var re = await s27.p.evaluate(function (id) {
    patch(id, { status: "todo" }); setView("time");
    var r = document.querySelector('#gantt .grow[data-id="' + id + '"]');
    return { doneAt: items[id].doneAt, dot: !!(r && r.querySelector(".gdn")) };
  }, before.id);
  ok("reopening a task clears the day it closed", !re.doneAt && !re.dot, JSON.stringify(re));
  await s27.ctx.close();
}

/* ---- 28. the axis starts last month, not at the oldest thing on the board ----
   "Why does the timeline chart start from June? Start it from Sep." It ran back
   to the earliest dated task, so four months of finished work squeezed what is
   ahead into the right-hand third. */
{
  var s28 = await open(1280);
  var k28 = await s28.p.evaluate(function () {
    setView("time");
    var t = todayD();
    var want = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    var MNS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var months = Array.prototype.map.call(document.querySelectorAll("#gantt .gax .gm div"),
      function (e) { return e.textContent; });
    /* a task dated before the axis is pinned to its left edge, not drawn off it */
    var old = alive().filter(function (i) { return i.due && D(i.due) < want; });
    var pinned = old.map(function (i) {
      var m = document.querySelector('#gantt .grow[data-id="' + i.id + '"] .gpt');
      return m ? { left: m.style.left, pre: m.classList.contains("pre") } : null;
    }).filter(Boolean);
    return { first: months[0], want: MNS[want.getMonth()] + " " + String(want.getFullYear()).slice(2),
             months: months.length, oldCount: old.length,
             allPinned: pinned.length > 0 && pinned.every(function (m) { return m.left === "0%" && m.pre; }) };
  });
  ok("the timeline starts the month before this one",
     k28.first === k28.want, JSON.stringify(k28));
  ok("and a task older than that pins to the left edge with its real date",
     k28.oldCount === 0 || k28.allPinned, JSON.stringify(k28));
  /* Overview on a wide screen used to be a column of part-filled rows -- the
     hero took five of twelve columns and the other seven were empty, and
     Needs attention then took a row to itself. Two tiles sharing a row is
     the whole of the fix, so that is what is measured. */
  var ov28 = await s28.p.evaluate(function () {
    setView("over");
    function top(sel){ var e=document.querySelector(sel); return e?Math.round(e.getBoundingClientRect().top):null; }
    function right(sel){ var e=document.querySelector(sel); return e?Math.round(e.getBoundingClientRect().right):null; }
    var st=document.getElementById("stage");
    return { hero: top(".hero.a"), att: top(".att"),
             tui: top(".hero.b"), pipe: top(".pipe"), mst: top(".mstack"),
             agd: top(".agd"), rcent: top(".rcent"), trk: top(".trk"),
             load: top(".load"), nwst: top(".nwst"), miles: top(".miles"),
             attR: right(".att"), stageR: Math.round(st.getBoundingClientRect().right) };
  });
  var st28 = await s28.p.evaluate(function () {
    setView("over");
    var e = document.querySelector(".bstamp");
    return e ? { t: e.textContent, h: e.offsetHeight } : null;
  });
  /* Which build the app is running has been the unanswerable question behind
     three separate bugs, and the toast that answers it only answers when a
     toast appears. */
  ok("Overview prints the build it is running",
     st28 && /^build \d{4}-\d{2}-\d{2}/.test(st28.t) && st28.h > 0, JSON.stringify(st28));
  ok("Overview puts the deadline and Needs attention on one row at 1280",
     ov28.hero !== null && ov28.hero === ov28.att, JSON.stringify(ov28));
  /* The pairing that always holds, whatever is on the board: News may be
     absent (it draws only when the map has one), so tuition's own row is not
     the thing to measure. */
  ok("and the two rings share their row with the critical path",
     ov28.mst !== null && ov28.mst === ov28.pipe, JSON.stringify(ov28));
  /* and the order he asked for on 2026-10-07: the calendar, then progress,
     then the workload chart, all of it above tuition -- with what has gone
     moved to the foot, *"to the bottom just above milestones"*. The explicit
     rows in the 1181px query mean DOM order is not what a desktop sees, so
     this has to be measured here as well as at 390. */
  ok("the calendar, progress and the workload chart sit above tuition at 1280",
     ov28.agd > ov28.hero && ov28.trk > ov28.agd && ov28.load > ov28.trk &&
     ov28.tui >= ov28.load, JSON.stringify(ov28));
  ok("and what has gone is at the foot, above the milestones, at 1280",
     ov28.rcent > ov28.pipe && ov28.miles > ov28.rcent, JSON.stringify(ov28));
  await s28.ctx.close();
}

/* A device whose map never arrived could not recover by reloading: the socket
   asks only for events above relaySeq and the folder pull skips a file it has
   read once by name. An empty map asks for everything once instead. */
{
  ok("an empty map asks the relay for the whole log",
     /"\/ws\?since="\+\(kbCold\?0:relaySeq\)/.test(src), "");
  ok("and re-reads the folder it had already marked seen",
     /if\(seenF\[f\.name\] && !kbCold\) return;/.test(src)
       && /kbCold=!kb\.length;/.test(src) && /kbCold=false;/.test(src), "");
}

/* ---- 29. the mind map ----
   It replaced the dependency view, so the first thing to prove is that the old
   one is actually gone rather than merely hidden. The rest is the lesson
   `deleted` taught: a new stored field that merges but never saves, or saves
   but never merges, fails silently and completely -- so every assertion here
   goes through a real merge and then a real reload. */
{
  var KB = [
    /* cards: peers, nothing in sequence */
    { id: "k-vmock", label: "VMock scores a CV draft", body: "Says what to fix before a human reads it.",
      group: "Platforms and tools", ord: 40, shape: "cards",
      cat: "work", item: "vmock", rel: ["k-cv"], at: "2026-10-05T09:00:00.000Z", by: "claude" },
    { id: "k-cv", label: "One INSEAD CV format", body: "Their template, used as a marketing document.",
      group: "Platforms and tools", ord: 40, shape: "cards",
      cat: "work", at: "2026-10-05T09:00:00.000Z", by: "claude" },
    /* timeline: the two webinars are the whole of his first complaint -- they
       belong together under what they are, dated, with the later one second --
       and the second of his: a sequence of dated events wants a rail, not a
       list. One is in the past so the hollow dot is exercised. */
    { id: "k-cvweb", label: "INSEAD CV & Cover Letter webinar", body: "What goes in the format and what stays out.",
      group: "Webinars and sessions", ord: 10, shape: "timeline", when: "13 November 2026", w: "2026-11-13",
      cat: "work", at: "2026-10-05T09:00:00.000Z", by: "claude" },
    { id: "k-pldpweb", label: "PLDP intro webinar", body: "Clarifies the P0 leadership assignments.",
      group: "Webinars and sessions", ord: 10, shape: "timeline", when: "05 November 2026", w: "2026-11-05",
      cat: "study", at: "2026-10-05T09:00:00.000Z", by: "claude" },
    { id: "k-past", label: "A session that already happened", body: "Its dot is hollow.",
      group: "Webinars and sessions", ord: 10, shape: "timeline", when: "02 October 2026", w: "2026-10-02",
      cat: "study", at: "2026-10-05T09:00:00.000Z", by: "claude" },
    /* calendar: the schedule he said was "all cluttered in a single paragraph".
       Three nodes pooling their rows onto one axis is the whole point -- a
       period, a break and a single date have to share a scale. */
    { id: "k-p0span", label: "P0, the pre-programme period", body: "Where he is now.",
      group: "Programme calendar", ord: 30, shape: "calendar", when: "26 Oct 2026 - 17 Jan 2027", w: "2026-10-26",
      cat: "study", at: "2026-10-05T09:00:00.000Z", by: "claude",
      rows: [{ t: "P0", a: "2026-10-26", b: "2027-01-17", k: "period" }] },
    { id: "k-cal", label: "Period dates, P1 to P5", body: "Provisional; INSEAD says they can move.",
      group: "Programme calendar", ord: 30, shape: "calendar", when: "18 Jan - 4 Dec 2027", w: "2027-01-18",
      cat: "study", at: "2026-10-05T09:00:00.000Z", by: "claude",
      rows: [{ t: "P1", a: "2027-01-18", b: "2027-03-10", k: "period" },
             { t: "P2", a: "2027-03-15", b: "2027-05-04", k: "period" }] },
    { id: "k-breaks", label: "Breaks", body: "Treks run in the short ones.",
      group: "Programme calendar", ord: 30, shape: "calendar", when: "Mar 2027", w: "2027-03-11",
      cat: "study", at: "2026-10-05T09:00:00.000Z", by: "claude",
      rows: [{ t: "Break", a: "2027-03-11", b: "2027-03-14", k: "break" }] },
    { id: "k-grad", label: "Graduation, Singapore", body: "Grad trip after.",
      group: "Programme calendar", ord: 30, shape: "calendar", when: "15 December 2027", w: "2027-12-15",
      cat: "study", at: "2026-10-05T09:00:00.000Z", by: "claude",
      rows: [{ t: "Graduation", a: "2027-12-15", k: "point" }] },
    { id: "k-cdc-coach", label: "Coaching sessions are 45 minutes", parent: "k-cv",
      body: "Short enough to fit before class.", cat: "work", at: "2026-10-05T09:00:00.000Z", by: "claude" },
    /* a shape this build has never heard of has to degrade to the list rather
       than draw nothing, or a future Claude naming one breaks the view */
    { id: "k-orphan", label: "A fact whose topic was deleted", parent: "k-ghost",
      group: "Everything else", shape: "sunburst",
      cat: "money", at: "2026-10-05T09:00:00.000Z", by: "claude" }
  ];
  var s29 = await open(390);

  var gone = await s29.p.evaluate(function () {
    var text = "";
    ["over", "board", "time", "cal", "map", "chat"].forEach(function (v) {
      setView(v); text += " " + (document.getElementById("v-" + v).innerText || "");
    });
    setView("over");
    return { tab: !!document.querySelector('.vt[data-v="graph"]'),
             sec: !!document.getElementById("v-graph"),
             fn: typeof window.renderGraph, edges: typeof window.drawEdges,
             word: /Dependencies/.test(text + Array.prototype.map.call(document.querySelectorAll(".vt"), function (e) { return e.getAttribute("aria-label") || ""; }).join(" ")),
             mapTab: !!document.querySelector('.vt[data-v="map"]') };
  });
  ok("the dependency view is gone, not hidden",
     !gone.tab && !gone.sec && gone.fn === "undefined" && gone.edges === "undefined", JSON.stringify(gone));
  ok("and the word Dependencies is nowhere on screen", !gone.word, JSON.stringify(gone));
  ok("the Mind map tab took its place", gone.mapTab, JSON.stringify(gone));

  /* a patch from Claude is the only way the map is ever filled, so that is the
     path the check uses -- not a hand-built localStorage blob */
  var filled = await s29.p.evaluate(async function (nodes) {
    applyRemote({ exportedAt: new Date().toISOString(), op: "patch", notes: [], changed: [], kb: nodes });
    setView("map");
    await new Promise(function (r) { setTimeout(r, 120); });
    var stored = JSON.parse(localStorage.getItem("mbacc_v3") || "{}");
    var txt = function (e) { return e ? e.innerText.replace(/\s+/g, " ").trim() : ""; };
    return { count: kb.length, stored: (stored.kb || []).length,
             /* the tabs are icons now: no tab carries a number at all */
             badge: Array.prototype.map.call(document.querySelectorAll(".vt"), function (b) { return b.innerText.trim(); }).join(""),
             roots: Array.prototype.map.call(document.querySelectorAll(".mrh"), txt),
             /* collapsed: no row of any shape is drawn yet */
             rows: document.querySelectorAll(".mn,.mtli,.mcard,.mcr").length,
             open: document.querySelectorAll(".mroot.open").length,
             hints: Array.prototype.map.call(document.querySelectorAll(".mrn"), txt),
             /* the name and the date are two lines, not one run-on */
             hintLines: Array.prototype.map.call(document.querySelectorAll(".mrn"), function (e) {
               var l = e.querySelector(".mrl"), w = e.querySelector(".mrw");
               return { l: l ? l.innerText.trim() : "", w: w ? w.innerText.trim() : "",
                        stacked: !!(l && w) && l.getBoundingClientRect().bottom <= w.getBoundingClientRect().top + 1,
                        lit: w ? getComputedStyle(w).color : "" };
             }),
             /* the whole shut block is the tap target, not only its heading */
             tapWhole: Array.prototype.every.call(document.querySelectorAll(".mroot"),
               function (e) { return e.hasAttribute("data-mg"); }),
             /* and the category strip is off this view entirely */
             subs: document.getElementById("subs").classList.contains("on"),
             /* the tint is derived from the group name, so two groups cannot
                share one unless the hash collides -- and every block has one */
             tints: Array.prototype.map.call(document.querySelectorAll(".mroot"),
               function (e) { return e.style.background; }) };
  }, KB);
  ok("a patch from Claude fills the map", filled.count === KB.length, JSON.stringify(filled));
  ok("and it is written to storage, not only held in memory",
     filled.stored === KB.length, JSON.stringify(filled));
  ok("no tab carries a number: they are icons", filled.badge === "", JSON.stringify(filled.badge));
  /* He threw out the first version in these words: "Why aren't all webinars
     just listed together under one 'webinar' section for example? Don't try to
     follow strict and very generic academic, life, career categorization." So
     the top level is what a thing is, and the four buckets are not in it. */
  ok("the top of the list is what a thing is, not a generic bucket",
     filled.roots.some(function (r) { return /Webinars and sessions/i.test(r); }) &&
     !filled.roots.some(function (r) { return /\b(Career|Academics|Student Life|Financial)\b/i.test(r); }),
     JSON.stringify(filled.roots));
  /* "Keep all group blocks collapsed by default" */
  ok("every group starts collapsed", filled.open === 0 && filled.rows === 0, JSON.stringify(filled));
  /* nine shut headers are an index of headings; one that says what is next in
     it is an index of answers, which is what makes collapsing them bearable */
  ok("and a shut group still says what is next inside it",
     filled.hints.length === filled.roots.length &&
     filled.hints.some(function (t) { return /^Next: /.test(t); }), JSON.stringify(filled.hints));
  /* "seperate the Next and Date into two seperate lines" -- run together they
     wrapped into each other and the date was the half that broke mid-word */
  var dated = filled.hintLines.filter(function (x) { return x.w; });
  ok("the name and its date are two lines, and the date is lit",
     dated.length > 0 && dated.every(function (x) { return x.stacked; }) &&
     dated.every(function (x) { return x.lit && !/128, 128, 128/.test(x.lit); }),
     JSON.stringify(filled.hintLines));
  /* "I should be able to tap anywhere on the group blocks to expand" */
  ok("a shut block is tappable anywhere, not only on its heading",
     filled.tapWhole, String(filled.tapWhole));
  /* the groups already answer what the strip was answering, and worse, they cut
     across it: filtering to Career chopped the Programme calendar in half */
  ok("and the category strip is off the map entirely", !filled.subs, String(filled.subs));
  /* "Give a light tint colour to each group blocks" -- taken from the block's
     position in JS, so a group invented next month gets one without a palette
     edit. Name-hashing came first and put the same colour on two of nine real
     groups, so what is checked is that no two blocks in a row match. */
  ok("each block carries its own tint, and no two in a row match",
     filled.tints.length > 2 && filled.tints.every(function (b) { return /rgba\(/.test(b); }) &&
     filled.tints.every(function (b, i) { return i === 0 || b !== filled.tints[i - 1]; }),
     JSON.stringify(filled.tints));

  /* the reload is the point: DFIELDS taught that a field can merge and never
     save, and pass every in-memory assertion on the way. `rows[]` and `shape`
     are new stored fields, so this is the check that would catch either of
     them merging without saving. */
  await s29.p.reload({ waitUntil: "load" });
  await s29.p.waitForTimeout(500);
  var kept = await s29.p.evaluate(async function () {
    setView("map");
    /* open every group, which is also the tap-to-open check. Each tap
       repaints the whole view, so the next header has to be looked up again --
       a cached NodeList is four detached elements after the first click. */
    /* a shut block carries data-mg on the block and again on its header, so
       the names have to be deduped or each group would be toggled twice */
    var names = [];
    Array.prototype.forEach.call(document.querySelectorAll("[data-mg]"), function (e) {
      if (names.indexOf(e.dataset.mg) < 0) names.push(e.dataset.mg);
    });
    for (var i = 0; i < names.length; i++) {
      document.querySelector('[data-mg="' + names[i] + '"]').click();
      await new Promise(function (r) { setTimeout(r, 40); });
    }
    var one = kb.filter(function (n) { return n.id === "k-cal"; })[0];
    return { count: kb.length, rows: one && one.rows ? one.rows.length : 0,
             shape: one ? one.shape : "", drawn: document.querySelectorAll(".mn,.mtli,.mcard").length,
             open: document.querySelectorAll(".mroot.open").length };
  });
  ok("the map survives a reload, so it reaches his other device",
     kept.count === KB.length && kept.drawn > 0, JSON.stringify(kept));
  ok("and the shape and its spans survive it too",
     kept.shape === "calendar" && kept.rows === 2, JSON.stringify(kept));
  ok("a group opens on a tap", kept.open === 4, JSON.stringify(kept));

  /* "each block might be best displayed in a completely different way": the
     shape is a field on the node and this is the one place it becomes markup */
  var shapes = await s29.p.evaluate(function () {
    var g = function (name) {
      var h = Array.prototype.filter.call(document.querySelectorAll(".mrh"), function (e) {
        return e.innerText.indexOf(name) >= 0; })[0];
      return h ? h.parentElement : null;
    };
    var web = g("Webinars"), cal = g("Programme calendar"), plat = g("Platforms"), els = g("Everything else");
    var dot = web ? web.querySelector('[data-kb="k-past"] > i') : null;
    var live = web ? web.querySelector('[data-kb="k-cvweb"] > i') : null;
    var bars = cal ? Array.prototype.map.call(cal.querySelectorAll(".mcb,.mcp"), function (e) {
      return { cls: e.className, left: e.style.left, w: e.style.width || "" }; }) : [];
    return {
      rail: !!(web && web.querySelector(".mtl")), dots: web ? web.querySelectorAll(".mtli > i").length : 0,
      past: !!(dot && /past/.test(dot.parentElement.className)),
      pastHollow: dot ? getComputedStyle(dot).backgroundColor : "",
      liveFilled: live ? getComputedStyle(live).backgroundColor : "",
      /* the chart pools three nodes' spans onto one axis */
      chart: !!(cal && cal.querySelector(".mcal")), bars: bars,
      months: cal ? cal.querySelectorAll(".mcam").length : 0,
      now: !!(cal && cal.querySelector(".mcnow")),
      /* and the prose still reads under it: a bar says when, never why */
      calProse: cal ? cal.querySelectorAll(".mn").length : 0,
      grid: !!(plat && plat.querySelector(".mcg")), cards: plat ? plat.querySelectorAll(".mcard").length : 0,
      /* a chart row whose label is cut off is a row you cannot identify;
         "Launch Week" ellipsised to "Launch ..." at 78px on a phone */
      cut: cal ? Array.prototype.filter.call(cal.querySelectorAll(".mcl"), function (e) {
        return e.scrollWidth > e.clientWidth; }).map(function (e) { return e.innerText; }) : ["(no chart)"],
      /* every bar says which days, not just where in the year */
      dates: cal ? Array.prototype.map.call(cal.querySelectorAll(".mcd"), function (e) {
        return e.innerText.trim(); }) : [],
      /* and no label runs off either end of the track */
      spill: cal ? Array.prototype.filter.call(cal.querySelectorAll(".mcd"), function (e) {
        var r = e.getBoundingClientRect(), t = e.parentElement.getBoundingClientRect();
        return r.left < t.left - 0.5 || r.right > t.right + 0.5;
      }).map(function (e) { return e.innerText; }) : ["(no chart)"],
      /* the task chip stays; the grey rel[] bubbles are gone from every shape */
      taskChips: document.querySelectorAll(".mtag.mitem").length,
      linkChips: document.querySelectorAll(".mtag:not(.mitem), [data-kbg]:not(.mal)").length,
      /* a date is the block's tint in every shape, never the grey it was in
         the list while the rail and the cards were colouring it */
      greyDates: Array.prototype.filter.call(document.querySelectorAll(".mn .mwhen"), function (e) {
        return !e.style.color; }).length,
      /* an unknown shape degrades to the list rather than drawing nothing */
      unknown: els ? els.querySelectorAll(".mn").length : -1,
      twisties: document.querySelectorAll(".mn .mtw, .mtli .mtw, .mcard .mtw").length
    };
  });
  ok("a sequence of dated events draws as a rail with a dot each",
     shapes.rail && shapes.dots === 3, JSON.stringify(shapes));
  /* where he is in the sequence, with nothing stored to say it */
  ok("and a dot whose date has passed is hollow",
     shapes.past && shapes.pastHollow !== shapes.liveFilled, JSON.stringify(shapes));
  /* "the program calendar are important dates all cluttered in a single
     paragraph" -- a schedule is a shape, not a paragraph */
  ok("a schedule draws as a month axis, not a paragraph",
     shapes.chart && shapes.months >= 14, JSON.stringify(shapes));
  /* the one line drawn once for the whole chart rather than per row; it is
     only there when today is actually inside the axis */
  ok("and today is marked on it", shapes.now, JSON.stringify(shapes));
  ok("four nodes' spans share one axis, a point and a break among them",
     shapes.bars.length === 5 && shapes.bars.filter(function (b) { return /mcp/.test(b.cls); }).length === 1 &&
     shapes.bars.filter(function (b) { return /br/.test(b.cls); }).length === 1,
     JSON.stringify(shapes.bars));
  ok("the chart is ordered left to right by date",
     shapes.bars.every(function (b, i) {
       return i === 0 || parseFloat(b.left) >= parseFloat(shapes.bars[i - 1].left); }),
     JSON.stringify(shapes.bars));
  ok("and the prose still reads under the chart", shapes.calProse === 4, JSON.stringify(shapes));
  ok("no chart row label is cut off", shapes.cut.length === 0, JSON.stringify(shapes.cut));
  /* "use the empty space to add the exact dates ... next to each bar" */
  ok("every bar says which days, in the empty space beside it",
     shapes.dates.length === shapes.bars.length &&
     shapes.dates.every(function (t) { return /^\d\d [A-Z][a-z]{2}/.test(t); }),
     JSON.stringify(shapes.dates));
  ok("and no date label runs off the track", shapes.spill.length === 0, JSON.stringify(shapes.spill));
  /* "Remove the linking grey bubbles. You can keep the linked task bubble." */
  ok("the task chip stays and the grey link bubbles are gone",
     shapes.taskChips > 0 && shapes.linkChips === 0, JSON.stringify(shapes));
  /* "In some sections the dates are grey - use brighter colour" */
  ok("no date is left grey in any shape", shapes.greyDates === 0, String(shapes.greyDates));
  ok("a set of peers draws as a grid", shapes.grid && shapes.cards === 2, JSON.stringify(shapes));
  ok("a shape this build has never heard of falls back to the list",
     shapes.unknown === 1, JSON.stringify(shapes));
  ok("and no row of any shape has a twisty to open", shapes.twisties === 0, String(shapes.twisties));

  /* a node whose parent no longer exists must still be reachable: an orphan in
     its group, never a node that simply stops being drawn */
  var orph = await s29.p.evaluate(function () {
    return !!document.querySelector('[data-kb="k-orphan"]');
  });
  ok("a fact whose parent is missing is still on screen", orph, String(orph));

  /* "instead of me rummaging through the dashboard": the board answers out of
     what it already holds, immediately, and says that Claude's answer follows */
  var ask = await s29.p.evaluate(async function () {
    var ta = document.getElementById("min");
    /* no mode button any more: "what is ..." has to read as a question on its
       own, which is the whole of what he asked for */
    ta.value = "what is vmock";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("msend").click();
    await new Promise(function (r) { setTimeout(r, 150); });
    var box = document.getElementById("mAns");
    var sent = notes.filter(function (n) { return n.kind === "ask"; });
    return { shown: !box.classList.contains("off"), text: box.innerText,
             asks: sent.length, travels: sent.length ? sent[0].forClaude !== false : false,
             /* every shape has to dim, or a search inside a card grid or a
                rail lights nothing and reads as having found nothing */
             dim: document.querySelectorAll(".mn.dim,.mtli.dim,.mcard.dim").length,
             hit: document.querySelectorAll(".mn.hit,.mtli.hit,.mcard.hit").length };
  });
  ok("an ask answers out of the map at once", ask.shown && /VMock/.test(ask.text), JSON.stringify(ask));
  ok("and says Claude's own answer is coming", /Claude/.test(ask.text), JSON.stringify(ask));
  ok("the ask still travels to Claude as a note", ask.asks === 1 && ask.travels, JSON.stringify(ask));
  ok("and the list dims what the question did not touch", ask.hit > 0 && ask.dim > 0, JSON.stringify(ask));

  /* a note is a fact to file, not a question: Claude has to be able to tell
     them apart, and the note is the only thing that reaches it */
  var fact = await s29.p.evaluate(async function () {
    var ta = document.getElementById("min");
    /* and a statement has to read as a fact to file */
    ta.value = "Statistics is taught in P1.";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("msend").click();
    await new Promise(function (r) { setTimeout(r, 150); });
    var f = notes.filter(function (n) { return n.kind === "fact"; });
    return { n: f.length, travels: f.length ? f[0].forClaude !== false : false,
             cleared: document.getElementById("mAns").classList.contains("off") };
  });
  ok("a note is sent as a fact to file", fact.n === 1 && fact.travels, JSON.stringify(fact));
  ok("and leaving Ask puts the whole list back", fact.cleared, JSON.stringify(fact));

  /* the link to the task is the point of filing it at all */
  var jump = await s29.p.evaluate(async function () {
    setView("map");
    /* a chip inside a shut block is not drawn at all, so make sure that one
       is open -- and do not toggle it shut if it already is */
    var ph = document.querySelector('[data-mg="Platforms and tools"]');
    if (!ph.parentElement.classList.contains("open")) {
      ph.click();
      await new Promise(function (r) { setTimeout(r, 80); });
    }
    var chip = document.querySelector('.mtag.mitem[data-go="vmock"]');
    if (!chip) return { chip: false };
    chip.click();
    await new Promise(function (r) { setTimeout(r, 200); });
    return { chip: true, open: document.getElementById("drawer").classList.contains("on"),
             title: document.getElementById("dTitle").innerText };
  });
  ok("a fact tied to a task opens that task", jump.chip && jump.open && /VMock/i.test(jump.title), JSON.stringify(jump));
  ok("the map draws without a console error", s29.errs.length === 0, s29.errs.join(" | "));
  await s29.ctx.close();
}

/* ---- 30. the composers ----
   Two boxes, one shape, and one rule he gave for both: *"On all chat/note
   texboxes, enter on my keyboard should be line break, not send."* It was the
   other way round, which stole the rest of a paragraph every time a sentence
   ended with a return. */
{
  var s30 = await open(390);
  var comp = await s30.p.evaluate(async function () {
    var out = {};
    for (var v of ["chat", "map"]) {
      setView(v);
      await new Promise(function (r) { setTimeout(r, 120); });
      var ta = document.getElementById(v === "chat" ? "cin" : "min");
      var btn = ta.parentElement.querySelector(".csend");
      var before = notes.length;
      ta.value = "First line";
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await new Promise(function (r) { setTimeout(r, 80); });
      var tr = ta.getBoundingClientRect(), br = btn.getBoundingClientRect();
      var box = ta.parentElement.getBoundingClientRect();
      out[v] = {
        /* Enter sent nothing and did not wipe what he had typed */
        sent: notes.length - before, kept: ta.value,
        /* and the arrow still does send */
        h: Math.round(tr.height), bh: Math.round(br.height),
        size: parseFloat(getComputedStyle(ta).fontSize),
        /* the button sits inside the box, not off its right edge */
        fits: br.right <= box.right + 0.5 && br.left >= box.left,
        ph: ta.placeholder, phFits: ta.scrollWidth <= ta.clientWidth + 1
      };
      ta.value = ""; ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    /* the mode switch is gone: the box works out which job it is doing */
    out.seg = document.querySelectorAll("[data-mm], .mseg").length;
    return out;
  });
  ["chat", "map"].forEach(function (v) {
    ok(v + " composer: Enter is a line break, not send",
       comp[v].sent === 0 && /First line/.test(comp[v].kept), JSON.stringify(comp[v]));
    /* under 16px iOS zooms the page on focus and stays zoomed */
    ok(v + " composer: the box is 16px and lines up with its send button",
       comp[v].size >= 16 && comp[v].h === comp[v].bh, JSON.stringify(comp[v]));
    ok(v + " composer: the send button is inside the box", comp[v].fits, JSON.stringify(comp[v]));
  });
  /* "The tell claude something worth is also too big" -- a placeholder cut off
     mid-phrase says less than a short one that fits */
  ok("the map placeholder fits the box it is in", comp.map.phFits, JSON.stringify(comp.map));
  /* "Don't have different options for add a note and ask - you can figure it
     out yourself based on input." */
  ok("there is no add-a-note / ask switch left", comp.seg === 0, String(comp.seg));
  ok("the composers draw without a console error", s30.errs.length === 0, s30.errs.join(" | "));
  await s30.ctx.close();
}

/* ---- 31. the bottom bar, the section title, and the newsletters ---- */
for (var bw of [390, 1280]) {
  var s31 = await open(bw);
  var bar = await s31.p.evaluate(function () {
    var app = document.querySelector(".app"), nav = document.querySelector(".vbar"),
        stage = document.querySelector(".stage"), fab = document.getElementById("fab");
    var nb = nav.getBoundingClientRect(), sb = stage.getBoundingClientRect(),
        fb = fab.getBoundingClientRect();
    return {
      last: app.lastElementChild === nav,
      /* it is at the foot of the screen and the stage ends where it begins */
      bottom: Math.round(innerHeight - nb.bottom), under: Math.round(nb.top - sb.bottom),
      tabs: Array.prototype.map.call(nav.querySelectorAll(".vt"), function (b) { return b.dataset.v; }),
      /* icons only: no tab has any text in it at all */
      words: Array.prototype.map.call(nav.querySelectorAll(".vt"), function (b) { return b.innerText.trim(); }).join(""),
      labelled: Array.prototype.every.call(nav.querySelectorAll(".vt"), function (b) { return !!b.getAttribute("aria-label"); }),
      /* the floating chat button must not sit on top of the bar */
      fabClear: fb.bottom <= nb.top,
      title: document.getElementById("vTitle").textContent
    };
  });
  ok(bw + "px: the sections are a bar at the foot of the screen",
     bar.last && bar.bottom <= 1 && Math.abs(bar.under) <= 1, JSON.stringify(bar));
  ok(bw + "px: five icons, and Chat is not one of them",
     bar.tabs.join(",") === "over,board,time,cal,map", JSON.stringify(bar.tabs));
  /* "with icons only" -- and an icon with no word still has to say its name to
     a screen reader, or the strip is five unlabelled buttons */
  ok(bw + "px: no tab carries a word, and every one carries its name",
     bar.words === "" && bar.labelled, JSON.stringify(bar));
  ok(bw + "px: the floating button clears the bar", bar.fabClear, JSON.stringify(bar));

  /* "The section title should only show up when the section is open" */
  var titles = await s31.p.evaluate(function () {
    var o = {};
    ["over", "board", "time", "cal", "map", "chat"].forEach(function (v) {
      setView(v); o[v] = document.getElementById("vTitle").textContent;
    });
    setView("over");
    return o;
  });
  ok(bw + "px: the title names the open section, and only it",
     titles.over === "Overview" && titles.map === "Mind map" && titles.chat === "Chat" &&
     titles.time === "Timeline", JSON.stringify(titles));

  /* "Make the text boxes in mindmap and claude chat floating above the new
     bottom section bar" -- a gap under the box, and nothing welded to the bar */
  for (var cv of ["chat", "map"]) {
    /* the view fades in on a 5px rise, so measuring it the same tick measures
       the animation rather than the layout */
    await s31.p.evaluate(function (v) { setView(v); }, cv);
    await s31.p.waitForTimeout(320);
    var fl = await s31.p.evaluate(function (v) {
      var box = document.querySelector("#v-" + v + " .cbox"),
          foot = document.querySelector("#v-" + v + " .cfoot"),
          nav = document.querySelector(".vbar");
      var b = box.getBoundingClientRect(), n = nav.getBoundingClientRect();
      var cs = getComputedStyle(box), fs = getComputedStyle(foot);
      return { gap: Math.round(n.top - b.bottom), radius: parseFloat(cs.borderTopLeftRadius),
               border: fs.borderTopWidth, right: Math.round(innerWidth - b.right) };
    }, cv);
    ok(bw + "px " + cv + ": the composer floats clear of the bar",
       fl.gap >= 4 && fl.radius >= 12 && fl.border === "0px" && fl.right >= 4, JSON.stringify(fl));
  }
  ok(bw + "px: the bar draws without a console error", s31.errs.length === 0, s31.errs.join(" | "));
  await s31.ctx.close();
}

/* ---- 32. a badge goes out where it was read ---- */
{
  /* Three kinds of note, and the drawer holds exactly one of them:
     *"don't include your replies to regular chats. Only the independant notes
     you add."* A Claude note on a task is in; a nudge is in; a reply in the
     thread and anything he wrote himself are the thread's. */
  var NOW32 = new Date().toISOString();
  var s32 = await open(390, [
    { id: "claude-onitem", from: "claude", itemId: "cv", itemTitle: "Rebuild CV in INSEAD format",
      text: "a note on a task", createdAt: NOW32, state: "new" },
    { id: "claude-reply", from: "claude", text: "a reply in the thread",
      createdAt: NOW32, state: "new" },
    { id: "mine", from: "me", text: "something he typed", createdAt: NOW32, state: "new" }
  ]);
  var badge = await s32.p.evaluate(function () {
    return document.getElementById("notesN").textContent;
  });
  await s32.p.click("#notesBtn");
  await s32.p.waitForTimeout(420);
  var after = await s32.p.evaluate(function () {
    var n = document.getElementById("notesN");
    var txt = document.getElementById("dBody").innerText || "";
    return { txt: n.textContent, unread: unread(),
             /* the ones that were new still say so on the list he is looking at */
             tags: document.querySelectorAll("#dBody .tagnew").length,
             cards: document.querySelectorAll("#dBody .nitem[data-nj]").length,
             hasTask: txt.indexOf("a note on a task") >= 0,
             hasReply: txt.indexOf("a reply in the thread") >= 0,
             hasMine: txt.indexOf("something he typed") >= 0,
             /* the composer and its two buttons are gone outright */
             composer: !!document.getElementById("gn"),
             btns: document.querySelectorAll("#dBody [data-gsave],#dBody [data-export]").length,
             title: document.getElementById("dTitle").textContent,
             /* the reply is still unread, because this drawer never showed it */
             replyState: notes.filter(function (x) { return x.id === "claude-reply"; })[0].state,
             itemState: notes.filter(function (x) { return x.id === "claude-onitem"; })[0].state };
  });
  ok("the drawer lists only Claude's own notes",
     after.cards === 1 && after.hasTask && !after.hasReply && !after.hasMine, JSON.stringify(after));
  ok("and takes nothing: no composer, no action buttons",
     !after.composer && after.btns === 0 && /from Claude/.test(after.title), JSON.stringify(after));
  /* "The all notes section on top right doesn't mark read once open - I need to
     open the chat section to mark it as read." */
  ok("opening the notes drawer is reading what it showed",
     badge === "2" && after.itemState === "read", JSON.stringify({ badge: badge, after: after }));
  ok("but not a reply it never showed", after.replyState === "new" && after.unread === 1,
     JSON.stringify(after));
  ok("and it still shows which of them were new", after.tags === 1, JSON.stringify(after));
  /* tapping one opens the thread on that message and marks it:
     *"it should open the chat, scroll to that note message and highlight that
     briefly. Like on WhatsApp."* */
  await s32.p.click("#dBody .nitem[data-nj]");
  await s32.p.waitForTimeout(600);
  var jump = await s32.p.evaluate(function () {
    var w = document.getElementById("chatw");
    var el = w.querySelector('.cmsg[data-nid="claude-onitem"]');
    var r = el ? el.getBoundingClientRect() : null, wr = w.getBoundingClientRect();
    return { view: view, drawer: document.getElementById("drawer").classList.contains("on"),
             found: !!el, flashed: !!el && el.classList.contains("cflash"),
             /* and it is actually on screen, not merely in the DOM */
             onScreen: !!r && r.top < wr.bottom && r.bottom > wr.top };
  });
  ok("tapping a note opens the thread on it, highlighted",
     jump.view === "chat" && !jump.drawer && jump.found && jump.flashed && jump.onScreen,
     JSON.stringify(jump));
  ok("no console error through the notes drawer", s32.errs.length === 0, s32.errs.join(" | "));
  await s32.ctx.close();
}

/* ---- 33. newsletters ---- */
{
  var s33 = await open(390);
  var NEWS = [
    { id: "nw-d", period: "daily", date: "2026-10-07", at: new Date().toISOString(),
      body: "## Due today\nPay the October instalment.\n## Overdue\nThe scholarship chase is three weeks past its date." },
    { id: "nw-w", period: "weekly", date: "2026-10-11", at: new Date().toISOString(),
      body: "## Risks\nThe visa appointment is the long pole." }
  ];
  var got = await s33.p.evaluate(async function (n) {
    applyRemote({ exportedAt: new Date().toISOString(), op: "patch", notes: [], changed: [], news: n });
    await new Promise(function (r) { setTimeout(r, 150); });
    var stored = JSON.parse(localStorage.getItem("mbacc_v3") || "{}");
    return { count: news.length, stored: (stored.news || []).length,
             badge: document.getElementById("newsN").textContent };
  }, NEWS);
  ok("a newsletter arrives through the same door as everything else",
     got.count === 2 && got.badge === "2", JSON.stringify(got));
  /* the DFIELDS lesson: in memory is not on disk, and a reload is the only
     thing that tells the two apart */
  ok("and it is written to this device, not just held in memory", got.stored === 2, JSON.stringify(got));
  await s33.p.reload({ waitUntil: "load" });
  await s33.p.waitForTimeout(500);
  await s33.p.click("#newsBtn");
  await s33.p.waitForTimeout(420);
  var shown = await s33.p.evaluate(function () {
    var rows = document.querySelectorAll("#dBody .nwi");
    return {
      n: rows.length,
      titles: Array.prototype.map.call(document.querySelectorAll("#dBody .nwh b"), function (b) { return b.textContent; }),
      /* every edition shut: sixty open reports is the wall the collapse prevents */
      open: document.querySelectorAll("#dBody .nwi.open").length,
      bodyH: rows[0].querySelector(".nwb").getBoundingClientRect().height,
      heads: rows[0].querySelectorAll(".nwb h4").length
    };
  });
  ok("it survives a reload and lists newest first",
     shown.n === 2 && shown.titles[0] === "Weekly Report \u2014 11 October 2026" &&
     shown.titles[1] === "Daily Brief \u2014 07 October 2026", JSON.stringify(shown));
  ok("every edition starts collapsed", shown.open === 0 && shown.bodyH === 0, JSON.stringify(shown));
  await s33.p.click("#dBody .nwi:last-child .nwh");
  await s33.p.waitForTimeout(260);
  var opened = await s33.p.evaluate(function () {
    var r = document.querySelector("#dBody .nwi:last-child");
    return { open: r.classList.contains("open"),
             h: r.querySelector(".nwb").getBoundingClientRect().height,
             heads: r.querySelectorAll(".nwb h4").length,
             badge: document.getElementById("newsN").classList.contains("off") };
  });
  ok("a tap on the title opens that edition", opened.open && opened.h > 20, JSON.stringify(opened));
  ok("its sections are headings, not one run of paragraphs", opened.heads === 2, JSON.stringify(opened));
  ok("and opening the drawer clears the newsletter badge", opened.badge, JSON.stringify(opened));
  ok("the newsletters draw without a console error", s33.errs.length === 0, s33.errs.join(" | "));
  await s33.ctx.close();
}

/* ---- 34. the trim: the bar, the composers, the search, dark mode ---- */
{
  var s34 = await open(390);
  var trim = await s34.p.evaluate(function () {
    setView("chat");
    var nav = document.querySelector(".vbar"), vt = document.querySelector(".vt"),
        head = document.querySelector(".vhead"), cmdk = document.getElementById("cmdkBtn"),
        foot = document.querySelector("#v-chat .cfoot"), box = document.querySelector("#v-chat .cbox"),
        ta = document.getElementById("cin");
    var hb = head.getBoundingClientRect(), cb = cmdk.getBoundingClientRect();
    return {
      /* "The bottom navigation bar is too thick" */
      tabH: Math.round(vt.getBoundingClientRect().height),
      barH: Math.round(nav.getBoundingClientRect().height),
      /* "behind the bauble should be transparent": the composer is positioned
         over the thread, so it paints no band of its own */
      pos: getComputedStyle(foot).position,
      footBg: getComputedStyle(foot).backgroundColor,
      /* "Make the bauble thinner" */
      boxH: Math.round(box.getBoundingClientRect().height),
      /* 16px is the iOS zoom threshold and stays; the placeholder is not what
         the zoom is read off, so it is the smaller thing he asked for */
      taSize: parseFloat(getComputedStyle(ta).fontSize),
      phSize: parseFloat(getComputedStyle(ta, "::placeholder").fontSize),
      /* "Move the find pin icon to the second bar on the right end" */
      searchInHead: head.contains(cmdk),
      searchInTop: !!document.querySelector(".top #cmdkBtn"),
      searchRight: Math.round(hb.right - cb.right)
    };
  });
  /* 46px first, then 52 on 2026-10-05: *"make the navigation bar at the bottom
     slight bigger - looks a little too thin"*. The ceiling is what matters --
     54 under the full home-bar inset was the 88px of chrome he objected to. */
  ok("the section bar is a thumb's height and no more",
     trim.tabH === 52 && trim.barH <= 58, JSON.stringify(trim));
  ok("the composer floats over the thread and paints no band of its own",
     trim.pos === "absolute" && /rgba\(0, 0, 0, 0\)|transparent/.test(trim.footBg), JSON.stringify(trim));
  ok("the bubble is thinner", trim.boxH <= 46 && trim.boxH > 24, JSON.stringify(trim));
  ok("the box stays 16px and only the placeholder shrinks",
     trim.taSize === 16 && trim.phSize < 16, JSON.stringify(trim));
  ok("search sits at the right of the title row, not in the top bar",
     trim.searchInHead && !trim.searchInTop && trim.searchRight <= 22, JSON.stringify(trim));

  /* "In the overview section, I am not able to scroll with finger on any of
     the milestone items." The rail stops being a rail at this width, and the
     pan-x that made it one was still refusing every vertical drag on it. */
  var pan = await s34.p.evaluate(function () {
    setView("over");
    var m = document.querySelector(".mline");
    return { ta: getComputedStyle(m).touchAction, tile: !!document.querySelector(".mstone") };
  });
  ok("a finger on a milestone scrolls the page",
     pan.tile && pan.ta !== "pan-x", JSON.stringify(pan));

  /* "Add a dark mode hidden switch - tapping on the logo/name 3 times" */
  var dark = await s34.p.evaluate(async function () {
    var brand = document.querySelector(".brand"), out = {};
    out.before = document.documentElement.getAttribute("data-theme");
    brand.click(); out.one = document.documentElement.getAttribute("data-theme");
    brand.click(); brand.click();
    await new Promise(function (r) { setTimeout(r, 60); });
    out.three = document.documentElement.getAttribute("data-theme");
    out.page = getComputedStyle(document.body).backgroundColor;
    out.stored = localStorage.getItem("mbacc_theme");
    /* the board blob must not carry it: a theme is a property of this screen,
       and syncing it would dim his laptop because he dimmed his phone */
    out.inBlob = /mbacc_theme|"theme"/.test(localStorage.getItem("mbacc_v3") || "");
    /* a toast painted with --ink is white on white once --ink is near-white */
    var t = document.getElementById("toast");
    out.toastBg = getComputedStyle(t).backgroundColor;
    out.toastFg = getComputedStyle(t).color;
    brand.click(); brand.click(); brand.click();
    await new Promise(function (r) { setTimeout(r, 60); });
    out.back = document.documentElement.getAttribute("data-theme");
    return out;
  });
  ok("one tap does not change the theme", !dark.before && !dark.one, JSON.stringify(dark));
  ok("three taps turn it on, and three more turn it off",
     dark.three === "dark" && !dark.back, JSON.stringify(dark));
  /* Not the dark purple it shipped as, and not the pure black that replaced
     it either: *"don't use pure black for the background, use gmail's dark
     mode shade"*. A neutral grey a step off black, so the panels on it can
     read as cards. */
  ok("the page is a neutral grey, neither purple nor pure black",
     dark.page === "rgb(27, 27, 27)", JSON.stringify(dark.page));
  ok("the theme is this device's, not the board's",
     dark.stored === "dark" && !dark.inBlob, JSON.stringify(dark));
  ok("the toast is still readable in the dark",
     dark.toastBg !== dark.toastFg && !/^rgb\(2[34][0-9]/.test(dark.toastBg), JSON.stringify(dark));
  ok("the trim draws without a console error", s34.errs.length === 0, s34.errs.join(" | "));
  await s34.ctx.close();
}

/* ---- 35. the dark theme he can actually read ----
   Seven things on 2026-10-05, all of them from three screenshots of the dark
   board: milestones first on Overview, a white strip above the app, grey text
   he could not read, a bar that had gone too thin, grey timeline bars, a
   calendar that could not tell done from pending, and a purple page. */
{
  var s35 = await open(390);

  /* "Move the milestone to the bottom of overview page" */
  var mord = await s35.p.evaluate(function () {
    setView("over");
    var t = Array.prototype.map.call(document.querySelectorAll("#bento > .tile"), function (e) {
      return e.className;
    });
    return { n: t.length, first: t[0] || "", last: t[t.length - 1] || "" };
  });
  ok("Overview opens on what is due, not on the milestones",
     mord.n > 2 && !/\bmiles\b/.test(mord.first), JSON.stringify(mord));
  ok("the milestone rail is the last tile on Overview",
     /\bmiles\b/.test(mord.last), JSON.stringify(mord));

  /* The strip was built to fill a translucent status bar, and the translucent
     status bar is what made the section bar float for seven rounds: it hands
     the page the whole screen and then resolves a percentage height and a
     `bottom` offset against different boxes. The bar sitting where it should
     is worth more than the strip at the top being painted, so both went back
     to what 09e98bd had. */
  var html35 = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok("the iOS status bar is opaque and dark, not translucent and not white",
     /apple-mobile-web-app-status-bar-style" content="black"/.test(html35), "meta");
  /* That meta is Safari's. A Home Screen icon added from Chrome on iOS is a
     manifest install and ignores it, so the strip is whatever the manifest
     says -- it was the brand orange, which is not a status bar colour, and
     what he got was white. The manifest names the same dark strip the board
     uses, so the icon comes out the same whichever browser added it. */
  {
    /* Read the manifest the page actually links to, not the one named here by
       habit: the link was repointed at a fresh URL precisely because the old
       one was being served out of his device's cache, and a check that keeps
       reading the old path would pass while the live icon reads something
       else. */
    var href35 = (/<link rel="manifest" href="([^"]+)"/.exec(html35) || [])[1];
    var mani = JSON.parse(fs.readFileSync(path.join(ROOT, href35), "utf8"));
    ok("the manifest the page links to paints the strip the same dark the board does",
       mani.theme_color === "#280a38" && mani.background_color === "#280a38",
       JSON.stringify({ href: href35, t: mani.theme_color, b: mani.background_color }));
    /* #f6f5f9 is the colour his strip measured. No manifest on this site may
       carry it again, whatever its filename. */
    var stale35 = fs.readdirSync(ROOT).filter(function (f) { return /\.webmanifest$/.test(f); })
      .filter(function (f) { return /f6f5f9/i.test(fs.readFileSync(path.join(ROOT, f), "utf8")); });
    ok("and no manifest on the site still carries the colour his strip was",
       stale35.length === 0, JSON.stringify(stale35));
  }
  ok("and the strip that only existed to fill it is gone",
     !/class="sbar"/.test(html35), "sbar");

  /* The one that actually mattered. An installed iOS app keeps whatever the
     page was at launch for the strip it reserves, so a theme applied at the
     foot of a 250KB file is applied too late -- the first frames paint light
     and the strip stays #f6f5f9 for the session. The theme must be on <html>
     before <body> is parsed, which is a question about source order, so that
     is what is asserted; the behaviour is checked underneath it. */
  {
    var headEnd = html35.indexOf("<body");
    var init35 = html35.indexOf('localStorage.getItem("mbacc_theme")');
    ok("the theme is applied in the head, before the body can paint light",
       init35 > -1 && headEnd > -1 && init35 < headEnd,
       JSON.stringify({ init: init35, body: headEnd }));

    /* In a session of its own: this one has to decide the theme before the
       page's first byte runs, and reloading the shared page would hand every
       later block a board in a state it did not set up. */
    var dk = await open(390);
    await dk.p.addInitScript(function () {
      try { localStorage.setItem("mbacc_theme", "dark"); } catch (e) {}
    });
    await dk.p.reload({ waitUntil: "domcontentloaded" });
    var first35 = await dk.p.evaluate(function () {
      var m = document.querySelector('meta[name="theme-color"]');
      return { theme: document.documentElement.getAttribute("data-theme"),
               tc: m && m.getAttribute("content"),
               page: getComputedStyle(document.body).backgroundColor };
    });
    ok("so a dark board never paints a light frame iOS could keep",
       first35.theme === "dark" && first35.tc === "#1b1b1b"
         && /27, 27, 27/.test(first35.page || ""),
       JSON.stringify(first35));
    await dk.ctx.close();
  }

  /* The one that actually mattered, and the reason this is measured rather
     than read: nothing the page *declares* was ever white, so every check
     that read a meta or a token passed while his phone showed a white strip.
     `html` carried no background at all -- the default canvas -- and inside
     an installed iOS app the fixed body does not always reach the top of the
     screen. The canvas is the only thing that can show there, in either
     theme, so the canvas is what is asserted. */
  {
    var canv = await s35.p.evaluate(function () {
      var r = {};
      setTheme("light"); r.light = getComputedStyle(document.documentElement).backgroundColor;
      setTheme("dark");  r.dark  = getComputedStyle(document.documentElement).backgroundColor;
      setTheme("light");
      return r;
    });
    var lum35 = function (c) {
      var m = /(\d+),\s*(\d+),\s*(\d+)/.exec(c || "");
      if (!m) return 255;
      return (+m[1] * 0.299 + +m[2] * 0.587 + +m[3] * 0.114);
    };
    ok("the html canvas is dark in both themes, so an uncovered strip can never be white",
       lum35(canv.light) < 60 && lum35(canv.dark) < 60, JSON.stringify(canv));
  }

  /* "the daily brief section looks too plane - it should read like a actual
     magazine editorial-level with colours and good spacing". The body already
     carried the structure; it was drawn as one grey paragraph run. */
  var brief = await s35.p.evaluate(function () {
    var h = newsBody("## Tomorrow\n- Plan Locus exit, due 7 Oct.\nThere is no resignation date on the board.\n## Not yours right now\n- SBI sanction letter, due 24 Oct.\nThe PoA was executed on 3 Oct.");
    var d = document.createElement("div"); d.className = "nwb"; d.style.display = "block";
    d.innerHTML = h; document.getElementById("dBody").appendChild(d);
    var secs = d.querySelectorAll(".nwsec");
    var hs = d.querySelectorAll("h4"), leads = d.querySelectorAll(".nwl");
    var r = {
      secs: secs.length, heads: hs.length, leads: leads.length,
      items: d.querySelectorAll(".nwit").length,
      tints: [].map.call(secs, function (x) { return getComputedStyle(x.querySelector("h4")).color; }),
      leadSize: parseFloat(getComputedStyle(leads[0]).fontSize),
      bodySize: parseFloat(getComputedStyle(leads[0].nextElementSibling).fontSize),
      lead: parseFloat(getComputedStyle(leads[0].nextElementSibling).lineHeight),
      rule: getComputedStyle(d.querySelector(".nwit")).borderLeftWidth
    };
    d.parentNode.removeChild(d);
    return r;
  });
  ok("a brief is sections, items and prose, not one run of paragraphs",
     brief.secs === 2 && brief.heads === 2 && brief.leads === 2 && brief.items === 2,
     JSON.stringify(brief));
  ok("each section takes its own colour by position",
     brief.tints[0] !== brief.tints[1] && !/128, 128, 128/.test(brief.tints.join()),
     JSON.stringify(brief.tints));
  ok("the item outweighs its prose, and the prose is set to be read",
     brief.leadSize > brief.bodySize && brief.lead / brief.bodySize >= 1.6
       && parseFloat(brief.rule) >= 2, JSON.stringify(brief));

  /* "Too much grey and it is hard to see" -- every ink has to clear 4.5:1 on
     the surface it is actually drawn on, which is what the first dark palette
     did not do (--ink4 was about 3:1). Measured, not read off a swatch. */
  var inks = await s35.p.evaluate(function () {
    document.documentElement.setAttribute("data-theme", "dark");
    var cs = getComputedStyle(document.documentElement);
    var o = { panel: cs.getPropertyValue("--panel").trim(), page: cs.getPropertyValue("--page").trim() };
    ["--ink", "--ink2", "--ink3", "--ink4"].forEach(function (k) { o[k] = cs.getPropertyValue(k).trim(); });
    document.documentElement.removeAttribute("data-theme");
    return o;
  });
  function lum(hex) {
    var m = hex.replace("#", "");
    if (m.length === 3) m = m[0] + m[0] + m[1] + m[1] + m[2] + m[2];
    var c = [0, 2, 4].map(function (i) {
      var v = parseInt(m.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  ["--ink", "--ink2", "--ink3", "--ink4"].forEach(function (k) {
    var r = ratio(inks[k], inks.panel);
    ok("dark " + k + " clears 4.5:1 on a panel", r >= 4.5, k + "=" + inks[k] + " ratio=" + r.toFixed(2));
  });
  ok("the dark page is Gmail's grey, not pure black",
     inks.page === "#1b1b1b", inks.page);

  /* "Make the navigation bar at the bottom slight bigger" -- and the floating
     button has to move with it, or it sits on top of the bar. */
  var barh = await s35.p.evaluate(function () {
    setView("over");
    var t = document.querySelector(".vt").getBoundingClientRect();
    var f = document.querySelector(".fab").getBoundingClientRect();
    var b = document.querySelector(".vbar").getBoundingClientRect();
    return { tab: t.height, gap: b.top - f.bottom };
  });
  ok("the section bar is taller than it was and still not thick",
     barh.tab >= 50 && barh.tab <= 56, JSON.stringify(barh));
  ok("the floating button still clears the taller bar",
     barh.gap > 4 && barh.gap < 30, JSON.stringify(barh));

  /* "Why are some timeline chart lines still grey?" -- To do was the one
     status whose colour said nothing. No status may be grey. */
  var bars = await s35.p.evaluate(function () {
    setView("time");
    var cols = Array.prototype.map.call(document.querySelectorAll(".gbar"), function (e) {
      return getComputedStyle(e).backgroundColor;
    });
    var leg = Array.prototype.map.call(document.querySelectorAll(".lgi i"), function (e) {
      return getComputedStyle(e).backgroundColor;
    });
    return { cols: cols, leg: leg };
  });
  function greyish(c) {
    var m = c.match(/(\d+), (\d+), (\d+)/); if (!m) return false;
    var r = +m[1], g = +m[2], b = +m[3];
    return Math.max(r, g, b) - Math.min(r, g, b) < 34;
  }
  ok("no status in the legend is grey", bars.leg.length >= 5 && !bars.leg.some(greyish),
     JSON.stringify(bars.leg));
  ok("no timeline bar is grey", bars.cols.length > 3 && !bars.cols.some(greyish),
     JSON.stringify(bars.cols.filter(greyish)));
  var op = await s35.p.evaluate(function () {
    setView("time");
    var b = document.querySelector(".gbar");
    var light = getComputedStyle(b).opacity;
    document.documentElement.setAttribute("data-theme", "dark");
    var dark = getComputedStyle(b).opacity;
    document.documentElement.removeAttribute("data-theme");
    return { light: +light, dark: +dark };
  });
  ok("a bar is not washed out to nothing on a black page",
     op.dark > op.light && op.dark >= 0.45, JSON.stringify(op));

  /* "Same problem with calendar view ... colour the box borders or text based
     on status and white for the date. And use striked out green text for
     completed ones, not grey." The agenda row is what he sees on a phone. */
  var cal = await s35.p.evaluate(async function () {
    setView("cal");
    await new Promise(function (r) { setTimeout(r, 340); });
    var rows = document.querySelectorAll(".calrow");
    if (!rows.length) return { none: true };
    var byStatus = {}, sameDate = true, first = null;
    Array.prototype.forEach.call(rows, function (e) {
      byStatus[getComputedStyle(e).borderLeftColor] = 1;
    });
    var d = document.querySelector(".arh b");
    var dateCol = d ? getComputedStyle(d).color : null;
    var ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
    return {
      borders: Object.keys(byStatus),
      lw: getComputedStyle(rows[0]).borderLeftWidth,
      dateCol: dateCol, ink: ink,
      title: getComputedStyle(rows[0].querySelector("b")).color
    };
  });
  ok("a calendar row carries its status on its own edge",
     !cal.none && parseFloat(cal.lw) >= 3 && cal.borders.length >= 1 && !cal.borders.some(greyish),
     JSON.stringify(cal));
  /* "white for the date" -- ink, which is near-white in the dark theme. The
     row for today is deliberately the orange instead, so the invariant is
     that it is never a muted grey, which is what --ink4 would have made it. */
  ok("the day number is not a muted grey",
     !cal.none && !greyish(cal.dateCol), JSON.stringify(cal));

  /* done has to be green and struck through, in both the agenda and the grid */
  var done = await s35.p.evaluate(async function () {
    var open = Object.keys(items).filter(function (k) { return items[k].due && items[k].status !== "done"; });
    var id = open[0];
    /* give it today's date so it lands in the month on screen, then close it */
    var t = new Date(); var k = t.toISOString().slice(0, 10);
    calCur = new Date(t.getFullYear(), t.getMonth(), 1);
    patch(id, { due: k, status: "done" }, null, true);
    setView("cal"); renderCal();
    await new Promise(function (r) { setTimeout(r, 60); });
    var row = document.querySelector('.calrow[data-id="' + id + '"]');
    if (!row) return { none: true, id: id };
    var b = row.querySelector("b"), cs = getComputedStyle(b);
    return { col: cs.color, line: cs.textDecorationLine, id: id };
  });
  ok("a completed task is struck-through green, not grey",
     !done.none && done.col === "rgb(0, 169, 143)" && /line-through/.test(done.line),
     JSON.stringify(done));

  /* the white-button-in-the-dark trap, the inverse of the --inkbg one */
  var solid = await s35.p.evaluate(function () {
    setView("over");
    document.documentElement.setAttribute("data-theme", "dark");
    var b = document.querySelector(".hbtn.solid");
    var o = b ? { bg: getComputedStyle(b).backgroundColor, fg: getComputedStyle(b).color } : null;
    document.documentElement.removeAttribute("data-theme");
    return o;
  });
  ok("the hero's solid button is readable in the dark",
     solid && solid.bg !== solid.fg && !/^rgb\(2[0-9][0-9], 2[0-9][0-9]/.test(solid.fg),
     JSON.stringify(solid));

  /* "Some items on the board are weirdly white" -- .card.late-i painted a
     white literal, which the dark pass missed. No surface may do that. */
  var white = await s35.p.evaluate(function () {
    setView("board");
    document.documentElement.setAttribute("data-theme", "dark");
    var bad = [];
    Array.prototype.forEach.call(document.querySelectorAll(".card,.tile,.grow,.calrow,.mroot,.nwi"), function (e) {
      var bg = getComputedStyle(e).backgroundImage + " " + getComputedStyle(e).backgroundColor;
      if (/rgb\(25[0-5], 25[0-5], 25[0-5]\)/.test(bg)) bad.push(e.className);
    });
    document.documentElement.removeAttribute("data-theme");
    return bad;
  });
  ok("nothing on the board is painted white in the dark", white.length === 0, white.join(", "));

  /* "Remove the done tasks from calendar view - just move them to a done
     section under like we did in the taskmap" */
  var cd = await s35.p.evaluate(async function () {
    var open = Object.keys(items).filter(function (k) { return items[k].due && items[k].status !== "done"; });
    var id = open[0], t = new Date(), k = t.toISOString().slice(0, 10);
    calCur = new Date(t.getFullYear(), t.getMonth(), 1);
    patch(id, { due: k, status: "done" }, null, true);
    setView("cal"); renderCal();
    await new Promise(function (r) { setTimeout(r, 60); });
    var box = document.getElementById("caldone");
    return {
      inBlock: !!box.querySelector('.calrow[data-id="' + id + '"]'),
      inGrid: !!document.getElementById("cgrid").querySelector('[data-id="' + id + '"]'),
      head: (box.querySelector(".gsec") || {}).textContent || "",
      anyDoneOnGrid: Array.prototype.some.call(
        document.getElementById("cgrid").querySelectorAll("[data-id]"),
        function (e) { return items[e.dataset.id] && items[e.dataset.id].status === "done"; })
    };
  });
  ok("a closed task leaves the month for the Done block",
     cd.inBlock && !cd.inGrid && !cd.anyDoneOnGrid, JSON.stringify(cd));
  ok("the Done block says how many there are", /Done\d+tasks?$/.test(cd.head.replace(/\s/g, "")), cd.head);

  /* it follows the month arrows like everything else on this view */
  var cdm = await s35.p.evaluate(async function () {
    calCur = new Date(calCur.getFullYear(), calCur.getMonth() + 1, 1);
    renderCal();
    await new Promise(function (r) { setTimeout(r, 60); });
    return document.getElementById("caldone").querySelectorAll(".calrow").length;
  });
  ok("the Done block is this month's, not the whole board's", cdm === 0, String(cdm));

  ok("the dark pass draws without a console error", s35.errs.length === 0, s35.errs.join(" | "));
  await s35.ctx.close();
}

/* ---- 36. the eleven off the Gmail-dark screenshots, 2026-10-05 ---- */
{
  var s36 = await open(390);

  /* "the next deadline and tuition cards are too big - make them still stand
     out but smaller" -- smaller, but still the gradient tiles */
  var hero = await s36.p.evaluate(function () {
    setView("over");
    var h = document.querySelector(".tile.hero.a");
    var t = document.querySelector(".tile.att");
    return {
      big: parseFloat(getComputedStyle(h.querySelector(".hcd")).fontSize),
      btns: h.querySelectorAll(".hbtn").length,
      opens: h.dataset.go || "",
      h: h.getBoundingClientRect().height,
      grad: /gradient/.test(getComputedStyle(h).backgroundImage),
      attEdge: getComputedStyle(t).borderLeftColor,
      attW: parseFloat(getComputedStyle(t).borderLeftWidth),
      attH3: getComputedStyle(t.querySelector("h3")).color
    };
  });
  /* "make the 'd late' normal size again - looks weird", and the three action
     buttons off it; the tile itself opens the task in their place. */
  ok("the countdown reads at sentence size", hero.big <= 18 && hero.big >= 12, String(hero.big));
  ok("the deadline hero carries no action buttons", hero.btns === 0 && !!hero.opens, JSON.stringify(hero));
  ok("and the hero still stands out", hero.grad && hero.h < 300, JSON.stringify(hero));
  /* "the needs attention block doesn't stand out enough - needs more colour" */
  ok("Needs attention carries the red it is about",
     hero.attW >= 3 && hero.attEdge === "rgb(224, 38, 60)" && hero.attH3 === "rgb(224, 38, 60)",
     JSON.stringify(hero));

  /* "the 'tomorrow' bubble on due tasks are too dark" */
  var chips = await s36.p.evaluate(function () {
    document.documentElement.setAttribute("data-theme", "dark");
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll(".tile.att .chip.d"), function (e) {
      var cs = getComputedStyle(e);
      out.push({ bg: cs.backgroundColor, fg: cs.color });
    });
    document.documentElement.removeAttribute("data-theme");
    return out;
  });
  function lumOf(c) {
    var m = c.match(/(\d+), (\d+), (\d+)/); if (!m) return 0;
    return (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
  }
  ok("a countdown bubble is readable on the dark board",
     chips.length > 0 && chips.every(function (c) { return lumOf(c.fg) > 0.42; }),
     JSON.stringify(chips));

  /* "move the in 15d text under the date" + "align the statuses across the
     board - they are a bit left or right to each other" */
  var agd = await s36.p.evaluate(function () {
    var rows = document.querySelectorAll(".agd .agr");
    if (!rows.length) return { none: true };
    var inDate = !!rows[0].querySelector(".agd-d .chip.d");
    var atRight = !!rows[0].querySelector(":scope > .chip.d");
    var lefts = Array.prototype.map.call(document.querySelectorAll(".tile.att .chip.d"), function (e) {
      return Math.round(e.getBoundingClientRect().left);
    });
    return { inDate: inDate, atRight: atRight, lefts: lefts, n: rows.length };
  });
  ok("the countdown sits under the date, not out at the row's edge",
     !agd.none && agd.inDate && !agd.atRight, JSON.stringify(agd));
  ok("every status chip in a column shares one left edge",
     agd.lefts.length > 1 && new Set(agd.lefts).size === 1, JSON.stringify(agd.lefts));

  /* "the nav section icons have dots ... they should go away once I open the
     section" */
  var dots = await s36.p.evaluate(async function () {
    /* make something late so the dots are lit at all */
    var id = Object.keys(items)[0];
    patch(id, { due: "2020-01-01", status: "todo" }, null, true);
    setView("over"); render();
    var lit = function () {
      return ["board", "time", "cal"].filter(function (k) {
        return document.getElementById("vd-" + k).classList.contains("on");
      });
    };
    var before = lit();
    setView("cal"); render();
    await new Promise(function (r) { setTimeout(r, 40); });
    return { before: before, after: lit() };
  });
  ok("a dot marks a section with something late in it", dots.before.length === 3, JSON.stringify(dots));
  ok("and it goes out on the section he has opened",
     dots.after.length === 2 && dots.after.indexOf("cal") === -1, JSON.stringify(dots));

  /* "change the search task button on top to magnifying glass icon" */
  var mg = await s36.p.evaluate(function () {
    var b = document.getElementById("cmdkBtn"), g = b.querySelector("svg.mg");
    return { has: !!g, shown: g ? g.getBoundingClientRect().width > 0 : false,
             circle: g ? !!g.querySelector("circle") : false };
  });
  ok("search is a drawn magnifying glass on a phone",
     mg.has && mg.shown && mg.circle, JSON.stringify(mg));

  /* "use colour bubble to show the changes to tasks ... But seperate the
     sections always, board changes and task changes" */
  var rec = await s36.p.evaluate(async function () {
    notes.push({ id: "claude-check-1", from: "claude", text: "Done.",
      createdAt: new Date().toISOString(), state: "read",
      acted: ["Plan Locus exit: To do \u2192 Done", "Added a Done section to Calendar"] });
    setView("chat"); renderChat();
    await new Promise(function (r) { setTimeout(r, 60); });
    var box = document.querySelector(".cdid");
    if (!box) return { none: true };
    var heads = Array.prototype.map.call(box.querySelectorAll("b"), function (e) { return e.textContent; });
    var r0 = box.querySelector(".acr");
    return {
      heads: heads,
      name: r0 ? r0.querySelector(".acn").textContent : null,
      from: r0 ? getComputedStyle(r0.querySelector(".acv.was")).color : null,
      to: r0 ? getComputedStyle(r0.querySelector(".acv.now")).color : null,
      prose: (box.querySelector(".acb") || {}).textContent || null
    };
  });
  ok("a task change renders as two coloured bubbles with an arrow",
     !rec.none && rec.name === "Plan Locus exit" &&
     rec.from === "rgb(255, 159, 0)" && rec.to === "rgb(0, 169, 143)", JSON.stringify(rec));
  ok("and board changes are a separate section, still prose",
     !rec.none && rec.heads.length === 2 && /Task/i.test(rec.heads[0]) && /Board/i.test(rec.heads[1]) &&
     /Done section/.test(rec.prose || ""), JSON.stringify(rec));

  /* "Add pull down to sync function" */
  var ptr = await s36.p.evaluate(async function () {
    setView("over");
    var st = document.getElementById("stage"), lab = document.getElementById("ptrL");
    st.scrollTop = 0;
    var called = 0, real = window.pullFromRepo;
    window.pullFromRepo = function () { called++; };
    function t(type, y) {
      st.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: st, clientY: y, clientX: 60 })]
      }));
    }
    t("touchstart", 200);
    t("touchmove", 240);
    var mid = { op: getComputedStyle(lab).opacity, tx: lab.style.transform };
    t("touchmove", 300);
    /* the arrow is the state now, not a word: it is round by the trip point
       and spinning once the sync is away */
    var ico = lab.querySelector("svg");
    var armed = ico.style.transform;
    t("touchend", 300);
    await new Promise(function (r) { setTimeout(r, 40); });
    var out = { called: called, mid: mid, armed: armed,
                busy: document.getElementById("ptr").classList.contains("spin"),
                words: lab.textContent.trim() };
    window.pullFromRepo = real;
    return out;
  });
  ok("a pull at the top of the view drags a label with the finger",
     parseFloat(ptr.mid.op) > 0 && /translateY/.test(ptr.mid.tx || ""), JSON.stringify(ptr.mid));
  ok("pulling past the trip point turns the arrow round and then syncs",
     /rotate\(1[0-9]{2}deg\)/.test(ptr.armed) && ptr.called === 1, JSON.stringify(ptr));
  ok("and it spins while the sync runs, with no words on it",
     ptr.busy === true && ptr.words === "", JSON.stringify(ptr));

  /* an ordinary scroll must not be eaten by it. The sync above holds the
     label up for its settle window, so wait that out first or this measures
     the previous gesture. */
  await s36.p.waitForTimeout(1000);
  var scr = await s36.p.evaluate(function () {
    var st = document.getElementById("stage"), lab = document.getElementById("ptrL");
    st.scrollTop = 0;
    function t(type, y) {
      st.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: st, clientY: y, clientX: 60 })]
      }));
    }
    t("touchstart", 300);
    var ev = new TouchEvent("touchmove", { bubbles: true, cancelable: true,
      touches: [new Touch({ identifier: 1, target: st, clientY: 240, clientX: 60 })] });
    st.dispatchEvent(ev);
    var out = { prevented: ev.defaultPrevented, op: getComputedStyle(lab).opacity };
    t("touchend", 240);
    return out;
  });
  ok("an upward drag is still an ordinary scroll",
     !scr.prevented && parseFloat(scr.op) === 0, JSON.stringify(scr));

  ok("the eleven draw without a console error", s36.errs.length === 0, s36.errs.join(" | "));
  await s36.ctx.close();
}

/* ---- 37. the nine off the re-bookmarked phone, 2026-10-05 ---- */
{
  var s37 = await open(390);

  /* "the bottom nav bar went up now" -- the bar gives back only what the home
     indicator needs, so the icons sit on the foot of the screen rather than
     floating above a band of nothing. Off an iPhone the inset is 0 and the
     floor is all that is left, which is why this reads the row rather than
     the padding; 39 checks the formula in the source. */
  var bar = await s37.p.evaluate(function () {
    var b = document.querySelector(".vbar");
    return {
      pad: parseFloat(getComputedStyle(b).paddingBottom),
      h: b.getBoundingClientRect().height,
      gap: Math.round(innerHeight - b.getBoundingClientRect().bottom)
    };
  });
  ok("the section bar is an icon row plus the indicator's clearance, no more",
     bar.h - bar.pad <= 53 && bar.pad <= 20, JSON.stringify(bar));
  ok("and it sits on the bottom of the screen", bar.gap === 0, JSON.stringify(bar));

  /* "the nav icon dots still don't go away after opening" -- setView alone has
     to put it out; it used to wait for the next render, which is a poll or an
     edit away. */
  var dots = await s37.p.evaluate(function () {
    setView("over"); render();
    var before = [].map.call(document.querySelectorAll(".vd.on"), function (d) { return d.id; });
    setView("cal");   /* no render() -- that is the whole point */
    var after = [].map.call(document.querySelectorAll(".vd.on"), function (d) { return d.id; });
    setView("over");
    return { before: before, after: after };
  });
  ok("a tab change alone puts that section's dot out",
     dots.before.indexOf("vd-cal") >= 0 && dots.after.indexOf("vd-cal") < 0, JSON.stringify(dots));
  ok("and leaves the other sections' dots alone",
     dots.after.indexOf("vd-time") >= 0, JSON.stringify(dots));

  /* "the new alignment aligns the boxes but not the text" */
  var chip = await s37.p.evaluate(function () {
    setView("over");
    var c = document.querySelector(".arow .chip.d");
    var st = getComputedStyle(c);
    return { just: st.justifyContent, min: parseFloat(st.minWidth) };
  });
  ok("a countdown chip centres its text inside the box",
     chip.just === "center" && chip.min >= 60, JSON.stringify(chip));

  /* "the done tasks should be striked out in the overview steps part as well" */
  var step = await s37.p.evaluate(function () {
    setView("over");
    var d = document.querySelector(".steps .step.done b");
    if (!d) return { none: true };
    var st = getComputedStyle(d);
    return { line: st.textDecorationLine, col: st.color };
  });
  ok("a closed visa step is struck through and green",
     /line-through/.test(step.line || "") && step.col === "rgb(0, 169, 143)", JSON.stringify(step));

  /* "in critical path to start, the boxes move slightly when scrolling" --
     iOS keeps :hover through a scroll, so the lift is mouse-only now. */
  var css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  var lift = {
    guarded: (css.match(/@media \(hover:hover\)\s*\{[^}]*\.pn:hover/g) || []).length,
    bare: (css.match(/\n\.pn:hover\s*\{/g) || []).length
  };
  ok("the critical-path lift is mouse-only", lift.guarded === 1 && lift.bare === 0, JSON.stringify(lift));

  /* "the top right boxes notes, search, newsletter are not the same size" */
  var tb = await s37.p.evaluate(function () {
    return [].map.call(document.querySelectorAll(".tbtn"), function (b) {
      var r = b.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), off: b.classList.contains("off") };
    }).filter(function (b) { return !b.off; });
  });
  ok("every top-bar button is the same box on a phone",
     tb.length >= 2 && tb.every(function (b) { return b.w === tb[0].w && b.h === tb[0].h; }), JSON.stringify(tb));

  /* "move these 2 boxes of days to fontainbleu and tasks complete side by side" */
  var ms = await s37.p.evaluate(function () {
    setView("over");
    var t = document.querySelectorAll(".mstack .tile");
    if (t.length < 2) return { n: t.length };
    var a = t[0].getBoundingClientRect(), b = t[1].getBoundingClientRect();
    return { n: t.length, sameRow: Math.abs(a.top - b.top) < 2, apart: b.left > a.right - 1 };
  });
  ok("the two metric tiles sit side by side", ms.n === 2 && ms.sameRow && ms.apart, JSON.stringify(ms));

  ok("the nine draw without a console error", s37.errs.length === 0, s37.errs.join(" | "));
  await s37.ctx.close();
}

/* ---- 38. the six off the deployed phone, 2026-10-05 ---- */
{
  var s38 = await open(390);

  /* "the dots are gone when I open it but it comes back when I go to another
     section" -- opening it is reading it, and only a change in what is late
     brings it back. */
  var dot = await s38.p.evaluate(function () {
    setView("over"); render();
    var lit = function () { return [].map.call(document.querySelectorAll(".vd.on"), function (d) { return d.id; }); };
    var before = lit();
    setView("cal");
    var open1 = lit();
    setView("time");
    var away = lit();          /* back on another view: cal must stay out */
    render();                  /* and a repaint must not relight it either */
    var painted = lit();
    setView("over");
    return { before: before, open1: open1, away: away, painted: painted };
  });
  ok("a section he has opened keeps its dot out",
     dot.before.indexOf("vd-cal") >= 0 && dot.away.indexOf("vd-cal") < 0, JSON.stringify(dot));
  ok("and a repaint does not bring it back",
     dot.painted.indexOf("vd-cal") < 0 && dot.painted.indexOf("vd-board") >= 0, JSON.stringify(dot));

  /* "can't scroll back up on mindmap and chat - it considers it a refresh
     pull". Those views scroll inside themselves, so the stage is always at 0
     and every downward drag looked like a pull. */
  var eat = await s38.p.evaluate(function () {
    setView("chat");
    var st = document.getElementById("stage");
    function t(type, y) {
      return st.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: st, clientY: y, clientX: 60 })]
      }));
    }
    t("touchstart", 200);
    var ok1 = t("touchmove", 300);   /* false means preventDefault: the pull ate it */
    t("touchend", 300);
    setView("over");
    return { chat: ok1, opacity: getComputedStyle(document.getElementById("ptrL")).opacity };
  });
  ok("a drag in Chat is a scroll, not a pull-to-sync",
     eat.chat === true && parseFloat(eat.opacity) === 0, JSON.stringify(eat));

  /* "just keep the 41 things remembered and move it next to the section
     title", and nothing under the map's own composer. */
  var sub = await s38.p.evaluate(function () {
    kb = [{ id: "k1", group: "Platforms", label: "VMock", body: "scores a CV", at: Date.now() }];
    setView("map"); renderMap();
    var onMap = document.getElementById("vSub").textContent;
    setView("over");
    return { onMap: onMap, offMap: document.getElementById("vSub").textContent,
             tip: !!document.getElementById("mapTip") };
  });
  ok("the map's count sits beside the section name", /1 thing remembered/.test(sub.onMap), JSON.stringify(sub));
  ok("and it is that view's alone, with no paragraph under the map",
     sub.offMap === "" && sub.tip === false, JSON.stringify(sub));

  /* "make the 1d late slightly bigger than the text below and all caps" */
  var cd = await s38.p.evaluate(function () {
    setView("over");
    var h = document.querySelector(".tile.hero.a");
    return {
      cd: parseFloat(getComputedStyle(h.querySelector(".hcd")).fontSize),
      caps: getComputedStyle(h.querySelector(".hcd")).textTransform,
      sub: parseFloat(getComputedStyle(h.querySelector(".sub")).fontSize)
    };
  });
  ok("the countdown leads the card, in caps", cd.caps === "uppercase" && cd.cd > cd.sub, JSON.stringify(cd));

  /* "center them on their boxes" */
  var ms = await s38.p.evaluate(function () {
    setView("over");
    var t = document.querySelector(".mstack .tile");
    var box = t.getBoundingClientRect(), r = t.querySelector(".ring").getBoundingClientRect();
    return { off: Math.round(Math.abs((r.left + r.right) / 2 - (box.left + box.right) / 2)),
             align: getComputedStyle(t.querySelector(".mx")).textAlign };
  });
  ok("the metric tiles centre their contents", ms.off <= 1 && ms.align === "center", JSON.stringify(ms));

  ok("the six draw without a console error", s38.errs.length === 0, s38.errs.join(" | "));
  await s38.ctx.close();
}

/* ---- 39. the seven off the Calendar screenshot, 2026-10-05 ---- */
{
  var s39 = await open(390);

  /* "the dates don't align with the boxes on the calendar" */
  var cal = await s39.p.evaluate(function () {
    setView("cal");
    var d = document.querySelector(".ard");
    if (!d) return { none: true };
    var h = d.querySelector(".arh").getBoundingClientRect(),
        l = d.querySelector(".arl").getBoundingClientRect();
    return { off: Math.round(Math.abs((h.top + h.bottom) / 2 - (l.top + l.bottom) / 2)) };
  });
  ok("the agenda date sits level with the box it labels", cal.off <= 2, JSON.stringify(cal));

  /* "the nav bar is still floating ... it looks like it still maintaining
     space for chrome's nav section". Every previous attempt was a guess at
     what a viewport unit resolves to inside an installed iOS app; .app is
     now a fixed box at inset:0, so no unit is involved and the only way the
     bar can float is a regression back to one. */
  var bar = await s39.p.evaluate(function () {
    var b = document.querySelector(".vbar");
    var app = document.querySelector(".app"), ac = getComputedStyle(app);
    var r = app.getBoundingClientRect();
    return { pos: ac.position, top: Math.round(r.top), h: Math.round(r.height),
             win: innerHeight, pad: parseFloat(getComputedStyle(b).paddingBottom),
             gap: Math.round(innerHeight - b.getBoundingClientRect().bottom) };
  });
  /* 09e98bd's geometry, restored: an ordinary block filling the fixed body.
     Seven attempts at being cleverer -- height:100% on a fixed body, 100dvh,
     a painted ::after, inset:0, three clamps, a measured --vtop -- each came
     back wrong in one direction or the other. */
  ok("the app is an ordinary block filling the fixed body",
     bar.pos === "relative" && bar.top === 0 && bar.h === bar.win, JSON.stringify(bar));
  ok("and the bar reaches the bottom of it", bar.gap === 0, JSON.stringify(bar));
  var barSrc = /\.app\{([^}]*)\}/.exec(src);
  ok("no viewport-height unit decides the app's height",
     !!barSrc && !/\d(dv|sv|lv|v)h/.test(barSrc[1]), barSrc && barSrc[1]);
  /* Half of what the home indicator declares clears it and gives the board the
     rest back -- 09e98bd's formula, restored with its geometry. */
  var padSrc = /--barpad:([^;]*);/.exec(src);
  ok("the section bar gives back half the home-bar inset",
     !!padSrc && /env\(safe-area-inset-bottom\) \/ 2/.test(padSrc[1]), padSrc && padSrc[1]);
  ok("the app is sized by a plain percentage of the body, nothing cleverer",
     /\.app\{[^}]*height:100%[^}]*\}/.test(src), "");
  ok("and no inset correction is left anywhere in the layout",
     !/--vtop/.test(src), "");
  /* Seven rounds of this bug went on measuring his screenshots in pixels to
     work out which number was wrong. The device knows all of them, and the
     line goes to the audit log rather than over the top of the board. */
  ok("and the board still reports what the layout resolved to",
     /function layoutLine\(\)/.test(src) && /" ins"\+Math\.round\(insTop\)/.test(src)
       && /" pct"\+Math\.round\(pctH\(\)\)/.test(src), "");
  /* "it says you're on the latest version" is only useful with the number on
     it; without one, which build he is looking at can only be worked out by
     measuring a screenshot. */
  /* "Remove the today word on the timeline chart - instead, add today date
     next to the line in orange". The word printed over the month it stood on,
     and said less than the date it was marking. */
  /* The view's key is "time", not "plan" -- setView with a key that is in no
     section hides every view, and then the axis it is measuring is 0 tall and
     the assertion is comparing nothing to nothing. */
  await s39.p.evaluate(function () { setView("time"); });
  await s39.p.waitForTimeout(120);
  var now = await s39.p.evaluate(function () {
    var n = document.querySelector(".gnow");
    if (!n) return null;
    var cs = getComputedStyle(n, "::after");
    var ax = document.querySelector(".gax");
    return { d: n.getAttribute("data-d"), content: cs.content,
             colour: cs.color, top: parseFloat(cs.top),
             axh: ax ? ax.offsetHeight : 0,
             sech: document.querySelector(".gsec") ? document.querySelector(".gsec").offsetHeight : 0 };
  });
  ok("the today line carries the date, not the word",
     now && /^\d/.test(now.d || "") && !/today/i.test(now.content || ""), JSON.stringify(now));
  ok("in orange, in the row under the month axis",
     now && now.colour === "rgb(255, 100, 41)"
       && now.top >= now.axh && now.top < now.axh + now.sech, JSON.stringify(now));
  ok("the version toast names the build", /latest version \("\+BUILD\+"\)/.test(src), "");
  /* The readout belongs in the log, not over the top of the board on every
     sync -- and it only goes when a number actually changed. */
  ok("and says nothing else", !/latest version[^;]*layoutLine/.test(src), "");
  ok("the layout readout goes to the audit log instead",
     /RELAY\+"\/diag"/.test(src) && /line===was\) return/.test(src), "");
  /* A badge that hangs off the corner of its button is over the page, not
     over the orange, so translucent white came out as a grey smudge. */
  var badge = await s39.p.evaluate(function () {
    var n = document.getElementById("notesN");
    n.classList.remove("off"); n.textContent = "3";
    var c = getComputedStyle(n);
    return { bg: c.backgroundColor, fg: c.color };
  });
  ok("the notes badge carries the brand orange on a phone",
     badge.bg === "rgb(255, 100, 41)" && badge.fg === "rgb(255, 255, 255)", JSON.stringify(badge));

  /* "the pencil icon of all notes is too small" */
  var pen = await s39.p.evaluate(function () {
    return [].map.call(document.querySelectorAll(".tbtn svg"), function (g) {
      return Math.round(g.getBoundingClientRect().width);
    });
  });
  ok("the notes pencil is a drawn icon the size of its neighbours",
     pen.length >= 2 && pen.every(function (w) { return w === pen[0]; }), JSON.stringify(pen));

  /* "in the task timeline chart when I scroll right, freeze the task names" */
  var frz = await s39.p.evaluate(function () {
    setView("time");
    var sc = document.querySelector(".gscroll"), gl = document.querySelector(".grow .gl");
    var before = gl.getBoundingClientRect().left;
    sc.scrollLeft = 420;
    var after = gl.getBoundingClientRect().left;
    var pos = getComputedStyle(gl).position, bg = getComputedStyle(gl).backgroundColor;
    sc.scrollLeft = 0;
    return { before: Math.round(before), after: Math.round(after), pos: pos, bg: bg };
  });
  ok("the task names hold still while the months scroll",
     frz.pos === "sticky" && Math.abs(frz.after - frz.before) <= 1, JSON.stringify(frz));
  ok("and the frozen column is opaque, not see-through",
     !/rgba\(0, 0, 0, 0\)/.test(frz.bg), JSON.stringify(frz));

  /* "add 3 buttons below the actions table ... remove the delete button at
     the bottom ... similar size as the close and note button" */
  var qr = await s39.p.evaluate(function () {
    openItem("locus-exit");
    var q = document.querySelectorAll(".qrow .qb");
    var close = document.querySelector('[data-done="1"]');
    var out = { n: q.length, h: q.length ? Math.round(q[0].getBoundingClientRect().height) : 0,
                closeH: Math.round(close.getBoundingClientRect().height),
                cols: [].map.call(q, function (b) { return getComputedStyle(b).color; }),
                oldDel: !!document.querySelector(".dsave .del") };
    hideDrawer();
    return out;
  });
  ok("the card carries three coloured quick actions", qr.n === 3 && !qr.oldDel, JSON.stringify(qr));
  ok("each is its own colour and the size of the Close button",
     new Set(qr.cols).size === 3 && qr.h >= 40 && qr.h <= qr.closeH, JSON.stringify(qr));

  /* "the how long field is for you to fill" -- every open task in SEED now
     carries one, and every value is a real EFFORT key. */
  var ef = await s39.p.evaluate(function () {
    var open = SEED.filter(function (s) { return s.s !== "done"; });
    var keys = EFFORT.map(function (e) { return e.k; });
    return { open: open.length,
             set: open.filter(function (s) { return keys.indexOf(s.ef) >= 0; }).length,
             doneWith: SEED.filter(function (s) { return s.s === "done" && s.ef; }).length };
  });
  ok("every open task says how long it takes", ef.open === ef.set && ef.open > 30, JSON.stringify(ef));
  ok("and a closed task carries no estimate nobody made", ef.doneWith === 0, JSON.stringify(ef));

  ok("the seven draw without a console error", s39.errs.length === 0, s39.errs.join(" | "));
  await s39.ctx.close();
}

/* ---- 40. a SEED change is not an edit he made ----
   The Locus exit date came back to the day he had dropped it on, hours after
   the morning pass had corrected it. The correction moved the task to the date
   SEED now carries, so `diffOf` stopped emitting that field -- and on the
   device that had not read the patch, `save()` saw two sparse diffs disagree,
   read it as a fresh edit, and stamped a STALE value with the current clock.
   That then outranked the correction everywhere. The clock means "when he
   changed this", so it may only move when the resolved values move. */
{
  var s40 = await open(390);
  var seedy = await s40.p.evaluate(function () {
    var sd = SEED.filter(function (x) { return x.d && x.s; })[0];
    return { id: sd.id, status: sd.s, due: sd.d };
  });
  /* a stored diff that names a field SEED has since absorbed, beside one it
     has not: exactly the shape a SEED move leaves behind */
  var held = await s40.p.evaluate(function (q) {
    var blob = JSON.parse(localStorage.getItem("mbacc_v3") || "{}");
    blob.v = 3;
    blob.items = {};
    blob.items[q.id] = { status: q.status, due: "2026-10-07" };
    blob.touched = {}; blob.touched[q.id] = "2026-10-04T13:02:54.344Z";
    localStorage.setItem("mbacc_v3", JSON.stringify(blob));
    return true;
  }, seedy);
  await s40.p.goto(URL_ + "?v=seedmove-" + Date.now(), { waitUntil: "load" });
  await s40.p.waitForTimeout(600);
  var kept = await s40.p.evaluate(function (q) {
    save();
    var blob = JSON.parse(localStorage.getItem("mbacc_v3") || "{}");
    return { mem: touched[q.id], stored: (blob.touched || {})[q.id],
             due: items[q.id].due,
             sent: changedItems().filter(function (c) { return c.id === q.id; })[0] };
  }, seedy);
  ok("a field SEED absorbed does not restamp the item's clock",
     kept.mem === "2026-10-04T13:02:54.344Z" && kept.stored === "2026-10-04T13:02:54.344Z",
     JSON.stringify(kept));
  ok("and the value it still holds travels with that same old clock",
     kept.sent && kept.sent.at === "2026-10-04T13:02:54.344Z" && kept.sent.due === "2026-10-07",
     JSON.stringify(kept.sent));
  /* and the clock still has to move for a change he really made, or the
     two-device merge loses every edit instead of only this one */
  var moved = await s40.p.evaluate(function (q) {
    patch(q.id, { due: "2027-01-09" });
    save();
    return { mem: touched[q.id], due: items[q.id].due };
  }, seedy);
  ok("an edge he really moved still takes the current clock",
     moved.due === "2027-01-09" && moved.mem > "2026-10-04T13:02:54.344Z", JSON.stringify(moved));
  /* the whole point: a patch dated after the stale clock survives the other
     device publishing what it still holds */
  var won = await s40.p.evaluate(function (q) {
    mergePayload({ op: "patch", exportedAt: "2026-10-07T02:08:40.000Z",
      changed: [{ id: q.id, at: "2026-10-07T02:08:40.000Z", due: "2026-12-06" }], notes: [] });
    save();
    var before = items[q.id].due;
    mergePayload({ exportedAt: new Date().toISOString(),
      changed: [{ id: q.id, title: items[q.id].title, status: items[q.id].status,
                  due: "2026-10-07", priority: items[q.id].priority, snoozes: 0,
                  origDue: null, manual: true, effort: null, deleted: false,
                  at: "2026-10-04T13:02:54.344Z" }], notes: [] });
    save();
    return { before: before, after: items[q.id].due };
  }, seedy);
  ok("a correction is not undone by a device republishing the old value",
     won.before === "2026-12-06" && won.after === "2026-12-06", JSON.stringify(won));
  ok("no console errors through the clock checks", s40.errs.length === 0, s40.errs.join(" | "));
  await s40.ctx.close();
}

/* ---- 41. a webinar is an event, not a task ----
   "Remove all tasks for webinars - it should only be on the calendar as an
   'event'. It is a schedule not a task. It should still show up on the
   timeline view so rename that section to 'timeline'." Each of these was a
   way to get half of it right: out of the task list, on the Calendar, on the
   Timeline, and promising no tap it cannot honour. */
for (var ew of [390, 1280]) {
  var s41 = await open(ew);
  var e41 = await s41.p.evaluate(function () {
    setView("time");
    var tl = document.getElementById("gantt").innerText || "";
    var taskRows = document.querySelectorAll("#gantt .grow").length;
    var eventRows = document.querySelectorAll("#gantt .gerow").length;
    var poolN = pool().length;
    /* walk the calendar forward far enough to pass every event's month */
    setView("cal");
    var found = {};
    for (var n = 0; n < 5; n++) {
      /* The wide grid truncates a chip's text at 21 characters, so reading
         innerText found only the one short title and the check failed on its
         own matching rather than on the board. The full text is in `title`
         on the grid and in the row's own text on the agenda, so take both. */
      var full = Array.prototype.map.call(
        document.querySelectorAll("#cgrid .evt"), function (e) { return e.title || ""; })
        .concat(Array.prototype.map.call(
        document.querySelectorAll("#cgrid .evtr"), function (e) { return e.textContent || ""; }))
        .join(" | ");
      EVENTS.forEach(function (e) { if (full.indexOf(e.t) >= 0) found[e.id] = 1; });
      calCur = new Date(calCur.getFullYear(), calCur.getMonth() + 1, 1);
      renderCal();
    }
    return {
      seedWebinars: SEED.filter(function (x) { return /webinar/i.test(x.t); }).length,
      itemWebinars: all().filter(function (i) { return /webinar/i.test(i.title); }).length,
      events: EVENTS.length,
      onTimeline: EVENTS.filter(function (e) { return tl.indexOf(e.t) >= 0; }).length,
      onCalendar: Object.keys(found).length,
      taskRows: taskRows, eventRows: eventRows, poolN: poolN,
      /* nothing an event draws may carry an id: `openItem` has no event to
         open, and a row that answers a tap with silence is the Calendar bug
         this board already shipped once */
      tappable: document.querySelectorAll(".gerow[data-id],.evt[data-id],.evtr[data-id]").length
    };
  });
  ok(ew + "px: no webinar is a task any more",
     e41.seedWebinars === 0 && e41.itemWebinars === 0, JSON.stringify(e41));
  ok(ew + "px: every event is on the Calendar",
     e41.events > 0 && e41.onCalendar === e41.events, JSON.stringify(e41));
  ok(ew + "px: and every event is on the Timeline",
     e41.onTimeline === e41.events, JSON.stringify(e41));
  ok(ew + "px: an event row is not counted as a task row",
     e41.taskRows === e41.poolN && e41.eventRows === e41.events, JSON.stringify(e41));
  ok(ew + "px: nothing an event draws promises a tap", e41.tappable === 0, JSON.stringify(e41));
  ok(ew + "px: the events draw without a console error", s41.errs.length === 0, s41.errs.join(" | "));
  await s41.ctx.close();
}

/* ---- 42. the critical path opens on the step he is on ----
   "once step 1 is complete, the default view should be scrolled right to make
   the next task the first one visible on mobile." It is a sideways rail, and
   it opened on finished work with the live step off the right edge. */
{
  var s42 = await open(390);
  var sc = await s42.p.evaluate(function () {
    /* On the SEED board step one is still open, so the rail is already where
       it should be and the assertion would pass without ever scrolling. His
       case is the one after step one closes, so close it here: a check that
       only covers the easy state is the check not being written. */
    var closed = [];
    for (var q = 0; q < 2 && q < CHAIN.length - 1; q++) {
      if (items[CHAIN[q]]) { patch(CHAIN[q], { status: "done" }); closed.push(CHAIN[q]); }
    }
    setView("over"); render();
    var c = document.getElementById("chain"), nx = null;
    for (var n = 0; n < CHAIN.length; n++) {
      var i = items[CHAIN[n]];
      if (i && i.status !== "done") { nx = CHAIN[n]; break; }
    }
    var el = c.querySelector('.pn[data-go="' + nx + '"]');
    var cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    var scrolled = c.scrollLeft, overflows = c.scrollWidth > c.clientWidth + 1;
    /* and a repaint must not drag him back: Overview repaints on every pull.
       `render()` replaces the whole bento, so the rail afterwards is a NEW
       element -- measuring the old one here reported 0 for everything and
       hid the very thing this check is for. */
    c.scrollLeft = 0;
    render();
    var c2 = document.getElementById("chain");
    return {
      next: nx, closed: closed, overflows: overflows,
      firstDone: !!(items[CHAIN[0]] && items[CHAIN[0]].status === "done"),
      leading: er.left - cr.left, scrolled: scrolled, held: c2 ? c2.scrollLeft : -1
    };
  });
  ok("390px: step one closes and the rail moves off it",
     sc.firstDone && sc.next !== sc.closed[0] && (!sc.overflows || sc.scrolled > 0),
     JSON.stringify(sc));
  ok("390px: the critical path opens on the next step, not on step one",
     sc.leading >= -1 && sc.leading < 40, JSON.stringify(sc));
  ok("and a repaint does not drag the rail back", sc.held === 0, JSON.stringify(sc));
  await s42.ctx.close();
}

/* ---- 43. recently completed ----
   "After 'on the calendar', add a new section 'recently completed'." The
   order is `doneAt`, and a task closed before that field existed prints no
   date rather than borrowing its due date. */
{
  var s43 = await open(390);
  var r43 = await s43.p.evaluate(function () {
    setView("over"); render();
    var cls = Array.prototype.map.call(document.querySelectorAll("#bento .tile"),
      function (t) { return t.className; });
    var ag = cls.findIndex(function (c) { return /\bagd\b/.test(c); });
    var rc = cls.findIndex(function (c) { return /\brcent\b/.test(c); });
    var ml = cls.findIndex(function (c) { return /\bmiles\b/.test(c); });
    var none = Array.prototype.map.call(document.querySelectorAll(".rcent .rcd"),
      function (e) { return e.textContent; });
    /* close something now, with a real doneAt, and it has to lead the list */
    var open1 = alive().filter(function (i) { return i.status !== "done"; })[0];
    patch(open1.id, { status: "done" });
    render();
    var first = document.querySelector(".rcent .rcrow");
    return {
      order: ml === rc + 1 && rc > ag, agd: ag, rcent: rc, miles: ml,
      rows: document.querySelectorAll(".rcent .rcrow").length,
      undatedSaid: none.filter(function (t) { return /not recorded/.test(t); }).length,
      datedSaid: none.filter(function (t) { return !/not recorded/.test(t); }).length,
      leadTitle: first ? (first.querySelector(".rct").textContent || "") : "",
      leadDate: first ? (first.querySelector(".rcd").textContent || "") : "",
      want: open1.title, wantDate: fmtD(items[open1.id].doneAt),
      allDone: alive().filter(function (i) { return i.status === "done"; }).length,
      headCount: parseInt((document.querySelector(".rcent h3 .more").textContent || "")
        .replace(/\D+/g, ""), 10),
      /* the bug in the screenshot: the tile carried no grid-column at all, so
         auto-placement gave it ONE of twelve and it rendered as a ribbon of
         dots with every title clipped away. Measure the box, not the rule. */
      tileW: document.querySelector(".rcent").getBoundingClientRect().width,
      stageW: document.querySelector("#bento").getBoundingClientRect().width,
      titleW: document.querySelector(".rcent .rct")
        ? document.querySelector(".rcent .rct").getBoundingClientRect().width : 0
    };
  });
  /* It sat under the agenda until 2026-10-07: *"Move the recently completed
     box in overview to the bottom just above milestones."* What has gone is
     the one tile on the first screen that answers nothing about today. */
  ok("Recently completed sits directly above the milestones",
     r43.order, JSON.stringify(r43));
  ok("it lists what has been closed", r43.rows > 0, JSON.stringify(r43));
  /* *"only include the last 5 completed tasks"*. The heading still carries the
     real total, so capping the list cannot understate what he has done. */
  ok("and never more than five of them", r43.rows <= 5, JSON.stringify(r43));
  ok("while the heading still counts them all",
     r43.headCount === r43.allDone && r43.allDone > 5, JSON.stringify(r43));
  ok("a task closed before doneAt existed borrows no date",
     r43.undatedSaid > 0 && r43.datedSaid === 0, JSON.stringify(r43));
  ok("and the one just closed leads it, with the day it closed",
     r43.leadTitle.indexOf(r43.want) === 0 && r43.leadDate === r43.wantDate, JSON.stringify(r43));
  ok("the tile takes the width of the row, not one column of twelve",
     r43.tileW > r43.stageW * 0.9 && r43.titleW > 120, JSON.stringify(r43));
  await s43.ctx.close();
}

/* ---- 44. a tile heading opens the section it is about ----
   "In overview the progress by task header should be clickable and should
   open the board section. Similar, on the calendar should open the
   calendar." The heading sits inside a tile whose rows carry [data-go], so
   the risk here is the tap opening a task instead. */
{
  var s44 = await open(390);
  var hv = await s44.p.evaluate(function () {
    setView("over"); render();
    var out = {};
    document.querySelector("#bento .trk h3").click();
    out.trk = view;
    setView("over"); render();
    document.querySelector("#bento .agd h3").click();
    out.agd = view;
    /* and a row inside the same tile still opens its task */
    setView("over"); render();
    var row = document.querySelector("#bento .agd .agr");
    out.rowId = row ? row.dataset.go : null;
    if (row) row.click();
    out.opened = openId;
    out.drawer = document.getElementById("drawer").classList.contains("on");
    return out;
  });
  ok("the Progress by track heading opens the Board", hv.trk === "board", JSON.stringify(hv));
  ok("the On the calendar heading opens the Calendar", hv.agd === "cal", JSON.stringify(hv));
  ok("and a row in the same tile still opens its task",
     !!hv.rowId && hv.opened === hv.rowId, JSON.stringify(hv));
  ok("no console errors through the heading checks", s44.errs.length === 0, s44.errs.join(" | "));
  await s44.ctx.close();
}

/* ---- 45. a webinar is a row in the one list, not a section after it ----
   "In the timeline view, don't create a seperate section for webinar - it
   breaks the whole continuos timeline flow. Keep it in one table but for
   webinars make the text colour blue so it stands out from the tasks."
   Two halves, and the second is what lets the first be safe: without the
   colour, merging the two kinds of row would lose the distinction a heading
   was carrying. The colour is measured, not read off the stylesheet, because
   a token renamed in one theme and not the other passes a text search. */
for (var nw of [390, 1280]) {
  var s45 = await open(nw);
  var r45 = await s45.p.evaluate(function () {
    setView("time"); render();
    var out = { heads: [], order: [], blue: [], taskInk: [] };
    Array.prototype.forEach.call(
      document.querySelectorAll("#gantt .gsec,#gantt .grow,#gantt .gerow"), function (e) {
        if (/gsec/.test(e.className)) { out.heads.push(e.textContent || ""); return; }
        var ev = /gerow/.test(e.className);
        var d = ev ? e.getAttribute("data-d")
                   : (items[e.getAttribute("data-id")] || {}).due || "";
        out.order.push({ ev: ev, d: d });
        var t = e.querySelector(".gt");
        if (t) (ev ? out.blue : out.taskInk).push(getComputedStyle(t).color);
      });
    /* an event has to appear between two tasks somewhere, or "interleaved"
       is being satisfied by every event happening to be last anyway */
    var firstEv = out.order.findIndex(function (x) { return x.ev; });
    var lastTask = out.order.map(function (x) { return x.ev; }).lastIndexOf(false);
    return {
      heads: out.heads, evRows: out.blue.length,
      events: EVENTS.length,
      /* dates never go backwards inside the run before Done */
      sorted: out.order.every(function (x, n) {
        return n === 0 || !out.order[n - 1].d || !x.d || out.order[n - 1].d <= x.d
               || out.heads.length > 1;   /* Done/Deleted restart the sequence */
      }),
      mixed: firstEv >= 0 && firstEv < lastTask,
      blue: out.blue, taskInk: out.taskInk.slice(0, 3)
    };
  });
  ok(nw + "px: no Events section", r45.heads.every(function (h) { return !/^Events/.test(h); }),
     JSON.stringify(r45.heads));
  ok(nw + "px: every event is still a row", r45.evRows === r45.events, JSON.stringify(r45));
  ok(nw + "px: and sits between the tasks rather than after them", r45.mixed, JSON.stringify(r45));
  ok(nw + "px: a webinar's title is blue, and no task's is",
     r45.blue.length > 0 &&
     r45.blue.every(function (c) {
       var m = c.match(/\d+/g).map(Number);
       return m[2] > m[0] + 40 && m[2] > m[1] + 20;    /* blue dominates */
     }) &&
     r45.taskInk.every(function (c) { return r45.blue.indexOf(c) < 0; }),
     JSON.stringify(r45));
  ok(nw + "px: no console error merging them", s45.errs.length === 0, s45.errs.join(" | "));
  await s45.ctx.close();
}

/* ---- 46. NEWS: an opportunity Claude found, and his answer to it ----
   "These News items should have accept or reject button in the on-click
   details popup. Should also be able to add notes." A NEWS item is an
   ordinary task carrying `nw:true`, which is the whole reason notes, the
   calendar and the merge rules needed nothing new. What had to be checked is
   the part that is new: the two buttons, that reject actually removes it, and
   that the answer SURVIVES A RELOAD -- `newsState` in DFIELDS but not in
   diffOf would merge and never save, which is the `deleted` bug exactly. */
{
  var s46 = await open(390);
  var r46 = await s46.p.evaluate(function () {
    var n = alive().filter(function (i) { return i.isNews; });
    if (!n.length) return { none: true };
    var id = n[0].id;
    openItem(id);
    var card = document.getElementById("dBody");
    var acc = card.querySelector("[data-nacc]"), rej = card.querySelector("[data-nrej]");
    var seen = { acc: !!acc, rej: !!rej,
                 accBox: acc ? acc.getBoundingClientRect().width : 0,
                 notes: !!card.querySelector("[data-nadd],#nt"),
                 /* the push came into the offer box and the three quick
                    actions went out of it: Done and Delete were answering a
                    question he had not been asked yet */
                 n2d: !!card.querySelector("[data-n2d]"),
                 quick: !!card.querySelector(".qrow") };
    /* the colour it draws in is its own, not a status colour */
    setView("time"); render();
    var row = document.querySelector('#gantt .grow[data-id="' + id + '"]');
    seen.rowInk = row ? getComputedStyle(row.querySelector(".gt")).color : "";
    seen.plainInk = getComputedStyle(
      document.querySelector('#gantt .grow:not(.nws) .gt')).color;
    seen.legendNews = (document.getElementById("glg").textContent || "").indexOf("News") >= 0;
    /* accept, then reject a second one */
    openItem(id);
    document.querySelector("[data-nacc]").click();
    seen.accepted = items[id].newsState;
    seen.stillThere = !!alive().filter(function (i) { return i.id === id; }).length;
    seen.asked = !!document.querySelector("[data-nacc]");
    /* once he has taken it on it is a task with every ordinary action, the
       box stays to say he took it on, and there is no way back to Reject */
    seen.accOn = !!document.querySelector("#dBody .dnews.on");
    seen.accRej = !!document.querySelector("[data-nrej]");
    seen.accQuick = !!document.querySelector("#dBody .qrow");
    seen.accTitle = items[id].title;
    setView("time"); render();
    var r2 = document.querySelector('#gantt .grow[data-id="' + id + '"]');
    seen.accNws = r2 ? r2.classList.contains("nws") : true;
    seen.accInk = r2 ? getComputedStyle(r2.querySelector(".gt")).color : "";
    seen.accBar = r2 ? (getComputedStyle(r2.querySelector(".gbar")).backgroundColor || "") : "";
    seen.newsBar = NEWSC;
    openItem(id);
    var two = alive().filter(function (i) { return i.isNews && i.id !== id; });
    seen.second = two.length > 0;
    if (two.length) {
      openItem(two[0].id);
      document.querySelector("[data-nrej]").click();
      seen.rejected = items[two[0].id].newsState;
      seen.gone = !alive().filter(function (i) { return i.id === two[0].id; }).length;
      seen.rejId = two[0].id;
    }
    seen.id = id;
    return seen;
  });
  ok("a NEWS task exists on the board", !r46.none && r46.second, JSON.stringify(r46));
  ok("its card offers Accept and Reject, and they are on screen",
     r46.acc && r46.rej && r46.accBox > 0, JSON.stringify(r46));
  ok("and it takes a note like any other task", r46.notes, JSON.stringify(r46));
  ok("the offer box carries the push, and the quick actions wait for his answer",
     r46.n2d && !r46.quick, JSON.stringify(r46));
  ok("it draws in its own colour, which the legend explains",
     r46.rowInk && r46.rowInk !== r46.plainInk && r46.legendNews, JSON.stringify(r46));
  ok("accepting records the answer and stops asking",
     r46.accepted === "accept" && r46.stillThere && !r46.asked, JSON.stringify(r46));
  /* "it should not mark it complete - I am accepting that as a task. It
     should convert to a task on all relevant sections with regular white
     colour but still keep the [NEWS] tag." */
  ok("an accepted item is an ordinary task, in ordinary colours, still tagged",
     r46.accepted === "accept" && !r46.accNws &&
     r46.accInk === r46.plainInk &&
     r46.accBar.indexOf("224, 57, 155") < 0 &&
     /^\[NEWS\] /.test(r46.accTitle || ""), JSON.stringify(r46));
  ok("and it gets its ordinary actions back, with no way left to reject it",
     r46.accQuick && !r46.accRej && r46.accOn, JSON.stringify(r46));
  ok("rejecting takes it off the board", r46.rejected === "reject" && r46.gone, JSON.stringify(r46));
  /* the half an in-memory assertion cannot see */
  await s46.p.reload({ waitUntil: "load" });
  await s46.p.waitForTimeout(500);
  var k46 = await s46.p.evaluate(function (x) {
    return { acc: (items[x.id] || {}).newsState, rej: (items[x.rejId] || {}).newsState,
             del: !!(items[x.rejId] || {}).deleted };
  }, { id: r46.id, rejId: r46.rejId });
  ok("and both answers survive a reload",
     k46.acc === "accept" && k46.rej === "reject" && k46.del, JSON.stringify(k46));
  await s46.ctx.close();
}

/* ---- 47. Recently completed is a row wide on a desktop too ---- */
{
  var s47 = await open(1280);
  var r47 = await s47.p.evaluate(function () {
    setView("over"); render();
    var t = document.querySelector(".rcent").getBoundingClientRect();
    var b = document.querySelector("#bento").getBoundingClientRect();
    var a = document.querySelector(".agd").getBoundingClientRect();
    return { w: t.width, b: b.width, agd: a.width,
             /* It ran opposite the agenda until 2026-10-07 and now runs the
                full width at the foot: *"Move the recently completed box in
                overview to the bottom just above milestones."* Every wide
                tile here declares its span, and the one that forgot rendered
                as a ribbon of clipped dots -- so this measures the box. */
             full: t.width > b.width * 0.9, below: t.top > a.bottom };
  });
  ok("1280px: Recently completed is half the bento, not a twelfth",
     r47.w > r47.b * 0.4, JSON.stringify(r47));
  ok("1280px: and it runs the full width, below the agenda",
     r47.full && r47.below, JSON.stringify(r47));
  await s47.ctx.close();
}

/* ---- 48. swipe a message to reply to it ----
   "Add a drag to reply to a specific message function on chat. Similar to
   Whatsapp or Instagram. When I drag to reply, that message should show above
   the chatbox (not the whole message but just a bit)."
   The gesture itself is driven with real touch events, because the whole
   design of it is about when it arms: a vertical drag has to be handed back
   to the thread, and that cannot be asserted by reading the code. */
{
  var NOW48 = new Date().toISOString();
  var s48 = await open(390, [
    { id: "q1", from: "claude", text: "the message he is answering, which runs on for a while so the quote has something to cut", createdAt: NOW48, state: "read" },
    { id: "q2", from: "me", text: "a later message of his own", createdAt: NOW48, state: "read" }
  ]);
  await s48.p.evaluate(function () { setView("chat"); });
  await s48.p.waitForTimeout(350);
  var box = await s48.p.evaluate(function () {
    var el = document.querySelector('.cmsg[data-nid="q1"]');
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 10), y: Math.round(r.top + r.height / 2) };
  });
  /* "the box doesn't move smoothly ... It also currently drags too far - make
     the box stop after a small drag." The travel was his thumb's travel until
     it hit a wall at 72px. It is damped now, so a 20px drag moves less than
     20px and a 200px drag still cannot pass SW_MAX. Read after a frame,
     because the transform is written in requestAnimationFrame -- one write
     per frame was the other half of "not smoothly". */
  var damp = await s48.p.evaluate(async function (b) {
    function t(type, x, y) {
      var el = document.querySelector('.cmsg[data-nid="q1"]');
      var tt = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [tt], changedTouches: [tt] }));
    }
    function tx() {
      var m = getComputedStyle(document.querySelector('.cmsg[data-nid="q1"]')).transform;
      var p = /matrix\(([^)]+)\)/.exec(m);
      return p ? parseFloat(p[1].split(",")[4]) : 0;
    }
    t("touchstart", b.x, b.y);
    t("touchmove", b.x + 20, b.y + 1);
    await new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
    var near = tx();
    t("touchmove", b.x + 200, b.y + 2);
    await new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
    var far = tx();
    t("touchcancel", b.x + 200, b.y + 2);
    /* long enough for the spring back to finish: it is a .16s transition, so
       one frame catches it mid-flight -- which is itself the proof that
       letting go is animated rather than a jump */
    await new Promise(function (r) { setTimeout(r, 280); });
    return { near: near, far: far, max: SW_MAX, back: tx(),
             armed: !document.getElementById("crep").classList.contains("off") };
  }, box);
  ok("the drag is damped rather than tracking the finger",
     damp.near > 2 && damp.near < 19, JSON.stringify(damp));
  ok("and it stops after a small drag however far he goes",
     damp.far > damp.near && damp.far <= damp.max + 1, JSON.stringify(damp));
  ok("a cancelled drag springs back and commits nothing",
     Math.abs(damp.back) < 1 && !damp.armed, JSON.stringify(damp));
  /* "Left swipe is very weird. Enable only right swipe." swTravel is an
     exponential, so a negative dx does not ease towards zero -- it grows the
     other way without limit, and a 100px drag left threw the bubble 255px off
     the side of the screen. */
  var left = await s48.p.evaluate(async function (b) {
    function t(type, x, y) {
      var el = document.querySelector('.cmsg[data-nid="q1"]');
      var tt = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [tt], changedTouches: [tt] }));
    }
    function tx() {
      var m = getComputedStyle(document.querySelector('.cmsg[data-nid="q1"]')).transform;
      var p = /matrix\(([^)]+)\)/.exec(m);
      return p ? parseFloat(p[1].split(",")[4]) : 0;
    }
    /* straight left */
    t("touchstart", b.x, b.y); t("touchmove", b.x - 100, b.y + 1);
    await new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
    var out = tx();
    t("touchend", b.x - 100, b.y + 1);
    /* right far enough to arm, then back past the start: it must not invert */
    t("touchstart", b.x, b.y); t("touchmove", b.x + 30, b.y + 1);
    await new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
    t("touchmove", b.x - 60, b.y + 1);
    await new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
    var back = tx();
    t("touchend", b.x - 60, b.y + 1);
    await new Promise(function (r) { setTimeout(r, 280); });
    return { out: out, back: back, strip: !document.getElementById("crep").classList.contains("off") };
  }, box);
  ok("a leftward drag moves nothing and arms nothing",
     Math.abs(left.out) < 1 && left.back <= 0.5 && !left.strip, JSON.stringify(left));
  /* first a vertical drag on the same bubble: it must NOT arm.
     Real Touch objects, not plain literals -- TouchEventInit refuses to
     convert one and the whole run dies on the constructor rather than on the
     board. */
  var vert = await s48.p.evaluate(function (b) {
    function t(type, x, y) {
      var el = document.querySelector('.cmsg[data-nid="q1"]');
      var tt = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [tt], changedTouches: [tt] }));
    }
    t("touchstart", b.x, b.y); t("touchmove", b.x + 4, b.y - 40); t("touchmove", b.x + 50, b.y - 60);
    t("touchend", b.x + 50, b.y - 60);
    return { armed: !document.getElementById("crep").classList.contains("off") };
  }, box);
  ok("a vertical drag on a message is the thread scrolling, not a reply",
     !vert.armed, JSON.stringify(vert));
  var swipe = await s48.p.evaluate(function (b) {
    function t(type, x, y) {
      var el = document.querySelector('.cmsg[data-nid="q1"]');
      var tt = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [tt], changedTouches: [tt] }));
    }
    t("touchstart", b.x, b.y); t("touchmove", b.x + 20, b.y + 2);
    t("touchmove", b.x + 60, b.y + 3); t("touchend", b.x + 60, b.y + 3);
    var strip = document.getElementById("crep");
    return { open: !strip.classList.contains("off"),
             who: document.getElementById("crepW").textContent,
             /* one line of it, never the whole message */
             quoted: document.getElementById("crepT").textContent,
             replyTo: replyTo };
  }, box);
  ok("swiping a message right opens the reply strip on it",
     swipe.open && swipe.replyTo === "q1" && swipe.who === "Claude", JSON.stringify(swipe));
  ok("and the strip quotes a line, not the message",
     swipe.quoted.length > 0 && swipe.quoted.length <= 81 &&
     swipe.quoted.length < 95, JSON.stringify(swipe));
  /* send it, and the reply carries the quote */
  var sent = await s48.p.evaluate(function () {
    var ta = document.getElementById("cin");
    ta.value = "and the answer"; ta.dispatchEvent(new Event("input"));
    document.getElementById("csend").click();
    var n = notes.filter(function (x) { return x.text === "and the answer"; })[0];
    return { re: n && n.re, strip: document.getElementById("crep").classList.contains("off"),
             quote: !!document.querySelector('.cmsg[data-nid="' + (n ? n.id : "") + '"] .cq') };
  });
  ok("the reply carries what it answers, and the bubble shows it",
     sent.re === "q1" && sent.quote, JSON.stringify(sent));
  ok("and the strip clears once it is sent", sent.strip, JSON.stringify(sent));
  ok("no console error through the reply gesture", s48.errs.length === 0, s48.errs.join(" | "));
  await s48.ctx.close();
}

/* ---- 49. where he was when he left a section ----
   "when I scroll down on a section, go to another section and come back - it
   should be at the scroll position I left it earlier." And tapping the icon
   of the section already open takes him back to the top, animated. */
{
  var s49 = await open(390);
  var keep = await s49.p.evaluate(async function () {
    var st = document.getElementById("stage");
    setView("time"); await new Promise(function (r) { setTimeout(r, 250); });
    st.scrollTop = 300;
    var left = st.scrollTop;
    setView("cal"); await new Promise(function (r) { setTimeout(r, 250); });
    var other = st.scrollTop;
    setView("time"); await new Promise(function (r) { setTimeout(r, 250); });
    return { left: left, other: other, back: st.scrollTop };
  });
  ok("a section comes back where he left it",
     keep.left > 100 && keep.other === 0 && keep.back === keep.left, JSON.stringify(keep));
  var top = await s49.p.evaluate(async function () {
    var st = document.getElementById("stage"), was = st.scrollTop;
    /* the tab of the section already open: "take me to the top" */
    document.querySelector('.vt[data-v="time"]').click();
    await new Promise(function (r) { setTimeout(r, 700); });
    return { was: was, now: st.scrollTop, view: view };
  });
  ok("tapping the open section's icon scrolls it back to the top",
     top.was > 100 && top.now === 0 && top.view === "time", JSON.stringify(top));
  ok("no console error through the scroll memory", s49.errs.length === 0, s49.errs.join(" | "));
  await s49.ctx.close();
}

/* ---- 50. a tile heading ends with its subtitle and then the chevron ----
   "why does the sub-title with date and 17 done so far look so weirdly
   placed?" -- two `margin-left:auto` elements split the free space instead of
   one taking it, so the subtitle floated in the middle of the heading. */
{
  var s50 = await open(390);
  var hd = await s50.p.evaluate(function () {
    setView("over"); render();
    var bad = [], noMore = [];
    Array.prototype.forEach.call(document.querySelectorAll("#bento .tile h3"), function (h) {
      var m = h.querySelector(".more");
      if (!m) { if (h.dataset.vgo) noMore.push(h.textContent); return; }
      var hr = h.getBoundingClientRect(), mr = m.getBoundingClientRect();
      /* the subtitle ends within ~22px of the heading's right edge: the
         chevron's width and its gap, and nothing else */
      if (hr.right - mr.right > 22) bad.push(h.textContent + " @" + Math.round(hr.right - mr.right));
    });
    return { bad: bad, noMore: noMore,
             rcent: (document.querySelector(".rcent h3 .more") || {}).textContent || "" };
  });
  ok("every subtitle sits at the right end of its heading", hd.bad.length === 0, JSON.stringify(hd.bad));
  ok("and every heading that opens a section has one", hd.noMore.length === 0, JSON.stringify(hd.noMore));
  ok("Recently completed says it his way", /tasks? completed$/.test(hd.rcent), hd.rcent);
  await s50.ctx.close();
}

var MAPSEED = { kb: [
  { id: "kd1", group: "Deadlines", ord: 10, shape: "timeline", label: "Campus France dossier closes",
    when: "20 Nov 2026", w: "2026-11-20", body: "The dossier has to be validated before the visa slot.",
    at: "2026-10-07T01:00:00.000Z" },
  { id: "kd2", group: "Deadlines", ord: 10, shape: "timeline", label: "Visa appointment window opens",
    when: "02 Dec 2026", w: "2026-12-02", body: "Slots go in days once it opens.",
    at: "2026-10-07T01:01:00.000Z" },
  { id: "kc1", group: "Programme calendar", ord: 20, shape: "calendar", label: "P1",
    when: "Jan - Mar 2027", w: "2027-01-04", body: "The first period, five courses and the launch week.",
    rows: [{ t: "P1", a: "2027-01-04", b: "2027-03-12", k: "period" }],
    at: "2026-10-07T01:02:00.000Z" },
  { id: "kc2", group: "Programme calendar", ord: 20, shape: "calendar", label: "Break",
    when: "Mar 2027", w: "2027-03-13", body: "Two weeks between P1 and P2.",
    rows: [{ t: "Break", a: "2027-03-13", b: "2027-03-27", k: "break" }],
    at: "2026-10-07T01:03:00.000Z" },
  { id: "kn1", group: "NEWS: industry opportunities", ord: 25, shape: "cards",
    label: "Amazon Pathways", when: "Rolling",
    body: "A three-year operations leadership track, open to MBA students, with no fixed deadline.",
    at: "2026-10-07T05:00:00.000Z" },
  { id: "kn2", group: "NEWS: industry opportunities", ord: 25, shape: "cards",
    label: "BCG Unlock", when: "May 2027",
    body: "The pre-MBA programme for incoming students, which runs over the northern summer.",
    at: "2026-10-07T04:00:00.000Z" },
  { id: "kl1", group: "Platforms and tools", ord: 30, shape: "list", label: "VMock",
    body: "Scores a CV against the school's own rubric and says what to fix.",
    at: "2026-10-07T01:04:00.000Z" }
] };

/* ---- 51. every group on the map draws its nodes as blocks ----
   "Some mindmap sections don't use blocks and some do. Use blocks for all
   sections including deadlines and programme calendar. I understand it's
   because there are images/infographics but keep them without and outside
   the boxes. The line in deadlines for example - can be outside and each
   deadline in its own box." Two of the four shapes drew cards and two drew
   rows separated by a hairline, so the same kind of thing looked like two
   kinds of thing depending on which group it had been filed under. */
{
  var s51 = await open(390, MAPSEED);
  var r51 = await s51.p.evaluate(function () {
    setView("map");
    /* open every group: a shut one draws no nodes at all */
    mapGroups().forEach(function (g) { mapOpen[g.name] = true; });
    renderMap();
    var flat = [], groups = {};
    Array.prototype.forEach.call(
      document.querySelectorAll("#mapw .mn, #mapw .mtli, #mapw .mcard"), function (n) {
        var c = getComputedStyle(n), g = n.closest(".mroot").querySelector(".mrt").textContent;
        groups[g] = (groups[g] || 0) + 1;
        if (parseFloat(c.borderTopWidth) < 0.5 || parseFloat(c.borderRadius) < 2 ||
            /transparent|rgba\(0, 0, 0, 0\)/.test(c.backgroundColor))
          flat.push(g + ": " + (n.querySelector(".mnl") || {}).textContent);
      });
    /* the rail's dot and the month chart are the infographics, and both have
       to be OUTSIDE the box they describe */
    var tli = document.querySelector("#mapw .mtli");
    var dot = tli ? tli.querySelector("i") : null;
    var cal = document.querySelector("#mapw .mcal");
    return { flat: flat, groups: groups, nodes: Object.keys(groups).length,
             dotOut: !!(dot && tli &&
               dot.getBoundingClientRect().left < tli.getBoundingClientRect().left - 1),
             rail: !!document.querySelector("#mapw .mtl"),
             calOut: !!(cal && !cal.closest(".mn") && !cal.closest(".mcard") && !cal.closest(".mtli")) };
  });
  ok("every shape on the map draws its nodes in blocks", r51.flat.length === 0, JSON.stringify(r51));
  ok("and all four groups seeded drew some", r51.nodes === 4, JSON.stringify(r51.groups));
  ok("the deadline rail runs outside the boxes it marks",
     r51.rail && r51.dotOut, JSON.stringify(r51));
  ok("and the month chart sits outside them too", r51.calOut, JSON.stringify(r51));

  /* "Add a similar swipe to reply function on the mindmap section." Same
     gesture, same arming rules; what it quotes is a fact, so the note carries
     `rek` and the bubble taps back to the node. */
  var sw51 = await s51.p.evaluate(async function () {
    function t(type, x, y) {
      var el = document.querySelector('[data-kb="kl1"]');
      var tt = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
        touches: type === "touchend" ? [] : [tt], changedTouches: [tt] }));
    }
    var r = document.querySelector('[data-kb="kl1"]').getBoundingClientRect();
    var x = Math.round(r.left + 8), y = Math.round(r.top + r.height / 2);
    /* a vertical drag is the map scrolling */
    t("touchstart", x, y); t("touchmove", x + 4, y - 40); t("touchend", x + 4, y - 40);
    var vert = !document.getElementById("mrep").classList.contains("off");
    t("touchstart", x, y); t("touchmove", x + 20, y + 2);
    t("touchmove", x + 60, y + 3); t("touchend", x + 60, y + 3);
    await new Promise(function (f) { setTimeout(f, 60); });
    var strip = document.getElementById("mrep");
    var seen = { vert: vert, open: !strip.classList.contains("off"),
                 who: document.getElementById("mrepW").textContent,
                 quoted: document.getElementById("mrepT").textContent,
                 to: mapReplyTo };
    var ta = document.getElementById("min");
    ta.value = "and what does it cost"; ta.dispatchEvent(new Event("input"));
    document.getElementById("msend").click();
    var n = notes.filter(function (z) { return z.text === "and what does it cost"; })[0];
    seen.rek = n && n.rek;
    seen.cleared = document.getElementById("mrep").classList.contains("off");
    setView("chat"); renderChat();
    var q = document.querySelector('.cmsg[data-nid="' + (n ? n.id : "") + '"] .cq');
    seen.quote = !!q; seen.back = q ? q.dataset.kbg : "";
    return seen;
  });
  ok("a vertical drag on a map node is the map scrolling, not a reply",
     !sw51.vert, JSON.stringify(sw51));
  ok("swiping a map node right opens the reply strip on that fact",
     sw51.open && sw51.to === "kl1" && sw51.who === "Map" &&
     sw51.quoted.length > 0 && sw51.quoted.length <= 81, JSON.stringify(sw51));
  ok("the note carries the fact it answers, and the bubble taps back to it",
     sw51.rek === "kl1" && sw51.quote && sw51.back === "kl1" && sw51.cleared,
     JSON.stringify(sw51));
  /* "Swipe to duplicates the box in mindmap." `will-change:transform` put the
     row on its own compositing layer for the drag and iOS kept the old layer
     on screen once the class came off, so the node drew twice 40px apart. The
     chat bubbles never carried it and never ghosted. */
  var ghost = await s51.p.evaluate(function () {
    var el = document.querySelector('[data-kb="kl1"]');
    el.classList.add("cdrag");
    var wc = getComputedStyle(el).willChange;
    el.classList.remove("cdrag");
    return { wc: wc, rest: getComputedStyle(el).willChange };
  });
  ok("a swiped map row is not promoted to a layer of its own",
     ghost.wc === "auto" && ghost.rest === "auto", JSON.stringify(ghost));
  ok("no console error through the map gesture", s51.errs.length === 0, s51.errs.join(" | "));
  await s51.ctx.close();
}

/* ---- 52. News on Overview, and the jump into the map ----
   "Add a news section to overview above the tuition card. Don't add all news
   - just recent few with a small description and date (if applicable).
   Clicking on the news should take me to the relevant mindmap note in the
   same scroll and briefly highlight/animate box format." */
{
  var s52 = await open(390, MAPSEED);
  var r52 = await s52.p.evaluate(function () {
    setView("over"); render();
    function top(sel){ var e=document.querySelector(sel); return e?Math.round(e.getBoundingClientRect().top):null; }
    var tile = document.querySelector(".nwst");
    var rows = tile ? tile.querySelectorAll(".nwrow") : [];
    return { tile: !!tile, rows: rows.length,
             w: tile ? Math.round(tile.getBoundingClientRect().width) : 0,
             stage: Math.round(document.getElementById("stage").clientWidth),
             desc: !!(rows[0] && rows[0].querySelector("small")),
             when: !!(rows[0] && rows[0].querySelector(".nwd")),
             /* newest first, by the clock each node carries */
             first: rows[0] ? rows[0].dataset.kbg : "",
             nwst: top(".nwst"), tui: top(".hero.b"), trk: top(".trk") };
  });
  ok("Overview carries a News tile, and it is a tile and not a ribbon",
     r52.tile && r52.w > r52.stage * 0.8, JSON.stringify(r52));
  ok("it shows a few, newest first, each with its line and its date",
     r52.rows > 0 && r52.rows <= 4 && r52.desc && r52.when && r52.first === "kn1",
     JSON.stringify(r52));
  ok("and it sits above tuition, under progress",
     r52.nwst > r52.trk && r52.tui > r52.nwst, JSON.stringify(r52));
  var jump = await s52.p.evaluate(async function () {
    document.querySelector(".nwrow").click();
    await new Promise(function (r) { setTimeout(r, 700); });
    var sc = scroller("map"), el = document.querySelector('[data-kb="kn1"]');
    var r = el ? el.getBoundingClientRect() : null, sr = sc.getBoundingClientRect();
    return { view: view, drawn: !!el,
             /* on screen inside the map's own scroller, not merely in the DOM */
             seen: !!(r && r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1),
             flash: !!(el && el.classList.contains("mflash")) };
  });
  ok("tapping a News row opens that fact on the map and marks it",
     jump.view === "map" && jump.drawn && jump.seen && jump.flash, JSON.stringify(jump));
  ok("no console error through the jump", s52.errs.length === 0, s52.errs.join(" | "));
  await s52.ctx.close();
}

/* ---- 53. an INSEAD decision is the same question in the same shape ----
   "INSEAD Decision tasks should also behave like news decisions. If I accept
   convert it to a regular task and if I reject mark it done with the note
   'you rejected this'. similarly, remove the redundant action buttons."
   Reject differs from NEWS on purpose: a NEWS item he never asked for leaves
   the board, and an INSEAD offer he declined is a decision he made and
   closed, so it is Done and it belongs in Recently completed. */
{
  var s53 = await open(390);
  var r53 = await s53.p.evaluate(function () {
    var d = alive().filter(function (i) { return i.isDec; });
    if (!d.length) return { none: true };
    var id = d[0].id;
    openItem(id);
    var card = document.getElementById("dBody");
    var seen = { id: id, n: d.length, title: d[0].title,
                 acc: !!card.querySelector("[data-nacc]"),
                 rej: !!card.querySelector("[data-nrej]"),
                 n2d: !!card.querySelector("[data-n2d]"),
                 quick: !!card.querySelector(".qrow"),
                 notes: !!card.querySelector("[data-nadd],#nt"),
                 /* an INSEAD task, so it is never painted as something found
                    outside: no magenta and no NEWS swatch earned by it */
                 dec: !!card.querySelector(".dnews.dec"),
                 tagged: /^\[NEWS\]/.test(d[0].title) };
    setView("time"); render();
    var row = document.querySelector('#gantt .grow[data-id="' + id + '"]');
    seen.nws = row ? row.classList.contains("nws") : true;
    return seen;
  });
  ok("a decision task exists and offers the same three buttons",
     !r53.none && r53.acc && r53.rej && r53.n2d, JSON.stringify(r53));
  ok("its quick actions wait for his answer, and it still takes a note",
     !r53.quick && r53.notes, JSON.stringify(r53));
  ok("it reads as an INSEAD task, not as something found outside",
     r53.dec && !r53.nws && !r53.tagged, JSON.stringify(r53));
  var acc53 = await s53.p.evaluate(function (id) {
    openItem(id);
    document.querySelector("[data-nacc]").click();
    return { state: items[id].newsState, status: items[id].status,
             quick: !!document.querySelector("#dBody .qrow"),
             rej: !!document.querySelector("[data-nrej]"),
             on: !!document.querySelector("#dBody .dnews.on") };
  }, r53.id);
  ok("accepting it leaves an ordinary open task with its actions back",
     acc53.state === "accept" && acc53.status !== "done" &&
     acc53.quick && !acc53.rej && acc53.on, JSON.stringify(acc53));
  /* and now reject one from scratch, in its own session */
  var s53b = await open(390);
  var rej53 = await s53b.p.evaluate(function (id) {
    openItem(id);
    document.querySelector("[data-nrej]").click();
    var n = notesFor(id);
    return { state: items[id].newsState, status: items[id].status,
             gone: !alive().filter(function (i) { return i.id === id; }).length,
             doneAt: !!items[id].doneAt,
             note: n.length ? n[0].text : "",
             /* his own note: it records what he did, it is not a question
                for Claude */
             mine: n.length ? (n[0].from !== "claude" && n[0].forClaude === false) : false,
             off: !!document.querySelector("#dBody .dnews.off") };
  }, r53.id);
  ok("rejecting it closes it as done rather than deleting it",
     rej53.state === "reject" && rej53.status === "done" && !rej53.gone &&
     rej53.doneAt && rej53.off, JSON.stringify(rej53));
  ok("and it says so on the task, in his words",
     /rejected this/i.test(rej53.note) && rej53.mine, JSON.stringify(rej53));
  await s53b.p.reload({ waitUntil: "load" });
  await s53b.p.waitForTimeout(500);
  var k53 = await s53b.p.evaluate(function (id) {
    return { state: (items[id] || {}).newsState, status: (items[id] || {}).status };
  }, r53.id);
  ok("and the answer survives a reload",
     k53.state === "reject" && k53.status === "done", JSON.stringify(k53));
  ok("no console error through the decision", s53.errs.concat(s53b.errs).length === 0,
     s53.errs.concat(s53b.errs).join(" | "));
  await s53.ctx.close(); await s53b.ctx.close();
}

/* ---- 54. a closed task, and the tag that survives accepting ----
   "When a task is completed, remove the green tick and +2 icons. Only keep
   the delete." And: "we are changing the title to white like any other task -
   but still keep the pink colour for [news] in the title everywhere. To be
   able to know which is non-insead." */
{
  var s54 = await open(390, MAPSEED);
  var q54 = await s54.p.evaluate(function () {
    var o = alive().filter(function (i) { return i.status !== "done" && !i.isNews && !i.isDec; })[0];
    openItem(o.id);
    var c = document.getElementById("dBody");
    var before = { done: !!c.querySelector("[data-qdone]"), d2: !!c.querySelector("[data-q2d]"),
                   del: !!c.querySelector("[data-del]") };
    patch(o.id, { status: "done", manual: true });
    openItem(o.id);
    c = document.getElementById("dBody");
    return { id: o.id, before: before,
             after: { done: !!c.querySelector("[data-qdone]"), d2: !!c.querySelector("[data-q2d]"),
                      del: !!c.querySelector("[data-del]"),
                      /* the row is still there, carrying the one action left */
                      row: !!c.querySelector(".qrow"),
                      /* and the status row above is still how he reopens it */
                      status: !!c.querySelector('[data-row="status"],[data-drow="status"]') } };
  });
  ok("an open task offers all three quick actions",
     q54.before.done && q54.before.d2 && q54.before.del, JSON.stringify(q54));
  /* A tick on a done task re-asserts the state it is already in and +2d
     offers to move a date that no longer decides anything: both could only
     ever be pressed by mistake. */
  ok("a closed one keeps only the bin",
     !q54.after.done && !q54.after.d2 && q54.after.del && q54.after.row,
     JSON.stringify(q54));

  var t54 = await s54.p.evaluate(function () {
    var n = alive().filter(function (i) { return i.isNews; })[0];
    if (!n) return { none: true };
    /* accept it, so the rest of the title has gone ordinary ink */
    patch(n.id, { newsState: "accept" });
    render();
    function tag(sel) {
      var e = document.querySelector(sel);
      if (!e) return null;
      var g = e.querySelector(".tgn");
      if (!g) return { has: false };
      var rest = e.textContent.replace(g.textContent, "").trim();
      return { has: true, c: getComputedStyle(g).color, text: g.textContent,
               /* the tag alone, never the whole title */
               rest: rest.length > 0 };
    }
    setView("time"); render();
    var tl = tag('#gantt .grow[data-id="' + n.id + '"] .gt');
    setView("board"); render();
    var card = tag('.card[data-id="' + n.id + '"] .ct');
    openItem(n.id);
    var head = tag("#dTitle");
    /* the news colour as the board itself resolves it, rather than a hex
       typed in here that a theme change could leave behind */
    var probe = document.createElement("span");
    probe.style.color = "var(--news)";
    document.body.appendChild(probe);
    var want = getComputedStyle(probe).color;
    probe.remove();
    return { id: n.id, title: items[n.id].title, want: want,
             tl: tl, card: card, head: head,
             /* accepting is not a status change, and it is not magenta any
                more either: the row has dropped `.nws` */
             nws: (document.querySelector('#gantt .grow[data-id="' + n.id + '"]') || { classList: { contains: function () { return false; } } })
               .classList.contains("nws") };
  });
  ok("the [NEWS] tag is drawn on the Timeline, the board card and the drawer header",
     !t54.none && t54.tl && t54.tl.has && t54.card && t54.card.has &&
     t54.head && t54.head.has, JSON.stringify(t54));
  ok("and it is the tag alone that keeps the news colour",
     t54.tl.c === t54.want && t54.card.c === t54.want && t54.head.c === t54.want &&
     t54.tl.rest && /^\[NEWS\]$/.test(t54.tl.text) && !t54.nws, JSON.stringify(t54));

  /* "Even if I accept a news decision tasks - it should still keep the news
     in the news section in overview." The tile reads the map's NEWS group,
     which an answer on a task cannot touch -- so this is the invariant that
     says so rather than a change. */
  var o54 = await s54.p.evaluate(function () {
    setView("over"); render();
    return { rows: document.querySelectorAll(".nwst .nwrow").length,
             tile: !!document.querySelector(".nwst") };
  });
  ok("and Overview's News tile still carries it after accepting",
     o54.tile && o54.rows > 0, JSON.stringify(o54));

  /* "When I click on news title in overview, it opens mindmap which is fine
     but it should also open the news dropdown and position the news like in
     my ss." Centring the node alone left the group heading off the top, so
     what he was reading had no name on it. */
  var g54 = await s54.p.evaluate(async function () {
    /* a map with seven nodes in it is not tall enough to scroll a group
       heading to the top, so the thing being measured would never move.
       Filler below the NEWS group gives the scroller somewhere to go. */
    for (var f = 0; f < 30; f++) kb.push({ id: "zz" + f, group: "Filler", ord: 90,
      shape: "list", label: "Filler " + f, body: "A row to give the map height.",
      at: "2026-10-07T00:00:00.000Z" });
    setView("over"); render();
    document.querySelector(".nwrow").click();
    await new Promise(function (r) { setTimeout(r, 700); });
    var sc = scroller("map"), el = document.querySelector('[data-kb="kn1"]');
    var root = el ? el.closest(".mroot") : null;
    var sr = sc.getBoundingClientRect();
    var rr = root ? root.getBoundingClientRect() : null;
    var r = el ? el.getBoundingClientRect() : null;
    return { open: !!(root && root.classList.contains("open")),
             /* the group's heading at the top of the map's own scroller --
                or as close as the scroller can get, since a map with only a
                few nodes in it is not tall enough to scroll that far */
             head: rr ? Math.round(rr.top - sr.top) : null,
             atEnd: sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 2,
             seen: !!(r && r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1),
             flash: !!(el && el.classList.contains("mflash")) };
  });
  ok("tapping a News row opens the group with its heading at the top",
     g54.open && g54.head !== null && (Math.abs(g54.head) <= 14 || g54.atEnd) &&
     g54.seen && g54.flash, JSON.stringify(g54));
  ok("no console error through any of it", s54.errs.length === 0, s54.errs.join(" | "));
  await s54.ctx.close();
}

/* ---- 55. the keyboard takes the section bar with it, and the way back down ----
   "When chat box is open the nav icons also move up - fix this. Check this
   behaviour for all typing screens." And: "Add a scroll to bottom arrow on
   chat." */
{
  var MANY = [];
  for (var m = 0; m < 40; m++) MANY.push({
    id: "m" + m, text: "Message number " + m + ", long enough to take a line of its own.",
    createdAt: new Date(Date.UTC(2026, 9, 7, 1, m)).toISOString(),
    state: "read", forClaude: true
  });
  var s55 = await open(390, { notes: MANY });
  var k55 = await s55.p.evaluate(function () {
    setView("chat");
    function bar(){ var e=document.querySelector(".vbar"); return e?e.getBoundingClientRect().height:0; }
    var before = bar();
    document.getElementById("cin").focus();
    var typing = bar();
    document.getElementById("cin").blur();
    return { before: before, typing: typing, back: 0 };
  });
  /* The bar cannot be measured against the keyboard here -- no container has
     one -- so what is checked is that focusing a field takes it off the
     layout at all, which is the whole of the fix. */
  ok("the section bar is off screen while he is typing in Chat",
     k55.before > 0 && k55.typing === 0, JSON.stringify(k55));
  var k55b = await s55.p.evaluate(async function () {
    document.getElementById("cin").blur();
    await new Promise(function (r) { setTimeout(r, 30); });
    var back = document.querySelector(".vbar").getBoundingClientRect().height;
    /* every other place he types: the map's composer, and the drawer's note
       box and rename field */
    setView("map");
    document.getElementById("min").focus();
    var map = document.querySelector(".vbar").getBoundingClientRect().height;
    document.getElementById("min").blur();
    await new Promise(function (r) { setTimeout(r, 30); });
    openItem(alive()[0].id);
    /* the rename field is hidden until the pencil opens it, and focusing a
       hidden element does nothing at all */
    titleEdit(true);
    var ren = document.querySelector(".vbar").getBoundingClientRect().height;
    document.getElementById("dTin").blur();
    await new Promise(function (r) { setTimeout(r, 30); });
    return { back: back, map: map, ren: ren,
             after: document.querySelector(".vbar").getBoundingClientRect().height };
  });
  ok("and it comes back the moment he stops",
     k55b.back > 0 && k55b.after > 0, JSON.stringify(k55b));
  ok("the same holds on every other typing screen",
     k55b.map === 0 && k55b.ren === 0, JSON.stringify(k55b));

  var d55 = await s55.p.evaluate(async function () {
    hideDrawer();
    setView("chat"); render();
    await new Promise(function (r) { setTimeout(r, 60); });
    var w = document.getElementById("chatw"), b = document.getElementById("cdn");
    var atFoot = b.classList.contains("off");
    w.scrollTop = 0;
    w.dispatchEvent(new Event("scroll"));
    var away = !b.classList.contains("off");
    var box = b.getBoundingClientRect(), foot = document.querySelector("#v-chat .cbox").getBoundingClientRect();
    b.click();
    await new Promise(function (r) { setTimeout(r, 1400); });
    var landed = w.scrollHeight - w.scrollTop - w.clientHeight;
    return { atFoot: atFoot, away: away, landed: landed,
             /* clear of the composer, not over it */
             clear: box.bottom <= foot.top + 1, w: Math.round(box.width),
             gone: b.classList.contains("off") };
  });
  ok("Chat offers a way back to the newest message only when there is one",
     d55.atFoot && d55.away && d55.clear && d55.w >= 30, JSON.stringify(d55));
  ok("and tapping it lands at the foot of the thread",
     d55.landed < 4 && d55.gone, JSON.stringify(d55));
  ok("no console error through either", s55.errs.length === 0, s55.errs.join(" | "));
  await s55.ctx.close();
}

/* ---- 15. the build stamp moved with the page ---- */
{
  var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  var stamp = (html.match(/var BUILD="([^"]+)"/) || [])[1];
  ok("BUILD is a datestamp", /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(stamp || ""), String(stamp));
  /* checkBuild() matches the FIRST `var BUILD="..."` in the fetched page, so a
     second one anywhere -- even inside a comment, which is how it happened --
     makes the board compare the file against itself, disagree for ever, and
     tell him on every pull that the cache will not let go. */
  var decls = (html.match(/^var BUILD="/gm) || []).length;
  ok("and there is exactly one of it in the file", decls === 1, String(decls));
}

await browser.close();
server.close();
console.log(out.join("\n"));
console.log("\n" + bad + " failing of " + out.length);
process.exit(bad ? 1 : 0);

