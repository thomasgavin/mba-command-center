/* MBA Command Center note relay.
   The board is a static page on GitHub Pages, so it has no way to commit to the
   repo on its own. Storing a GitHub token in the browser was the obvious fix and
   the wrong one: WebKit evicts script-writable storage after about a week
   without a visit, so the owner would have to paste the token in again, on two
   devices, forever. This Worker holds the token instead. Nothing secret reaches
   the devices, so nothing on them can expire.

   The address below ends up in the page source, so treat this endpoint as
   world-writable and keep the blast radius small: it writes ONE shape of file to
   ONE folder on ONE branch, it never takes a path from the caller, and it caps
   the size. Worst case is junk JSON in a folder that is already public.

   Secrets (Worker > Settings > Variables):
     GH_TOKEN   fine-grained PAT, this repo only, Contents: read and write
     RELAY_KEY  optional shared string; the page sends it, so it is public too.
                It turns away drive-by bots, not anyone reading the source.
*/

var REPO   = "thomasgavin/mba-command-center";
var BRANCH = "main";
var INBOX  = "claude-inbox";
var MAX    = 64 * 1024;          /* a note payload is a few KB; this is generous */
var ORIGIN = "https://thomasgavin.github.io";

function cors(extra){
  var h = {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
   fixed-width digit groups, and the folder and extension stay ours. That keeps
   the caller away from the rest of the repo while the names stay comparable.
   No usable stamp (an old page, or a bot) falls back to UTC. */
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

export default {
  async fetch(request, env){
    if(request.method === "OPTIONS") return new Response(null, {status:204, headers:cors()});
    if(request.method !== "POST")    return out(405, {error:"POST only"});

    if(env.RELAY_KEY && request.headers.get("X-Relay-Key") !== env.RELAY_KEY)
      return out(403, {error:"bad relay key"});

    var raw = await request.text();
    if(raw.length > MAX) return out(413, {error:"payload too large"});

    var payload;
    try{ payload = JSON.parse(raw); }catch(e){ return out(400, {error:"not JSON"}); }
    if(!looksLikeAnExport(payload)) return out(400, {error:"not a board export"});

    /* re-serialise what we validated, so nothing unparsed reaches the repo */
    var body = JSON.stringify(payload, null, 2) + "\n";
    var now  = new Date();

    /* two sends inside one minute collide on the filename; GitHub answers 422
       because the file exists and we sent no sha. Take the next free suffix
       rather than overwriting the earlier note. */
    var base = stampFrom(payload, now);
    for(var n=0; n<5; n++){
      var name = base + (n ? "-"+n : "");
      var path = INBOX+"/"+name+".json";
      var r = await commit(env, path, body, "Notes from the board - "+name);
      if(r.ok){
        var j = await r.json();
        return out(200, {ok:true, path:path, commit:(j.commit&&j.commit.sha)||null});
      }
      if(r.status !== 422 && r.status !== 409){
        var t = await r.text();
        return out(502, {error:"GitHub refused the commit", status:r.status, detail:t.slice(0,300)});
      }
    }
    return out(409, {error:"could not find a free filename"});
  }
};
