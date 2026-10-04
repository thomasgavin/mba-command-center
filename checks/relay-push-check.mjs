/* The push half of the relay, exercised for real.

   This is the part that cannot be checked by reading: a VAPID header is a
   signed JWT, and a signature that is subtly wrong fails at Apple's push
   service with a 403 and nothing on his lock screen -- hours later, with no
   way to tell it from "no nudge was worth sending".

   So the Board class is driven here with a Map for storage and a stubbed
   fetch, and the JWT it produces is verified against the public key it
   advertises, the same way the push service will.

       node checks/relay-push-check.mjs
*/
import { Board } from "../relay/worker.js";

var out = [], bad = 0;
function ok(name, pass, detail) {
  if (!pass) bad++;
  out.push((pass ? "PASS  " : "FAIL  ") + name + (detail ? "  " + detail : ""));
}

function store() {
  var m = new Map();
  return { get: async k => m.get(k), put: async (k, v) => void m.set(k, v),
           delete: async k => void m.delete(k), list: async () => new Map(), m };
}
function mkBoard(fetchImpl) {
  globalThis.fetch = fetchImpl;
  var st = store();
  var b = new Board({ storage: st, getWebSockets: () => [], acceptWebSocket: () => {},
                      setAlarm: () => {}, getAlarm: async () => null }, {});
  return { b, st };
}
function b64uBytes(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/* ---- the key is made once and then kept ---- */
{
  var { b, st } = mkBoard(async () => ({ ok: true, status: 201 }));
  var v1 = await b.vapid(), v2 = await b.vapid();
  ok("a VAPID key is generated on demand", !!v1.pub && !!v1.jwk, JSON.stringify(v1.pub || "").slice(0, 20));
  ok("and the same one comes back next time", v1.pub === v2.pub,
     "a key that changes orphans every device already subscribed");
  var raw = b64uBytes(v1.pub);
  ok("the public key is a raw P-256 point, which is what a browser accepts",
     raw.length === 65 && raw[0] === 4, raw.length + " bytes, first=" + raw[0]);
}

/* ---- the JWT the push service will actually verify ---- */
{
  var { b } = mkBoard(async () => ({ ok: true, status: 201 }));
  var a = await b.vapidAuth("https://web.push.apple.com/abc123");
  var parts = a.jwt.split(".");
  ok("the auth is a three-part JWT", parts.length === 3, a.jwt.slice(0, 24));
  var head = JSON.parse(b64uBytes(parts[0]).toString());
  var body = JSON.parse(b64uBytes(parts[1]).toString());
  ok("signed ES256, as VAPID requires", head.alg === "ES256" && head.typ === "JWT", JSON.stringify(head));
  ok("the audience is the push service's origin, not the full endpoint",
     body.aud === "https://web.push.apple.com", body.aud);
  ok("it expires, and within the 24h a push service will accept",
     body.exp > Date.now() / 1000 && body.exp < Date.now() / 1000 + 24 * 3600, String(body.exp));
  /* the repo is public: an email address here is a line in a scraper's list */
  ok("the contact is the board, not an address", /^https:/.test(body.sub) && !/@/.test(body.sub), body.sub);

  var sig = b64uBytes(parts[2]);
  ok("the signature is raw r||s, not a DER wrapper", sig.length === 64, sig.length + " bytes");
  var pub = await crypto.subtle.importKey("raw", b64uBytes(a.pub),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  var good = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig,
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  ok("and it verifies against the key the board was given", good,
     "a bad signature is a 403 at the push service and silence on his phone");
}

/* ---- who gets rung, and who does not ---- */
{
  var sent = [];
  var { b, st } = mkBoard(async (url, init) => { sent.push({ url, init }); return { ok: true, status: 201 }; });
  await st.put("subs", { "https://web.push.apple.com/one": { at: "x" } });

  var now = () => new Date().toISOString();
  var nudge = (extra) => Object.assign({ id: "c1", from: "claude", kind: "nudge",
    about: "sbi-sanction", itemTitle: "SBI sanction", text: "Where does it stand?",
    createdAt: now() }, extra || {});

  await b.maybeNotify({ notes: [{ id: "n1", from: "me", text: "I just typed this", createdAt: now() }] }, "board");
  ok("his own note does not ring his own phone", sent.length === 0, JSON.stringify(sent.length));

  /* The board's own /send carries outNotes(), which includes Claude's notes so
     they merge across his devices -- so without this gate every edit he made
     re-sent old replies and each one rang his phone as news. It did. */
  await b.maybeNotify({ notes: [nudge()] }, "board");
  ok("a nudge echoed back by the board does not ring it either",
     sent.length === 0, "outNotes() re-sends Claude's own notes on every edit");

  /* he asked for this in these words: "I don't need notifications about
     replies anyway" */
  await b.maybeNotify({ notes: [{ id: "c2", from: "claude", text: "answering your question",
    createdAt: now() }] }, "claude");
  ok("a plain reply does not ring it", sent.length === 0, JSON.stringify(sent.length));

  /* "Why am I getting this notification? This was ages back." */
  await b.maybeNotify({ notes: [nudge({ createdAt: new Date(Date.now() - 36e5).toISOString() })] }, "claude");
  ok("an old nudge replayed is not news", sent.length === 0, "an hour-old nudge must not ring");

  /* the newest is the newest by its clock, not by where it sits in an array */
  await b.maybeNotify({ notes: [
    nudge({ id: "new", itemTitle: "SBI sanction", text: "the new one", createdAt: now() }),
    nudge({ id: "old", itemTitle: "Something else", text: "the old one",
            createdAt: new Date(Date.now() - 72e5).toISOString() })
  ] }, "claude");
  ok("a nudge does ring it", sent.length === 1, JSON.stringify(sent.length));
  ok("and it is the newest one, whatever order they arrived in",
     (await st.get("latest")).body === "the new one", JSON.stringify(await st.get("latest")));
  ok("with a VAPID header and no body",
     /^vapid t=/.test(sent[0].init.headers.Authorization) && !sent[0].init.body,
     JSON.stringify(sent[0].init.headers));
  var latest = await st.get("latest");
  ok("and the worker is told what to say", latest.title === "SBI sanction" && latest.about === "sbi-sanction",
     JSON.stringify(latest));
  ok("tagged per task, so a second nudge replaces the first", latest.tag === "nudge-sbi-sanction", latest.tag);
}

/* ---- a device that is gone ---- */
{
  var { b, st } = mkBoard(async () => ({ ok: false, status: 410 }));
  await st.put("subs", { "https://web.push.apple.com/dead": { at: "x" }, "https://web.push.apple.com/two": { at: "x" } });
  await b.notify();
  ok("a 410 drops that device", Object.keys(await st.get("subs")).length === 0,
     JSON.stringify(await st.get("subs")));

  var { b: b2, st: st2 } = mkBoard(async () => { throw new Error("network"); });
  await st2.put("subs", { "https://web.push.apple.com/one": { at: "x" } });
  await b2.notify();
  ok("but a network error keeps it", Object.keys(await st2.get("subs")).length === 1,
     "a transient failure must not quietly unsubscribe his phone");
}

console.log(out.join("\n"));
console.log("\n" + bad + " failing of " + out.length);
process.exit(bad ? 1 : 0);
