import fs from "fs";
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

const demoApp = app
  .replace(/\/\* ── api ─[\s\S]*?^async function loadData\(\) \{[\s\S]*?^\}/m,
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
  .replace(`  if(!cfg.token||!cfg.url){ $("#setup").classList.remove("hide"); return; }`,
           `  cfg={url:"demo",token:"demo"};`)
  .replace(`  showTab("add"); paintAmount(); paintQueue(); flushQueue();`,
           `  showTab("track"); paintAmount();`)
  .replace(`if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(()=>{});`,"");

fs.mkdirSync("demo",{recursive:true});
fs.writeFileSync("demo/personal-budget-demo.html", `<title>Personal Budget</title>
${style}
<style>
.demowrap{flex:0 0 auto;padding:10px 12px 0}
.demobar{max-width:620px;margin:0 auto;padding:11px 14px;border-radius:12px;
  background:color-mix(in srgb,var(--me) 12%,transparent);color:var(--me);
  font:500 13px/1.45 -apple-system,system-ui,sans-serif}
.demobar b{font-weight:650}
nav{justify-content:center;gap:min(30vw,260px)}
</style>
<div class="demowrap"><div class="demobar">
  <b>Demo.</b> Your real categories and budgets, with made-up spending for this month.
  Add a transaction and watch the budgets move. Nothing is saved.
</div></div>
${bodyHtml}
<script>
${demoApp}
</script>`);
console.log("demo built");
