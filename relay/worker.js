/* MBA Command Center relay.

   It started as a mailman: the board handed it a note, it committed that note
   into `claude-inbox/`, and a page load later the other device saw it. That
   worked, and it made the repo the channel -- a commit per message, and a board
   that had to poll GitHub to notice anything.

   It is now also the board's memory and its loudspeaker. It keeps the last few
   days of chat and board edits as an append-only log, hands every device an
   open WebSocket, and pushes each new event down it. Nothing about chat touches
   git any more except one archive commit a day, which exists so the history
   survives this Worker being deleted.

   Why a Durable Object: a plain Worker cannot push. Two requests to the same
   Worker land in different isolates with no way to reach each other, so the
   reply written by the GitHub job could never find the socket the phone is
   holding. A Durable Object is the one place both of them can meet. SQLite
   backed, because that is the only kind the free plan allows, and the
   hibernation API so an idle socket costs nothing while it waits.

   The address is in public page source, so the blast radius stays small: one
   payload shape, one folder on one branch, never a caller-supplied path, a size
   cap, and a hard ceiling on how many Claude runs an hour anyone can start --
   that last one matters more than the rest, because a run costs the owner's
   subscription rather than a line in a public folder.

   Secrets (Worker > Settings > Variables):
     GH_TOKEN   fine-grained PAT, this repo only, Contents: read and write
     AGENT_KEY  shared with the GitHub job as a repository secret. This one is
                genuinely secret -- it is the only thing that may write a reply
                or read the whole log.
     RELAY_KEY  optional; the page sends it, so it is public too. Bots only.
*/

var REPO   = "thomasgavin/mba-command-center";
var BRANCH = "main";
var INBOX  = "claude-inbox";
var MAX    = 64 * 1024;          /* a note payload is a few KB; this is generous */
var ORIGIN = "https://thomasgavin.github.io";

/* The board's own origin, and the only one allowed to call this. An
   ALLOW_ORIGIN variable overrides it, which is how the same Worker can be run
   against a local copy of the page without loosening what is deployed. */
var allowOrigin = ORIGIN;

var KEEP_DAYS  = 7;             /* matches CHAT_DAYS in index.html */
var HIST       = "history";     /* the audit log, one readable file per day */
var HIST_DAYS  = 30;            /* how far back it is kept */
var HIST_MAX   = 2000;          /* entries held between archives, as a stop */
var MAX_RUNS   = 20;            /* Claude runs an hour, from every caller together */
var ARCHIVE_MS = 24*3600*1000;  /* one snapshot commit a day, not one per message */
var MAX_BACK   = 400;           /* events a catch-up will hand back at once */
var PUSH_MAX   = 8;             /* devices on the push list; he has two */
/* How old a nudge may be and still ring a phone. Anything past this is a
   replay of something he has already seen, which is worse than silence. */
var NOTIFY_FRESH = 10 * 60 * 1000;
/* VAPID wants a way to contact the sender. It is the board, not an address:
   this repository is public and an email written into it is a line in a
   scraper's list. */
var PUSH_SUB   = "https://thomasgavin.github.io/mba-command-center/";

function cors(extra){
  var h = {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Relay-Key",
    "Access-Control-Max-Age": "86400"
  };
  if(extra) Object.keys(extra).forEach(function(k){ h[k]=extra[k]; });
  return h;
}
function out(code, obj){
  return new Response(JSON.stringify(obj), {status:code, headers:cors({"Content-Type":"application/json"})});
}

/* base64 of UTF-8, chunked: a spread over one big array blows the stack */
/* base64url over raw bytes, which is what JOSE and VAPID speak -- not the
   same thing as b64() below, which is standard base64 over a string for
   GitHub's contents API. */
