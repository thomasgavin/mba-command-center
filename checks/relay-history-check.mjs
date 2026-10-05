/* The audit log, driven against a fake GitHub and a fake Durable Object store.
   node checks/relay-history-check.mjs
   The relay is the one part of this repo a browser check cannot reach, and the
   log is the one part of the relay that writes to the repo on its own. */
import { Board } from "../relay/worker.js";

var bad = 0;
function ok(name, pass, detail){
  if(!pass) bad++;
  console.log((pass?"PASS  ":"FAIL  ")+name+(detail?"  "+detail:""));
}

/* a GitHub that remembers files, with real shas and real 422s */
var repo = {}, calls = [];
var ghMock = async function(url, init){
  init = init||{};
  var u = String(url), m = /contents\/(.+?)(\?|$)/.exec(u);
  var path = m ? decodeURIComponent(m[1]) : "";
  calls.push(init.method||"GET");
  if(/dispatches/.test(u)) return new Response("{}", {status:204});
  if((init.method||"GET")==="GET"){
    if(repo[path]!==undefined)
      return new Response(JSON.stringify({content:btoa(unescape(encodeURIComponent(repo[path]))),sha:"sha-"+path}),{status:200});
    // a directory listing
    var kids=Object.keys(repo).filter(k=>k.startsWith(path+"/"));
    if(kids.length) return new Response(JSON.stringify(
      kids.map(k=>({name:k.slice(path.length+1),sha:"sha-"+k,path:k}))),{status:200});
    return new Response("{}", {status:404});
  }
  var body = JSON.parse(init.body||"{}");
  if(init.method==="PUT"){
    if(repo[path]!==undefined && !body.sha) return new Response("exists",{status:422});
    repo[path]=decodeURIComponent(escape(atob(body.content)));
    return new Response(JSON.stringify({commit:{sha:"c1"}}),{status:200});
  }
  if(init.method==="DELETE"){ delete repo[path]; return new Response("{}",{status:200}); }
  return new Response("{}", {status:200});
};
globalThis.fetch = ghMock;

function mkBoard(){
  var store = new Map();
  var ctx = { storage:{
    get: async k=>store.get(k),
    put: async (k,v)=>{ store.set(k,v); },
    delete: async ks=>{ (Array.isArray(ks)?ks:[ks]).forEach(k=>store.delete(k)); },
    list: async o=>{ var m=new Map(); for(var [k,v] of store) if(k.startsWith(o.prefix)) m.set(k,v); return m; },
    setAlarm: async ()=>{}, getAlarm: async ()=>null
  }, acceptWebSocket(){}, };
  return new Board(ctx, {GH_TOKEN:"t"});
}

var DAY = 86400000;
var b = mkBoard();

/* --- a day of edits from both sides --- */
await b.fold({exportedAt:"2026-10-04T09:00:00.000Z", changed:[
  {id:"sbi-sanction", title:"SBI Global Ed-Vantage sanction letter",
   status:"doing", due:"2026-10-24", at:"2026-10-04T09:00:00.000Z"}
]}, "board");
await b.fold({exportedAt:"2026-10-04T11:30:00.000Z", changed:[
  {id:"sbi-sanction", title:"SBI Global Ed-Vantage sanction letter",
   status:"doing", due:"2026-11-20", effort:"wait", at:"2026-10-04T11:30:00.000Z"}
]}, "claude");
await b.fold({exportedAt:"2026-10-04T12:00:00.000Z", changed:[
  {id:"poa|exec", title:"Execute PoA at SBI\nHindon branch",
   deleted:true, at:"2026-10-04T12:00:00.000Z"}
]}, "board");

var h = await b.ctx.storage.get("hist");
ok("only the fields worth auditing are logged",
   h.every(x=>["Title","Status","Due","Priority","Effort","Deleted"].indexOf(x.f)>=0),
   JSON.stringify(h.map(x=>x.f)));
/* The first time the relay sees an item it holds no previous value, so every
   field in that payload reads as a change from nothing. Picked by name rather
   than by position: HIST_FIELDS decides the order within one payload, and a
   check that encodes that order breaks every time a field is added. */
var h0 = h.find(x=>x.f==="Status");
ok("a first value reads as a change from nothing",
   !!h0 && h0.a==="—" && h0.b==="In progress", JSON.stringify(h0||h[0]));
ok("only what moved is recorded, not the whole row",
   h.filter(x=>x.at==="2026-11-20"||false).length===0 &&
   h.filter(x=>x.at.startsWith("2026-10-04T11:30")).map(x=>x.f).sort().join(",")==="Due,Effort",
   JSON.stringify(h.filter(x=>x.at.startsWith("2026-10-04T11:30")).map(x=>x.f)));
ok("who did it is kept", h.some(x=>x.by==="you") && h.some(x=>x.by==="Claude"),
   JSON.stringify(h.map(x=>x.by)));

