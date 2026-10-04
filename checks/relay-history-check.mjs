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
globalThis.fetch = async function(url, init){
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
   h.every(x=>["Status","Due","Priority","Date is","Effort","Deleted"].indexOf(x.f)>=0),
   JSON.stringify(h.map(x=>x.f)));
ok("a first value reads as a change from nothing",
   h[0].f==="Status" && h[0].a==="—" && h[0].b==="In progress", JSON.stringify(h[0]));
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
     return new Set(rows).size===rows.length && rows.length===6;
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
ok("and the unwritten entries are kept for the next run",
   (await b2.ctx.storage.get("hist")).length===1);

console.log("\n"+bad+" failing");
process.exit(bad?1:0);