function b64u(buf){
  var b = new Uint8Array(buf), s = "";
  for(var i=0;i<b.length;i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function enc(str){ return new TextEncoder().encode(str); }

function b64(str){
  var bytes = new TextEncoder().encode(str), s = "";
  for(var i=0;i<bytes.length;i+=0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i+0x8000));
  return btoa(s);
}

function unb64(b){
  var bin = atob(String(b).replace(/\s+/g,""));
  var bytes = new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
/* A task title is the owner's text and goes into a markdown table cell, so a
   pipe in it would split the row and a newline would end it. The log is in a
   public repo and nobody renders it as HTML, but a table that silently
   mangles itself is still a log that cannot be trusted. */
function md(v){
  return String(v===null||v===undefined ? "" : v)
    .replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}
/* An alarm that fires twice in one UTC day -- a redeploy re-arms it -- must add
   to that day rather than replace it. Rows are whole lines and identical ones
   are the same change seen twice, so a union keyed on the line is enough. */
function mergeHistory(oldBody, newBody){
  var rows = function(t){
    return String(t).split("\n").filter(function(l){
      return /^\| \d{2}:\d{2} \|/.test(l);
    });
  };
  var seen = {}, all = [];
  rows(oldBody).concat(rows(newBody)).forEach(function(l){
    if(seen[l]) return; seen[l]=true; all.push(l);
  });
  all.sort(function(a,b){ return a.slice(0,8).localeCompare(b.slice(0,8)); });
  var head = String(newBody).split("|---|---|---|---|")[0];
  return head + "|---|---|---|---|\n" + all.join("\n") + "\n";
}

/* The pull picks the newest file by sorting names, so every writer has to stamp
   in the same zone or the sort lies. The board stamps in the owner's local time
   and we cannot infer that here, so we take its stamp -- but only as four
   fixed-width digit groups, and the folder and extension stay ours. */
var STAMP_RE = /^\d{4}-\d{2}-\d{2}-\d{4}$/;

function utcStamp(d){
  var z=function(v){ return (v<10?"0":"")+v; };
  return d.getUTCFullYear()+"-"+z(d.getUTCMonth()+1)+"-"+z(d.getUTCDate())+
         "-"+z(d.getUTCHours())+z(d.getUTCMinutes());
}
function stampFrom(payload, d){
  var s = payload && payload.stamp;
  return (typeof s==="string" && STAMP_RE.test(s)) ? s : utcStamp(d);
}

/* What the audit log reports, and how each value reads to a person.
   Deliberately not every field in the diff: `manual`, `snoozes` and `origDue`
   are bookkeeping the board keeps about itself -- a snooze already shows up as
   the due date it moved -- and logging them would bury the three or four lines
   a day that actually mean something. */
var EFFORT_LABEL = {quick:"under an hour", hours:"a few hours", day:"a full day",
                    multi:"several days", wait:"mostly waiting"};
/* `blocked` is the stored key; "Upcoming" is what the board calls it now. */
var STATUS_LABEL = {doing:"In progress", todo:"To do", blocked:"Upcoming", done:"Done"};
function plain(v){ return (v===null||v===undefined||v==="") ? "\u2014" : String(v); }
var HIST_FIELDS = [
  /* a rename is a board change like any other, and the one the log is most
     useful for: a title is how every other row in the file names its task */
  {k:"title",    label:"Title",    show:plain},
  {k:"status",   label:"Status",   show:function(v){ return plain(STATUS_LABEL[v]||v); }},
  {k:"due",      label:"Due",      show:plain},
  {k:"priority", label:"Priority", show:plain},
  {k:"effort",   label:"Effort",   show:function(v){ return plain(EFFORT_LABEL[v]||v); }},
  {k:"deleted",  label:"Deleted",  show:function(v){ return v ? "yes" : "no"; }},
  /* His answer to a NEWS item. It is exactly the kind of decision this log is
     for: a magenta task that quietly stopped appearing is otherwise a thing
     he cannot reconstruct a week later. */
  {k:"newsState",label:"News",     show:function(v){ return plain(v==="accept"?"accepted":v==="reject"?"rejected":v); }}
];
/* An item at its SEED value has no entry for the field at all, and an item
   reset to SEED travels as {id,at,seed:true}. Both mean "whatever the baseline
   says", which from the log's point of view is the same absence. */
function fieldOf(row, k){
  if(!row || row.seed) return null;
  var v = row[k];
  if(v===undefined) return null;
  if(k==="deleted") return !!v;
  return v;
}

/* a board export, not arbitrary JSON: both arrays must be present and sane */
function looksLikeAnExport(p){
  if(!p || typeof p!=="object" || Array.isArray(p)) return false;
  if(!Array.isArray(p.notes) || !Array.isArray(p.changed)) return false;
  if(p.notes.length > 200 || p.changed.length > 200) return false;
  if(typeof p.exportedAt !== "string" || p.exportedAt.length > 40) return false;
  return true;
}

function gh(env, path, init){
  init = init || {};
  init.headers = {
    "Authorization": "Bearer "+env.GH_TOKEN,
    "Accept": "application/vnd.github+json",
    "User-Agent": "mba-command-center-relay",
    "Content-Type": "application/json"
  };
  return fetch("https://api.github.com/repos/"+REPO+"/contents/"+path, init);
}
/* `sha` turns a create into a replace. A day's history file is written once by
   the archive, but an alarm that fires twice in a day -- a redeploy re-arms it
   -- must rewrite that day rather than fail with a 422 and lose the entries. */
async function commit(env, path, body, message, sha){
  var b = {message:message, content:b64(body), branch:BRANCH};
  if(sha) b.sha = sha;
  return gh(env, path, {method:"PUT", body:JSON.stringify(b)});
}
/* Both return null rather than throwing: the audit log is bookkeeping, and a
   GitHub hiccup must never take the chat down with it. */
async function listDir(env, path){
  try{
    var r = await gh(env, path+"?ref="+BRANCH, {method:"GET"});
    if(!r.ok) return null;
    var j = await r.json();
    return Array.isArray(j) ? j : null;
  }catch(e){ return null; }
}
async function removeFile(env, path, sha, message){
  try{
    return await gh(env, path, {method:"DELETE",
      body:JSON.stringify({message:message, sha:sha, branch:BRANCH})});
  }catch(e){ return null; }
}

/* Write a file into claude-inbox/, taking the next free name on a collision.
   The separator is "_" and not "-": the board picks the newest file by sorting
   names, and "-" (0x2D) sorts BEFORE "." (0x2E), so "...-0111-1.json" would
   land before "...-0111.json" and the board would read the older of a pair.
   "_" (0x5F) sorts after ".". Seen for real on 2026-10-03. */
async function writeInbox(env, base, body, label){
  for(var n=0; n<10; n++){
    /* nine suffixed slots, then a millisecond tail: the stamp is only a minute,
       and six sends inside one used to run out of names and fail outright */
    var name = base + (n ? (n<9 ? "_"+n : "_"+(Date.now()%1000000)) : "");
    var path = INBOX+"/"+name+".json";
    var r = await commit(env, path, body, label+" - "+name);
    if(r.ok){
      var j = await r.json();
      return {ok:true, path:path, commit:(j.commit&&j.commit.sha)||null};
    }
    if(r.status !== 422 && r.status !== 409){
      var t = await r.text();
      return {ok:false, status:r.status, detail:t.slice(0,300)};
    }
  }
  return {ok:false, status:409, detail:"could not find a free filename"};
}

/* ---------- the log ---------- */

/* Event keys sort lexically, so the sequence number is zero-padded. Ten digits
   is more messages than this board will ever see and keeps `list({start})` as
   the whole implementation of "what did I miss". */
function evKey(n){ return "e:"+("0000000000"+n).slice(-10); }

function olderThan(days, iso){
  return (iso||"") < new Date(Date.now()-days*86400000).toISOString();
}

export class Board {
  constructor(ctx, env){ this.ctx = ctx; this.env = env; }

  /* ---------- Web Push ----------
     Everything under here exists so a nudge can reach his lock screen. iOS
     will only deliver one to a home-screen app through a service worker and
     VAPID, so the relay is the push sender: it is the only part of this that
     is awake when a nudge is written. */

  /* The keypair is generated here and kept in storage rather than handed in as
     a secret. A VAPID key identifies this sender to Apple and nothing else --
     it unlocks no account -- so making it a repository secret would be one
     more thing for him to paste and one more way for the two ends to disagree.
     Generated once, on the first request that needs it. */
  async vapid(){
    var v = await this.ctx.storage.get("vapid");
    if(v) return v;
    var kp = await crypto.subtle.generateKey({name:"ECDSA", namedCurve:"P-256"}, true, ["sign"]);
    v = {
      pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)),
      jwk: await crypto.subtle.exportKey("jwk", kp.privateKey)
    };
    await this.ctx.storage.put("vapid", v);
    return v;
  }

  /* One JWT per push service origin, good for twelve hours. `sub` is the board
     itself rather than an address: this repository is public and an email in it
     is a line in a scraper's list. */
  async vapidAuth(endpoint){
    var v = await this.vapid();
    var aud = new URL(endpoint).origin;
    var head = b64u(enc(JSON.stringify({typ:"JWT", alg:"ES256"})));
    var body = b64u(enc(JSON.stringify({
      aud: aud, exp: Math.floor(Date.now()/1000) + 12*3600, sub: PUSH_SUB
    })));
    var key = await crypto.subtle.importKey("jwk", v.jwk,
      {name:"ECDSA", namedCurve:"P-256"}, false, ["sign"]);
    /* WebCrypto returns r||s, which is exactly the 64 bytes a JOSE ES256
       signature is; nothing has to unpick a DER wrapper. */
    var sig = await crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, key,
      enc(head+"."+body));
    return {jwt: head+"."+body+"."+b64u(sig), pub: v.pub};
  }

  /* A bare push: no encrypted body, so the service worker wakes and asks
     /push/latest what to say. That keeps the note text out of Apple's push
     service entirely and keeps aes128gcm out of this file. */
  async notify(){
    var subs = (await this.ctx.storage.get("subs")) || {};
    var eps = Object.keys(subs), dead = [];
    for(var i=0;i<eps.length && i<PUSH_MAX;i++){
      var ep = eps[i], r = null;
      try{
        var a = await this.vapidAuth(ep);
        r = await fetch(ep, {method:"POST", headers:{
          "TTL":"86400", "Urgency":"normal", "Content-Length":"0",
          "Authorization":"vapid t="+a.jwt+", k="+a.pub
        }});
      }catch(e){ r = null; }
      /* 404 and 410 are the push service saying this device is gone for good.
         Anything else may be transient and the subscription stays. */
      if(r && (r.status===404 || r.status===410)) dead.push(ep);
    }
    if(dead.length){
      dead.forEach(function(k){ delete subs[k]; });
      await this.ctx.storage.put("subs", subs);
    }
    await this.ctx.storage.put("lastPush", {at:new Date().toISOString(), sent:eps.length, dropped:dead.length});
  }

  /* What the worker will read back. Only Claude's own notes ring a phone: his
     own edits are the thing he just did, and a device buzzing at its owner for
     typing is the fastest way to have notifications turned off. */
  /* Three gates, and the first two are each enough on their own. It shipped
     with none of them and rang his phone with a reply from the day before:

     - `by` must be "claude". The board's own /send carries `outNotes()`, which
       deliberately includes Claude's notes so they merge across his devices --
       so every edit he made re-sent old replies, and each one looked like news.
       A board payload can never be the origin of a Claude message.
     - A nudge is the only thing worth a lock screen. A reply is an answer to
       something he just asked, and he is already looking at the thread; he
       said so: "I don't need notifications about replies anyway."
     - And it has to be new. Picking the last element of an array assumes an
       order nothing guarantees, so the newest is chosen by `createdAt`, and
       anything older than NOTIFY_FRESH is a replay rather than news. */
  async maybeNotify(payload, by){
    if(by !== "claude") return;
    /* A newsletter is the second thing worth a banner, and the first one he
       asked for by name: "Gavin, today's command newsletter is ready", renamed to the brief it
       actually is on 2026-10-06. It is
       written by the job on a schedule, so it is news by construction, and it
       goes out ahead of a nudge in the same payload because it is the thing he
       is expecting at that hour. */
    var nw = ((payload && payload.news) || []).filter(function(n){
      return n && n.id && (n.at || n.createdAt);
    });
    if(nw.length){
      nw.sort(function(a,b){ return String(a.at||a.createdAt||"").localeCompare(String(b.at||b.createdAt||"")); });
      var w = nw[nw.length-1];
      var wage = Date.now() - Date.parse(w.at || w.createdAt || "");
      if(wage >= 0 && wage <= NOTIFY_FRESH){
        await this.ctx.storage.put("latest", {
          title: "Gavin, today's daily brief is ready",
          body: w.period === "weekly" ? "Your weekly report is in." : "Your daily brief is in.",
          /* one tag for all of them: a second edition replaces the first on the
             lock screen rather than stacking up behind it */
          tag: "newsletter",
          about: null, go: "news",
          at: new Date().toISOString()
        });
        await this.notify();
        return;
      }
    }
    var ns = (payload && payload.notes) || [];
    var mine = ns.filter(function(n){ return n && n.from === "claude" && n.kind === "nudge"; });
    if(!mine.length) return;
    mine.sort(function(a,b){ return String(a.createdAt||"").localeCompare(String(b.createdAt||"")); });
    var n = mine[mine.length-1];
    var age = Date.now() - Date.parse(n.createdAt || "");
    if(!(age >= 0) || age > NOTIFY_FRESH) return;
    await this.ctx.storage.put("latest", {
      title: n.itemTitle || "Worth a look",
      body: String(n.text || "").slice(0, 180),
      tag: "nudge-" + (n.about || "board"),
      about: n.about || n.itemId || null,
      at: new Date().toISOString()
    });
    await this.notify();
  }

  async append(kind, payload){
    var seq = ((await this.ctx.storage.get("seq")) || 0) + 1;
    var ev  = {seq:seq, kind:kind, at:new Date().toISOString(), payload:payload};
    await this.ctx.storage.put(evKey(seq), ev);
    await this.ctx.storage.put("seq", seq);
    return ev;
  }

  async backlog(since){
    var m = await this.ctx.storage.list({prefix:"e:", start:evKey(since+1), limit:MAX_BACK});
    var evs = [];
    m.forEach(function(v){ evs.push(v); });
    return evs;
  }

  /* One socket per device, and a device that reconnects asks for what it missed
     rather than refetching everything. A send that nobody is listening to is
     not an error: the log is the record and the socket is only delivery. */
  push(ev){
    var msg = JSON.stringify({t:"ev", ev:ev});
    this.ctx.getWebSockets().forEach(function(ws){
      try{ ws.send(msg); }catch(e){}
    });
  }

  /* The rolling snapshot. The board applies each event through its own
     `mergePayload`, so this copy is not what keeps the two devices honest -- it
     exists only so the daily archive is one coherent file rather than a replay
     of every event. Per item, newest `at` wins, same rule as the board. */
  async fold(payload, by){
    var snap = (await this.ctx.storage.get("snap")) || {items:{}, notes:{}, kb:{}};
    if(!snap.kb) snap.kb = {};
    if(!snap.news) snap.news = {};
    var hist = (await this.ctx.storage.get("hist")) || [];
    var who  = by==="claude" ? "Claude" : "you";
    (payload.changed||[]).forEach(function(c){
      if(!c || !c.id) return;
      var had = snap.items[c.id];
      if(had && (had.at||"") > (c.at||"")) return;
      /* The audit log is written here because this is the one place every
         change passes through, from either device and from Claude alike. It
         records the move, not the state: "what did this become, from what, and
         who did it" is the question a log is for, and the snapshot already
         answers "what is it now". */
      HIST_FIELDS.forEach(function(f){
        var a = fieldOf(had, f.k), b = fieldOf(c, f.k);
        if(a===b) return;
        if(hist.length < HIST_MAX) hist.push({
          at: c.at || payload.exportedAt || new Date().toISOString(),
          id: c.id, title: c.title || had&&had.title || c.id,
          f: f.label, a: f.show(a), b: f.show(b), by: who
        });
      });
      snap.items[c.id] = c;
    });
    (payload.notes||[]).forEach(function(n){
      if(!n || !n.id) return;
      var had = snap.notes[n.id];
      /* a note is immutable except for being answered, so the richer one wins */
      if(had && had.answered && !n.answered) return;
      snap.notes[n.id] = n;
    });
    /* The mind map. It is folded here for one reason: the daily archive is what
       keeps the GitHub pull a working fallback rather than dead code, and a
       snapshot that carried his tasks and notes but not what he knows would
       lose the one part of the board that is not rebuildable from SEED.
       Newest clock wins, exactly as the board itself merges it. */
    (payload.kb||[]).forEach(function(n){
      if(!n || !n.id) return;
      var had = snap.kb[n.id];
      if(had && (had.at||"") > (n.at||"")) return;
      snap.kb[n.id] = n;
    });
    /* The newsletters, for the same reason as the map: they are written once
       by the job and never rebuilt from SEED, so an archive without them is an
       archive missing the part that cannot be recovered. `read` is a per-device
       flag and deliberately not folded here -- reading Sunday's report on the
       laptop says nothing about the phone. */
    (payload.news||[]).forEach(function(n){
      if(!n || !n.id) return;
      var had = snap.news[n.id];
      if(had && (had.at||"") > (n.at||"")) return;
      var copy = {}; Object.keys(n).forEach(function(k){ if(k!=="read") copy[k]=n[k]; });
      snap.news[n.id] = copy;
    });
    await this.ctx.storage.put("snap", snap);
    await this.ctx.storage.put("hist", hist);
    return snap;
  }

  /* The audit log, written out with the daily archive.
     One file per UTC day, because that makes both halves trivial: a day is
     written once and never edited again, and pruning is deleting a filename
     older than the window rather than rewriting a rolling file. */
  async writeHistory(){
    var hist = (await this.ctx.storage.get("hist")) || [];
    if(!hist.length) return {days:0, lines:0};
    var days = {};
    hist.forEach(function(h){
      var d = (h.at||"").slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      (days[d] = days[d] || []).push(h);
    });
    var wrote = 0, lines = 0, kept = [];
    for(var d of Object.keys(days).sort()){
      var rows = days[d].slice().sort(function(a,b){ return (a.at||"").localeCompare(b.at||""); });
      var body = "# "+d+"\n\n"+
        "Every change to the board on this day, as the relay saw it. Kept for "+
        HIST_DAYS+" days, then deleted.\n\n"+
        "| Time (UTC) | Task | Change | By |\n|---|---|---|---|\n"+
        rows.map(function(h){
          /* a layout line has no previous value to diff against, so it reads
             as a statement rather than a move; an arrow from nothing is noise */
          var what = h.a === "" ? md(h.f)+" "+md(h.b)
                                : md(h.f)+" "+md(h.a)+" \u2192 "+md(h.b);
          return "| "+(h.at||"").slice(11,16)+" | "+md(h.title)+" | "+
                 what+" | "+md(h.by)+" |";
        }).join("\n")+"\n";
      var path = HIST+"/"+d+".md";
      /* a day already on disk is replaced, so an alarm that fires twice in one
         day adds the newer entries rather than failing on a name that exists */
      var sha = null;
      var have = await listDir(this.env, HIST);
      if(have) have.forEach(function(f){ if(f.name === d+".md") sha = f.sha; });
      if(sha){
        var old = await this.readHistory(path);
        if(old) body = mergeHistory(old, body);
      }
      /* A throw here, not just a bad status: GitHub being unreachable must
         leave the day pending and let the loop carry on to the next one,
         rather than abort the write and skip the prune behind it. */
      var r = null;
      try{ r = await commit(this.env, path, body, "History "+d, sha); }catch(e){ r = null; }
      if(r && r.ok){ wrote++; lines += rows.length; }
      else { kept = kept.concat(days[d]); }   /* try again on the next archive */
    }
    await this.ctx.storage.put("hist", kept);
    return {days:wrote, lines:lines};
  }

  async readHistory(path){
    try{
      var r = await gh(this.env, path+"?ref="+BRANCH, {method:"GET"});
      if(!r.ok) return null;
      var j = await r.json();
      return j && j.content ? unb64(j.content) : null;
    }catch(e){ return null; }
  }

  /* Delete the days that have fallen out of the window. Nothing else in the
     repo is on a clock like this, so it is done here rather than left to a
     workflow that would need its own schedule. */
  async pruneHistory(){
    var have = await listDir(this.env, HIST);
    if(!have) return 0;
    var cut = new Date(Date.now() - HIST_DAYS*86400000).toISOString().slice(0,10);
    var gone = 0;
    for(var f of have){
      var m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(f.name||"");
      if(!m || m[1] >= cut) continue;
      var r = await removeFile(this.env, HIST+"/"+f.name, f.sha, "History: drop "+m[1]);
      if(r && r.ok) gone++;
    }
    return gone;
  }

  async prune(){
    var snap = (await this.ctx.storage.get("snap")) || {items:{}, notes:{}, kb:{}};
    var dropped = 0;
    Object.keys(snap.notes).forEach(function(k){
      if(olderThan(KEEP_DAYS, snap.notes[k].createdAt)){ delete snap.notes[k]; dropped++; }
    });
    if(dropped) await this.ctx.storage.put("snap", snap);

    /* Events age out on the same clock. A device further behind than the window
       falls back to the repo, which is exactly what the daily archive is for. */
    var m = await this.ctx.storage.list({prefix:"e:", limit:1000}), old = [];
    m.forEach(function(v, k){ if(olderThan(KEEP_DAYS, v.at)) old.push(k); });
    if(old.length) await this.ctx.storage.delete(old);
    return {notes:dropped, events:old.length};
  }

  /* The ceiling that makes a public address survivable. Without it the worst
     an abuser does is not junk in a public folder, it is the owner's Claude
     subscription spent on nothing. */
  async mayRun(){
    var hits = ((await this.ctx.storage.get("runs")) || []).filter(function(t){
      return t > Date.now() - 3600000;
    });
    if(hits.length >= MAX_RUNS) return false;
    hits.push(Date.now());
    await this.ctx.storage.put("runs", hits);
    return true;
  }

  /* Ask GitHub to start the Answer-notes job. It used to be started by the
     commit itself; now there is no commit, so we say so out loud. */
  async startJob(){
    if(!(await this.mayRun())) return {ok:false, why:"rate limit"};
    /* GitHub being down must not lose the note: the event is already in the log
       and already pushed, so a failed start is reported and nothing else. The
       twice-daily Routine still picks the note up as the backstop. */
    try{
      var r = await fetch("https://api.github.com/repos/"+REPO+"/dispatches", {
        method:"POST",
        headers:{
          "Authorization":"Bearer "+this.env.GH_TOKEN,
          "Accept":"application/vnd.github+json",
          "User-Agent":"mba-command-center-relay",
          "Content-Type":"application/json"
        },
        body:JSON.stringify({event_type:"notes"})
      });
      if(r.ok) return await this.noteJob({ok:true});
      var t = await r.text();
      return await this.noteJob({ok:false, why:"github "+r.status, detail:t.slice(0,200)});
    }catch(e){
      return await this.noteJob({ok:false, why:"could not reach github"});
    }
  }

  /* Remember how the last start went. Without it a failed start is invisible:
     the board only cares that its note was logged, so a relay that cannot ask
     GitHub for a run looks exactly like one that can, and the only symptom is
     a reply that never comes. `/state` prints this. */
  async noteJob(res){
    await this.ctx.storage.put("lastJob", {at:new Date().toISOString(),
      ok:!!res.ok, why:res.why||null, detail:res.detail||null});
    return res;
  }

  async armArchive(){
    var at = await this.ctx.storage.getAlarm();
    if(at === null) await this.ctx.storage.setAlarm(Date.now() + ARCHIVE_MS);
  }

  /* One commit a day, so the repo is a backup rather than the channel. It is
     written in the shape the board already reads, which is what makes the old
     GitHub pull a working fallback instead of dead code. */
  async alarm(){
    await this.prune();
    var snap = (await this.ctx.storage.get("snap")) || {items:{}, notes:{}, kb:{}};
    var notes = Object.keys(snap.notes).map(function(k){ return snap.notes[k]; });
    var items = Object.keys(snap.items).map(function(k){ return snap.items[k]; });
    /* the map never expires: a note ages out at 7 days because it is a message,
       and a fact he wrote down is the opposite of a message */
    var kb    = Object.keys(snap.kb||{}).map(function(k){ return snap.kb[k]; });
    var news  = Object.keys(snap.news||{}).map(function(k){ return snap.news[k]; });
    if(notes.length || items.length || kb.length || news.length){
      var now = new Date();
      var body = JSON.stringify({
        v:3, op:"archive", exportedAt:now.toISOString(),
        why:"daily snapshot from the relay", notes:notes, changed:items, kb:kb, news:news
      }, null, 2)+"\n";
      await writeInbox(this.env, utcStamp(now), body, "Relay snapshot");
    }
    /* after the snapshot, never instead of it: the archive is what keeps the
       GitHub fallback alive, and the log must not be able to cost it */
    try{ await this.writeHistory(); await this.pruneHistory(); }catch(e){}
    await this.ctx.storage.setAlarm(Date.now() + ARCHIVE_MS);
  }

  /* --- sockets --- */

  async webSocketMessage(ws, raw){
    var m = null;
    try{ m = JSON.parse(raw); }catch(e){ return; }
    if(!m || typeof m!=="object") return;
    if(m.t === "ping"){ try{ ws.send(JSON.stringify({t:"pong"})); }catch(e){} return; }
    if(m.t === "since"){
      var evs = await this.backlog(Math.max(0, m.seq|0));
      try{ ws.send(JSON.stringify({t:"catchup", seq:(await this.ctx.storage.get("seq"))||0, evs:evs})); }catch(e){}
    }
  }
  async webSocketClose(ws, code, reason, clean){ try{ ws.close(1000); }catch(e){} }
  async webSocketError(ws){ }

  async fetch(request){
    var u = new URL(request.url), p = u.pathname;

    if(p === "/ws"){
      if(request.headers.get("Upgrade") !== "websocket") return out(426, {error:"expected a websocket"});
      var pair = new WebSocketPair();
      /* acceptWebSocket, not accept: the standard API bills for the whole time
         the socket is open, which for a board left on a desk all day is the
         difference between free and not. */
      this.ctx.acceptWebSocket(pair[1]);
      var since = Math.max(0, parseInt(u.searchParams.get("since")||"0", 10) || 0);
      var evs   = await this.backlog(since);
      var seq   = (await this.ctx.storage.get("seq")) || 0;
      try{ pair[1].send(JSON.stringify({t:"catchup", seq:seq, evs:evs})); }catch(e){}
      await this.armArchive();
      return new Response(null, {status:101, webSocket:pair[0]});
    }

    if(p === "/state"){
      var s = Math.max(0, parseInt(u.searchParams.get("since")||"0", 10) || 0);
      return out(200, {seq:(await this.ctx.storage.get("seq"))||0,
        lastJob:(await this.ctx.storage.get("lastJob"))||null,
        devices:Object.keys((await this.ctx.storage.get("subs"))||{}).length,
        lastPush:(await this.ctx.storage.get("lastPush"))||null,
        evs:await this.backlog(s)});
    }

    /* What a device's layout actually resolved to. It used to be printed in
       the Sync toast, which answered the question it was built for -- a nav
       bar that floated for six rounds because nobody could see the numbers --
       and then became a wall of digits over the board on every sync. The log
       is where every other record of this board already lives, and a line
       only lands when something about the device changed. */
    if(p === "/diag"){
      var d = await request.json();
      var line = String((d && d.line) || "").slice(0, 200);
      if(!line) return out(400, {error:"no line"});
      var hd = (await this.ctx.storage.get("hist")) || [];
      var last = null;
      for(var i=hd.length-1; i>=0; i--) if(hd[i].f === "layout"){ last = hd[i]; break; }
      if(!last || last.b !== line){
        if(hd.length < HIST_MAX) hd.push({
          at: new Date().toISOString(), id:"device", title:"This device",
          f:"layout", a:"", b:line, by:"build "+String((d&&d.build)||"?").slice(0,24)
        });
        await this.ctx.storage.put("hist", hd);
        /* Written through to the repo straight away rather than waiting for
           the daily archive. The whole point of this route is that a layout
           question gets answered from a file the same minute he opens the
           board; a line sitting in Durable Object storage until midnight is
           no better than no line at all. */
        try{ await this.writeHistory(); }catch(e){}
        await this.armArchive();
      }
      return out(200, {ok:true});
    }

    if(p === "/send" || p === "/agent/reply"){
      var payload = await request.json();
      var who = p === "/send" ? "board" : "claude";
      var ev = await this.append(who, payload);
      await this.fold(payload, who);
      this.push(ev);
      /* the socket reaches a board that is open; this reaches the phone in his
         pocket, which is the whole point of a nudge */
      try{ await this.maybeNotify(payload, who); }catch(e){}
      await this.armArchive();
      var started = null;
      /* only a note of his starts a run; a date moved on its own is not a
         question, and Claude's own reply must never start another */
      if(p === "/send" && (payload.notes||[]).some(function(n){ return n && n.from !== "claude" && !n.answered; }))
        started = await this.startJob();
      return out(200, {ok:true, seq:ev.seq, job:started});
    }

    /* The public key the board needs before it can subscribe at all. */
    if(p === "/push/key") return out(200, {key:(await this.vapid()).pub});

    /* What the service worker reads after a bare push wakes it. It is the same
       note the board already shows in Chat, and /state is already open, so this
       exposes nothing new -- but it is the one place note text leaves the log,
       so it hands back a trimmed line and never the whole thread. */
    if(p === "/push/latest"){
      var l = (await this.ctx.storage.get("latest")) || null;
      return out(200, l || {title:"MBA Command Center", body:"Something new from Claude.", tag:"mbacc", about:null});
    }

    /* "I am not getting any notification at all" has three possible causes --
       nothing was sent, the subscription is gone, or iOS is dropping it -- and
       from his side they are indistinguishable. This sends one, now, and says
       what the push service answered, which separates the first two from the
       third in a single tap. Capped to one a minute: the route takes no secret
       and its address is public. */
    if(p === "/push/test"){
      var lastT = (await this.ctx.storage.get("lastTest")) || 0;
      if(Date.now() - lastT < 60000) return out(429, {error:"one test a minute"});
      await this.ctx.storage.put("lastTest", Date.now());
      var subsT = (await this.ctx.storage.get("subs")) || {};
      if(!Object.keys(subsT).length) return out(200, {ok:false, devices:0, why:"no device is subscribed"});
      await this.ctx.storage.put("latest", {
        title: "Test notification",
        body: "If you can read this, the lock screen works.",
        tag: "mbacc-test", about: null, at: new Date().toISOString()
      });
      await this.notify();
      var lp = (await this.ctx.storage.get("lastPush")) || {};
      return out(200, {ok:true, devices:Object.keys(subsT).length, sent:lp.sent||0, dropped:lp.dropped||0});
    }

    if(p === "/push/sub" || p === "/push/unsub"){
      var sb = await request.json();
      var ep = sb && sb.endpoint;
      if(typeof ep !== "string" || !/^https:\/\//.test(ep)) return out(400, {error:"no endpoint"});
      var subs = (await this.ctx.storage.get("subs")) || {};
      if(p === "/push/unsub") delete subs[ep];
      else {
        if(Object.keys(subs).length >= PUSH_MAX && !subs[ep]) return out(429, {error:"too many devices"});
        subs[ep] = {at:new Date().toISOString()};
      }
      await this.ctx.storage.put("subs", subs);
      return out(200, {ok:true, devices:Object.keys(subs).length});
    }

    if(p === "/agent/pull"){
      var snap = (await this.ctx.storage.get("snap")) || {items:{}, notes:{}};
      return out(200, {
        seq:(await this.ctx.storage.get("seq"))||0,
        notes:Object.keys(snap.notes).map(function(k){ return snap.notes[k]; }),
        changed:Object.keys(snap.items).map(function(k){ return snap.items[k]; })
      });
    }

    return out(404, {error:"no such path"});
  }
}

