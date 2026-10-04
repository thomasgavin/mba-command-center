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

/* ---- 6. the build stamp moved with the page ---- */
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