/* --- written out --- */
var w = await b.writeHistory();
ok("a day is written", w.days===1 && w.lines===h.length, JSON.stringify(w));
var md = repo["history/2026-10-04.md"];
ok("the file is a readable table", /^# 2026-10-04/.test(md) && /\| Time \(UTC\) \| Task \| Change \| By \|/.test(md), (md||"").slice(0,60));
ok("a pipe in a title cannot split the row",
   md.indexOf("poa\\|exec")<0 && md.split("\n").filter(l=>/^\| \d{2}:\d{2}/.test(l)).every(l=>l.split("|").length===6),
   JSON.stringify(md.split("\n").filter(l=>/^\| \d{2}:\d{2}/.test(l))));
ok("a newline in a title cannot end the row", md.indexOf("SBI\nHindon")<0 && md.indexOf("SBI Hindon")>=0);
ok("the pending list is cleared once written",
   (await b.ctx.storage.get("hist")).length===0);

/* --- the alarm firing twice in a day adds, never replaces --- */
await b.fold({exportedAt:"2026-10-04T15:00:00.000Z", changed:[
  {id:"deposit", title:"EUR 12,000 tuition deposit paid", priority:"Low",
   at:"2026-10-04T15:00:00.000Z"}
]}, "board");
await b.writeHistory();
var md2 = repo["history/2026-10-04.md"];
ok("a second write that day keeps the first entries",
   /09:00/.test(md2) && /15:00/.test(md2), JSON.stringify(md2.split("\n").filter(l=>/^\| \d/.test(l))));
ok("and does not duplicate them", (function(){
     var rows=md2.split("\n").filter(l=>/^\| \d{2}:\d{2}/.test(l));
     return new Set(rows).size===rows.length && rows.length===9;
   })(), JSON.stringify(md2.split("\n").filter(l=>/^\| \d{2}:\d{2}/.test(l)).length));
ok("rows stay in time order",
   (function(){ var t=md2.split("\n").filter(l=>/^\| \d{2}:\d{2}/.test(l)).map(l=>l.slice(2,7));
     return JSON.stringify(t)===JSON.stringify(t.slice().sort()); })());

/* --- the window --- */
var old = new Date(Date.now()-40*DAY).toISOString().slice(0,10);
var recent = new Date(Date.now()-5*DAY).toISOString().slice(0,10);
repo["history/"+old+".md"] = "# "+old+"\n";
repo["history/"+recent+".md"] = "# "+recent+"\n";
var gone = await b.pruneHistory();
ok("a day past the window is deleted", gone===1 && repo["history/"+old+".md"]===undefined, String(gone));
ok("a day inside it is kept", repo["history/"+recent+".md"]!==undefined);
ok("and today is kept", repo["history/2026-10-04.md"]!==undefined);

/* --- GitHub being down must not take the chat with it --- */
var b2 = mkBoard();
globalThis.fetch = async ()=>{ throw new Error("github is down"); };
await b2.fold({exportedAt:"2026-10-04T09:00:00.000Z", changed:[
  {id:"x", title:"T", status:"done", at:"2026-10-04T09:00:00.000Z"}]}, "board");
var threw=false;
try{ await b2.writeHistory(); await b2.pruneHistory(); }catch(e){ threw=true; }
ok("a GitHub outage does not throw", !threw);
/* two entries now, not one: a first sighting logs the title as well as the
   status, and a rename is exactly what this log is for */
ok("and the unwritten entries are kept for the next run",
   (await b2.ctx.storage.get("hist")).length===2);

/* --- the mind map has to survive the Worker being deleted ---
   The daily archive is the only copy of the map that lives outside a Durable
   Object. Tasks rebuild from SEED and notes expire at seven days, but what he
   knows exists nowhere else, so an archive that quietly dropped it would be a
   backup that backs up everything except the irreplaceable part. */
globalThis.fetch = ghMock;   /* the outage test above left a throwing fetch behind */
var b3 = mkBoard();
await b3.fold({exportedAt:"2026-10-04T09:00:00.000Z", changed:[], notes:[], kb:[
  {id:"k1", label:"VMock", body:"Scores a CV.", cat:"work", at:"2026-10-04T09:00:00.000Z"}]}, "board");
await b3.fold({exportedAt:"2026-10-04T10:00:00.000Z", changed:[], notes:[], kb:[
  {id:"k1", label:"VMock", body:"Scores a CV and says what to fix.", cat:"work", at:"2026-10-04T10:00:00.000Z"},
  {id:"k2", label:"CDC", cat:"work", at:"2026-10-04T10:00:00.000Z"}]}, "board");
/* an older copy arriving late must not undo the newer one */
await b3.fold({exportedAt:"2026-10-04T10:30:00.000Z", changed:[], notes:[], kb:[
  {id:"k1", label:"VMock", body:"stale", cat:"work", at:"2026-10-04T08:00:00.000Z"}]}, "board");
var snap3 = await b3.ctx.storage.get("snap");
ok("the relay folds the mind map", Object.keys(snap3.kb||{}).length===2, JSON.stringify(Object.keys(snap3.kb||{})));
ok("and newest clock wins, as it does on the board",
   snap3.kb.k1.body==="Scores a CV and says what to fix.", snap3.kb.k1.body);
await b3.alarm();
var arch = Object.keys(repo).filter(function(k){ return /^claude-inbox\/.*\.json$/.test(k); });
var body = arch.length ? JSON.parse(repo[arch[arch.length-1]]) : {};
ok("and the daily archive carries it into the repo",
   (body.kb||[]).length===2, JSON.stringify((body.kb||[]).map(function(n){return n.id;})));

console.log("\n"+bad+" failing");
process.exit(bad?1:0);
