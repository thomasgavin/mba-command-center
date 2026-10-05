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
var VIEWS    = ["over", "board", "time", "cal", "graph", "chat"];

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
    await s.p.click('.vt[data-v="' + v + '"]');
    await s.p.waitForTimeout(220);
    var m = await s.p.evaluate(function () {
      var d = document.scrollingElement, st = document.querySelector(".stage");
      return { dw: d.scrollWidth, dc: d.clientWidth, dt: d.scrollTop,
               sw: st.scrollWidth, sc: st.clientWidth };
    });
    ok(w + "px " + v + ": nothing runs off the side", m.dw <= m.dc + 1 && m.sw <= m.sc + 1, JSON.stringify(m));
  }
  /* a focused control must not be able to shift the document under the header */
  await s.p.click('.vt[data-v="chat"]');
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
  var tip = await s5.p.evaluate(function () {
    var t = document.getElementById("chatTip"), r = t.getBoundingClientRect();
    return { h: r.height, sh: t.scrollHeight, bottom: r.bottom, win: innerHeight };
  });
  ok("the line under the composer is whole, not squeezed",
     tip.h > 0 && tip.h + 1 >= tip.sh && tip.bottom <= tip.win + 1, JSON.stringify(tip));
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

/* ---- 17. Needs attention sits straight under the milestones on Overview ---- */
{
  var src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  var iMiles = src.indexOf("h+=renderMiles();"), iAtt = src.indexOf('class="tile att"'), iHero = src.indexOf('class="tile hero a"');
  ok("Needs attention comes right after the milestones", iMiles > 0 && iAtt > iMiles && iAtt < iHero, iMiles + "/" + iAtt + "/" + iHero);
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
    RELAY = "https://relay.example";
    var el = document.getElementById("pbn"), read = function () {
      return { off: el.classList.contains("off"), quiet: el.classList.contains("quiet"),
               txt: document.getElementById("pbnT").textContent,
               btn: document.getElementById("pbnB").textContent };
    };
    pushSubbed = false; syncPush(); var offer = read();
    pushSubbed = true;  syncPush(); var done = read();
    return { offer: offer, done: done };
  });
  ok("it offers once, with a button to tap",
     !states.offer.off && !!states.offer.btn, JSON.stringify(states.offer));
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
    var a = alive().filter(function (i) { return i.due; })
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
    ["over", "board", "time", "cal", "graph", "chat"].forEach(function (v) {
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

/* ---- 15. the build stamp moved with the page ---- */
{
  var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  var stamp = (html.match(/var BUILD="([^"]+)"/) || [])[1];
  ok("BUILD is a datestamp", /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(stamp || ""), String(stamp));
}

await browser.close();
server.close();
console.log(out.join("\n"));
console.log("\n" + bad + " failing of " + out.length);
process.exit(bad ? 1 : 0);