/* ---------- the Worker in front of it ---------- */

/* One board, one owner, so one Durable Object by a fixed name. Everything
   serialises through it, which is the point: it is the only place the phone's
   socket and the GitHub job can see each other. */
function board(env){ return env.BOARD.get(env.BOARD.idFromName("board")); }

export default {
  async fetch(request, env){
    var u = new URL(request.url), p = u.pathname;
    if(env.ALLOW_ORIGIN) allowOrigin = env.ALLOW_ORIGIN;

    if(request.method === "OPTIONS") return new Response(null, {status:204, headers:cors()});

    /* The job's two endpoints hold a real secret, because one of them can write
       a reply in Claude's name and the other hands back the whole log. */
    if(p === "/agent/pull" || p === "/agent/reply"){
      if(!env.AGENT_KEY || request.headers.get("X-Agent-Key") !== env.AGENT_KEY)
        return out(403, {error:"bad agent key"});

      /* Read the body here instead of handing the stream on, and ask for the
         log with a GET. A request whose body nobody reads makes the runtime
         throw once the response has gone out -- harmless to the caller, and
         exactly the kind of noise that hides a real error later. */
      if(p === "/agent/pull")
        return board(env).fetch(new Request("https://do/agent/pull", {method:"GET"}));

      var araw = await request.text();
      if(araw.length > MAX) return out(413, {error:"payload too large"});
      var reply;
      try{ reply = JSON.parse(araw); }catch(e){ return out(400, {error:"not JSON"}); }
      if(!looksLikeAnExport(reply)) return out(400, {error:"not a board export"});
      return board(env).fetch(new Request("https://do/agent/reply", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify(reply)
      }));
    }

    /* A browser cannot put a header on a WebSocket handshake, so the socket
       takes the key in the query string instead. It is the same public key
       either way -- bots, not people. */
    var key = p === "/ws" ? u.searchParams.get("key") : request.headers.get("X-Relay-Key");
    if(env.RELAY_KEY && key !== env.RELAY_KEY) return out(403, {error:"bad relay key"});

    if(p === "/ws" || p === "/state")
      return board(env).fetch(new Request("https://do"+p+u.search, request));

    /* The push endpoints are the board's, not the job's: they take no secret,
       exactly like /state. A subscription endpoint is already a capability URL
       issued to one device by Apple -- the worst a stranger can do with these
       is subscribe their own phone to his nudges, which PUSH_MAX caps, or read
       the one line Chat is already showing him. They are routed here, before
       the POST-only and looksLikeAnExport gates below, because a subscription
       is not a board export. */
    if(p === "/push/key" || p === "/push/latest")
      return board(env).fetch(new Request("https://do"+p, {method:"GET"}));
    if(p === "/push/test")
      return board(env).fetch(new Request("https://do"+p, {method:"GET"}));
    if(p === "/push/sub" || p === "/push/unsub"){
      if(request.method !== "POST") return out(405, {error:"POST only"});
      var praw = await request.text();
      if(praw.length > 4096) return out(413, {error:"payload too large"});
      return board(env).fetch(new Request("https://do"+p, {
        method:"POST", headers:{"Content-Type":"application/json"}, body:praw
      }));
    }

    if(request.method !== "POST") return out(405, {error:"POST only"});

    var raw = await request.text();
    if(raw.length > MAX) return out(413, {error:"payload too large"});

    var payload;
    try{ payload = JSON.parse(raw); }catch(e){ return out(400, {error:"not JSON"}); }
    if(!looksLikeAnExport(payload)) return out(400, {error:"not a board export"});
    if(!payload.notes.length && !payload.changed.length && payload.op!=="patch")
      return out(400, {error:"nothing to send: no notes and no changes"});

    /* re-serialise what we validated, so nothing unparsed reaches the log */
    var clean = JSON.stringify(payload);

    if(p === "/send"){
      return board(env).fetch(new Request("https://do/send", {
        method:"POST", headers:{"Content-Type":"application/json"}, body:clean
      }));
    }

    /* The original mailman route, kept working on purpose. A board that has not
       been updated yet still posts here and still reaches Claude through the
       repo, so there is no moment where the owner's phone is stranded. */
    if(p === "/" || p === ""){
      var now = new Date();
      var r = await writeInbox(env, stampFrom(payload, now),
                               JSON.stringify(payload, null, 2)+"\n", "Notes from the board");
      if(r.ok) return out(200, {ok:true, path:r.path, commit:r.commit});
      return out(502, {error:"GitHub refused the commit", status:r.status, detail:r.detail});
    }

    return out(404, {error:"no such path"});
  }
};
