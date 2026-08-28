import fs from "fs";

/* Every rewrite below is anchored to a literal from the real app. If the app
   changes shape the anchor stops matching, and a silent no-op would ship a demo
   that quietly diverges from it — so a miss is a build failure instead. */
const must = (src, find, repl) => {
  const out = src.replace(find, repl);
  if (out === src) throw new Error(`build-demo: nothing matched ${find}`);
  return out;
};

const html = fs.readFileSync("app/index.html","utf8");
const app  = fs.readFileSync("app/app.js","utf8");
const style= html.match(/<style>[\s\S]*?<\/style>/)[0];
const bodyHtml = html.match(/<body>([\s\S]*?)<script src="app\.js"><\/script>/)[1];
const T = JSON.parse(fs.readFileSync("taxonomy.json","utf8"));
const cats = T.categories.map(c => ({ name:c.name, segments:c.segments,
  budgets:c.segments.map(s => T.budgets[`${c.name}|${s}`] ?? 0) }));

const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
let seed=20260827; const rnd=()=> (seed=(seed*1103515245+12345)%2147483648)/2147483648;
const pick=a=>a[Math.floor(rnd()*a.length)];
const today=new Date(); const rows=[];
for(let d=1; d<=today.getDate(); d++){
  const dt=new Date(today.getFullYear(),today.getMonth(),d);
  const iso=dt.toLocaleDateString("en-CA");
  if(d===1) rows.push({date:iso,time:"09:00",who:"Joint",amount:3465,
    category:"Home Expenses",segment:"Mortgage/Rent"});
  if(d===3) rows.push({date:iso,time:"10:00",who:"Wassim",amount:2940,
    category:"Investment",segment:"IBKR"});
  for(let i=0;i<Math.floor(rnd()*3);i++){
    const c=pick(cats), j=Math.floor(rnd()*c.segments.length);
    rows.push({date:iso,time:`${String(9+Math.floor(rnd()*13)).padStart(2,"0")}:${String(Math.floor(rnd()*60)).padStart(2,"0")}`,
      who:pick(["Wassim","Jamela","Joint"]),
      amount:Math.round(pick([25,45,90,140,220,380])*(0.6+rnd()*0.9)*100)/100,
      category:c.name, segment:c.segments[j]});
  }
}
rows.forEach((r,i)=>{ r.key="d"+i; r.currency="AED"; r.note="";
  r.month=MON[Number(r.date.slice(5,7))-1]; r.year=Number(r.date.slice(0,4)); });
rows.sort((a,b)=>(a.date+a.time)<(b.date+b.time)?1:-1);

let demoApp = must(app, /\/\* ── api ─[\s\S]*?^async function loadData\(\) \{[\s\S]*?^\}/m,
`/* ── api: replaced for the demo. Nothing leaves this page. ─────────────── */
const DEMO = ${JSON.stringify({ ok:true, currency:"AED", people:["Wassim","Jamela","Joint"],
                                categories:cats, rows })};
async function api(opts){
  await new Promise(r=>setTimeout(r,160));
  if(opts.method!=="POST") return JSON.parse(JSON.stringify(DEMO));
  const b=opts.body, now=new Date();
  return { ok:true, row:{ key:"new"+now.getTime(), date:now.toLocaleDateString("en-CA"),
    time:now.toTimeString().slice(0,5), who:b.who, amount:b.amount, currency:"AED",
    category:b.category, segment:b.segment, note:"",
    month:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][now.getMonth()],
    year:now.getFullYear() } };
}
let lastLoad = 0;
async function loadData(){
  const d=await api({method:"GET"});
  lastLoad = Date.now();
  DATA={categories:d.categories,rows:d.rows,people:d.people,currency:d.currency};
  return DATA;
}`)
/* The real app auto-fills a default URL and token so it can connect itself —
   fine for the app talking to the real sheet, but the demo promises nothing is
   saved, so it must not write those into its own localStorage. Drop the
   defaulting before boot() ever forces cfg to "demo"/"demo" below. */
demoApp = must(demoApp,
  /if\(!cfg\.url \|\| !cfg\.token\)\{ cfg = \{[\s\S]*?\}; store\.set\(cfg\); \}\n/,
  "");
demoApp = must(demoApp, `  if(!cfg.token||!cfg.url){ prefillSetup(); $("#setup").classList.remove("hide"); return; }`,
                        `  cfg={url:"demo",token:"demo"};`);
demoApp = must(demoApp, `  showTab("add"); paintAmount(); paintQueue(); flushQueue();`,
                        `  showTab("track"); paintAmount();`);
/* The demo is one self-contained page with no service worker beside it. */
demoApp = must(demoApp, /if\("serviceWorker" in navigator\)[\s\S]*?\.catch\(\(\)=>\{\}\);/, "");

fs.mkdirSync("demo",{recursive:true});
fs.copyFileSync("app/icon.svg","demo/icon.svg");
/* A standalone page, so it carries the head the app's index.html has: without a
   doctype it renders in quirks mode, without a viewport a phone lays it out at
   980px and shrinks it, and without a charset the em dashes arrive as mojibake. */
fs.writeFileSync("demo/personal-budget-demo.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<meta name="description" content="A read-only demo of the Personal Budget app, with made-up spending.">
<meta name="theme-color" content="#f7f7f5" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e0e0d" media="(prefers-color-scheme: dark)">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<title>Personal Budget — demo</title>
${style}
<style>
.demowrap{flex:0 0 auto;padding:10px 12px 0}
.demobar{max-width:620px;margin:0 auto;padding:11px 14px;border-radius:12px;
  background:color-mix(in srgb,var(--me) 12%,transparent);color:var(--me);
  font:500 13px/1.45 -apple-system,system-ui,sans-serif}
.demobar b{font-weight:650}
nav{justify-content:center;gap:min(30vw,260px)}
</style>
</head>
<body>
<div class="demowrap"><div class="demobar">
  <b>Demo.</b> Your real categories and budgets, with made-up spending for this month.
  Add a transaction and watch the budgets move. Nothing is saved.
</div></div>
${bodyHtml}
<script>
${demoApp}
</script>
</body>
</html>`);
console.log("demo built");
