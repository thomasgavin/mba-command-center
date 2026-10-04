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
var VIEWS    = ["over", "board", "time", "cal", "graph", "list", "chat"];

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
  await s2.p.click('.vt[data-v="list"]');
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

/* ---- 6. a deleted task leaves every view except the list ---- */
{
  var s6 = await open(390);
  var k6 = await s6.p.evaluate(function () {
    var k = Object.keys(items)[0];
    delItem(k);
    return { id: k, board: board(k), list: list(k), alive: alive().length, gone: gone().length };
    function board(x) { return !!document.querySelector('.card[data-id="' + x + '"]'); }
    function list(x) { return !!document.querySelector('.lrow[data-id="' + x + '"]'); }
  });
  ok("a deleted task is out of the board", !k6.board, JSON.stringify(k6));
  ok("a deleted task is still in the list", k6.list, JSON.stringify(k6));
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
            : f === "dateType" ? "Awaiting" : true);
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
