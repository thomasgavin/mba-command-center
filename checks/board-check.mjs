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
  if (seed) await p.addInitScript(function (s) {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("mbacc_v3", JSON.stringify({ v: 3, notes: s, changed: [], touched: {} }));
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
  var b2 = await s7.p.evaluate(function () {
    addNote(Object.keys(items)[0], "something new", true);
    var n = document.getElementById("notesN");
    return { txt: n.textContent, off: n.classList.contains("off"), total: notes.length };
  });
  ok("and shows the new count, not the total", !b2.off && b2.txt === "1" && b2.total === 2, JSON.stringify(b2));
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
  ok("an unticked note is not outstanding", keep.unread === 1, JSON.stringify(keep));
  ok("but it is still in the task's thread", keep.thread === 2, JSON.stringify(keep));
  await s8.ctx.close();
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
      donePoint: done ? (done.querySelector(".gpt") || {}).style.background : null
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
  ok(tw + "px: a key maps every state to its colour",
     k25.legend.length === STATUS_LABELS.length + 1 &&
     STATUS_LABELS.every(function (l) { return k25.legend.indexOf(l) >= 0; }) &&
     k25.legend.indexOf("Late") >= 0, JSON.stringify(k25.legend));
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
  /* one list, so the only headings are Open, Done and Deleted -- no track names */
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
  await s28.ctx.close();
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
     titles.time === "Tasks", JSON.stringify(titles));

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
  var s32 = await open(390, [{ id: "r1", from: "claude", text: "a reply he has not read",
                               createdAt: new Date().toISOString(), state: "new" }]);
  var badge = await s32.p.evaluate(function () {
    return document.getElementById("notesN").textContent;
  });
  await s32.p.click("#notesBtn");
  await s32.p.waitForTimeout(420);
  var after = await s32.p.evaluate(function () {
    var n = document.getElementById("notesN");
    return { txt: n.textContent, off: n.classList.contains("off"), unread: unread(),
             /* the ones that were new still say so on the list he is looking at */
             tags: document.querySelectorAll("#dBody .tagnew").length };
  });
  /* "The all notes section on top right doesn't mark read once open - I need to
     open the chat section to mark it as read." */
  ok("opening the notes drawer is reading them",
     badge === "1" && after.unread === 0 && after.off, JSON.stringify({ badge: badge, after: after }));
  ok("and the drawer still shows which of them were new", after.tags === 1, JSON.stringify(after));
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

  /* "Why Is the top section still white?" -- it is the iOS status bar, which
     `default` paints opaque white and which is read at launch, so the runtime
     theme-color change could never repaint it. The page owns the inset now. */
  var html35 = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok("the iOS status bar is the page's, not an opaque white strip",
     /apple-mobile-web-app-status-bar-style" content="black-translucent"/.test(html35) &&
     /viewport-fit=cover/.test(html35), "meta");
  var sb = await s35.p.evaluate(function () {
    var e = document.querySelector(".sbar");
    if (!e) return null;
    var dark = {};
    document.documentElement.setAttribute("data-theme", "dark");
    dark.bg = getComputedStyle(e).backgroundColor;
    document.documentElement.removeAttribute("data-theme");
    dark.light = getComputedStyle(e).backgroundColor;
    dark.firstChild = document.querySelector(".app").firstElementChild.className;
    return dark;
  });
  ok("the status strip is the first thing in .app and dark in both themes",
     sb && sb.firstChild === "sbar" &&
     sb.bg === "rgb(27, 27, 27)" && sb.light === "rgb(40, 10, 56)", JSON.stringify(sb));

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
  ok("the app is anchored to the viewport, not to a viewport unit",
     bar.pos === "fixed" && bar.top === 0 && bar.h === bar.win, JSON.stringify(bar));
  ok("and the bar reaches the bottom of it", bar.gap === 0, JSON.stringify(bar));
  var barSrc = /\.app\{([^}]*)\}/.exec(src);
  ok("no viewport-height unit decides the app's height",
     !!barSrc && !/\d(dv|sv|lv|v)h/.test(barSrc[1]), barSrc && barSrc[1]);
  /* The inset's magnitude cannot be trusted -- his installed app reports about
     93px where a simulated one gives 34 -- so the clearance is clamped. It was
     clamped in CSS three times (max, then clamp, then min(max())) and his
     installed app rendered all three identically at the raw inset, so the
     arithmetic is in JS now and no env() may appear in this custom property. */
  var padSrc = /--barpad:([^;]*);/.exec(src);
  ok("the section bar's clearance is a plain number, not an env() in a clamp",
     !!padSrc && !/env\(/.test(padSrc[1]) && /px/.test(padSrc[1]), padSrc && padSrc[1]);
  ok("and JS is what caps it", /Math\.min\(20,Math\.max\(4,insBot-14\)\)/.test(src), "");
  ok("the clearance survives a resize", /addEventListener\("resize",fitBar\)/.test(src), "");
  /* His Sync readout settled it: vp812 app0+812 on an 874 screen with a 62px
     top inset. A translucent status bar puts the window above the layout
     viewport, and innerHeight stops short of the screen by exactly that much,
     so everything anchored to the viewport's bottom floated 62px up. */
  /* A percentage height resolves against the WINDOW on his device (874) while
     `bottom` resolves against the layout viewport (812). Adding --vtop to the
     height as well overshot by the same 62px and put the bar under the screen,
     so the height is a plain 100% and only `bottom` offsets are corrected. */
  ok("the app is sized by a plain percentage, with no inset correction",
     /\.app\{[^}]*height:100%[^}]*\}/.test(src) && !/height:calc\(100% \+ var\(--vtop\)\)/.test(src),
     "");
  ok("and --vtop is only trusted when the two numbers agree",
     /Math\.abs\(over-insTop\)<=2 \? insTop : 0/.test(src), "");
  var vtopUsers = (src.match(/var\(--vtop\)/g) || []).length;
  ok("every surface placed by `bottom` reads it", vtopUsers >= 3, String(vtopUsers));
  ok("and nothing sized from the top does", !/height:calc\([^)]*--vtop/.test(src), "");
  /* Six rounds of this bug went on measuring his screenshots in pixels to work
     out which number was wrong. The device knows all of them. */
  ok("and Sync reports what the layout actually resolved to",
     /function layoutLine\(\)/.test(src) && /" ins"\+Math\.round\(insTop\)/.test(src)
       && /" vtop"\+getComputedStyle/.test(src), "");
  /* "it says you're on the latest version" is only useful with the number on
     it; without one, which build he is looking at can only be worked out by
     measuring a screenshot. */
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

