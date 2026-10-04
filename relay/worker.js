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
var MAX_RUNS   = 20;            /* Claude runs an hour, from every caller together */
var ARCHIVE_MS = 24*3600*1000;  /* one snapshot commit a day, not one per message */
var MAX_BACK   = 400;           /* events a catch-up will hand back at once */

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
function b64(str){
  var bytes = new TextEncoder().encode(str), s = "";
  for(var i=0;i<bytes.length;i+=0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i+0x8000));
  return btoa(s);
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

/* a board export, not arbitrary JSON: both arrays must be present and sane */
function looksLikeAnExport(p){
  if(!p || typeof p!=="object" || Array.isArray(p)) return false;
  if(!Array.isArray(p.notes) || !Array.isArray(p.changed)) return false;
  if(p.notes.length > 200 || p.changed.length > 200) return false;
  if(typeof p.exportedAt !== "string" || p.exportedAt.length > 40) return false;
  return true;
}

async function commit(env, path, body, message){
  return fetch("https://api.github.com/repos/"+REPO+"/contents/"+path, {
    method: "PUT",
    headers: {
      "Authorization": "Bearer "+env.GH_TOKEN,
      "Accept": "application/vnd.github+json",
      "User-Agent": "mba-command-center-relay",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({message:message, content:b64(body), branch:BRANCH})
  });
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
  async fold(payload){
    var snap = (await this.ctx.storage.get("snap")) || {items:{}, notes:{}};
    (payload.changed||[]).forEach(function(c){
      if(!c || !c.id) return;
      var had = snap.items[c.id];
      if(had && (had.at||"") > (c.at||"")) return;
      snap.items[c.id] = c;
    });
    (payload.notes||[]).forEach(function(n){
      if(!n || !n.id) return;
      var had = snap.notes[n.id];
      /* a note is immutable except for being answered, so the richer one wins */
      if(had && had.answered && !n.answered) return;
      snap.notes[n.id] = n;
    });
    await this.ctx.storage.put("snap", snap);
    return snap;
  }

  async prune(){
    var snap = (await this.ctx.storage.get("snap")) || {items:{}, notes:{}};
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
    var snap = (await this.ctx.storage.get("snap")) || {items:{}, notes:{}};
    var notes = Object.keys(snap.notes).map(function(k){ return snap.notes[k]; });
    var items = Object.keys(snap.items).map(function(k){ return snap.items[k]; });
    if(notes.length || items.length){
      var now = new Date();
      var body = JSON.stringify({
        v:3, op:"archive", exportedAt:now.toISOString(),
        why:"daily snapshot from the relay", notes:notes, changed:items
      }, null, 2)+"\n";
      await writeInbox(this.env, utcStamp(now), body, "Relay snapshot");
    }
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
        evs:await this.backlog(s)});
    }

    if(p === "/send" || p === "/agent/reply"){
      var payload = await request.json();
      var ev = await this.append(p === "/send" ? "board" : "claude", payload);
      await this.fold(payload);
      this.push(ev);
      await this.armArchive();
      var started = null;
      /* only a note of his starts a run; a date moved on its own is not a
         question, and Claude's own reply must never start another */
      if(p === "/send" && (payload.notes||[]).some(function(n){ return n && n.from !== "claude" && !n.answered; }))
        started = await this.startJob();
      return out(200, {ok:true, seq:ev.seq, job:started});
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
