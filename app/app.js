/* Personal Budget — phone app.
   Talks only to your own Apps Script, which writes straight into your sheet.
   Categories, segments and budgets all come from the sheet, so editing a budget
   in Monthly column D is enough — the app follows without being touched. */

const $ = s => document.querySelector(s);
const el = (t,c,x) => { const n=document.createElement(t); if(c)n.className=c; if(x!=null)n.textContent=x; return n; };

const store = {
  get(){ try{ return JSON.parse(localStorage.getItem("bud.cfg")||"{}"); }catch{ return {}; } },
  set(v){ try{ localStorage.setItem("bud.cfg", JSON.stringify(v)); }catch{} },
  queue(){ try{ return JSON.parse(localStorage.getItem("bud.queue")||"[]"); }catch{ return []; } },
  setQueue(q){ try{ localStorage.setItem("bud.queue", JSON.stringify(q)); }catch{} },
};
let cfg = store.get();
let DATA = { categories: [], rows: [], people: ["Wassim","Jamela","Joint"], currency: "AED" };
let who = cfg.who || "Wassim";

const money  = n => `${DATA.currency} ${Math.round(Number(n)||0).toLocaleString("en-US")}`;
const money2 = n => `${DATA.currency} ${(Number(n)||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const short  = n => Math.abs(n)>=10000 ? `${DATA.currency} ${(n/1000).toFixed(1).replace(/\.0$/,"")}k` : money(n);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const todayISO = () => new Date().toLocaleDateString("en-CA");

/* ── api ─────────────────────────────────────────────────────────────────── */
/* Apps Script rejects a JSON content-type preflight, so POSTs go as text/plain
   and the script parses the body itself. This is the supported pattern, not a
   hack around security. */
async function api(opts) {
  const base = (cfg.url||"").replace(/\/+$/,"");
  const url = opts.method === "POST"
    ? base
    : `${base}?token=${encodeURIComponent(cfg.token)}&months=4`;
  const r = await fetch(url, opts.method === "POST"
    ? { method:"POST", headers:{ "content-type":"text/plain;charset=utf-8" },
        body: JSON.stringify({ token: cfg.token, ...opts.body }), redirect:"follow" }
    : { method:"GET", redirect:"follow" });
  if (!r.ok) throw new Error(`The sheet replied ${r.status}`);
  const j = await r.json().catch(() => { throw new Error("Could not read the reply — check the Apps Script URL ends in /exec"); });
  if (j.ok === false) throw new Error(j.error || "Refused");
  return j;
}
let lastLoad = 0;
async function loadData() {
  const d = await api({ method:"GET" });
  lastLoad = Date.now();
  DATA = { categories: d.categories||[], rows: d.rows||[],
           people: d.people||DATA.people, currency: d.currency||"AED" };
  try { localStorage.setItem("bud.cache", JSON.stringify(DATA)); } catch {}
  return DATA;
}
function loadCache(){
  try { const c = JSON.parse(localStorage.getItem("bud.cache")||"null");
    if (c?.categories?.length) { DATA = c; return true; } } catch {}
  return false;
}

/* ── outbox ──────────────────────────────────────────────────────────────── */
async function send(t){
  try { const r = await api({ method:"POST", body:t }); return { ok:true, row:r.row }; }
  catch(e){
    const key = "local-" + Date.now() + "-" + Math.random().toString(36).slice(2,7);
    const q = store.queue();
    q.push({ ...t, at: t.at || new Date().toISOString(), __key: key });
    store.setQueue(q);
    return { ok:false, error:e.message, localKey:key };
  }
}
async function flushQueue(){
  const q = store.queue(); if(!q.length) return;
  const left=[]; let sent=0;
  for(const t of q){
    const { __key, ...payload } = t;
    try{ await api({ method:"POST", body:payload }); sent++; } catch { left.push(t); }
  }
  store.setQueue(left); paintQueue();
  if(sent){ try{ await loadData(); }catch{} if(!$("#track").classList.contains("hide")) paintTrack(); }
}
function paintQueue(){
  const n = store.queue().length;
  $("#queueBanner").classList.toggle("hide", n===0);
  if(n) $("#queueText").textContent = `${n} waiting to reach the sheet`;
}

/** Remove one entry, by the key the sheet gave it when it was saved. */
async function removeEntry(key){
  if(!key) return { ok:false, error:"That entry has no key yet" };
  // Still sitting in the outbox? Then it never reached the sheet — drop it here.
  const q = store.queue();
  const i = q.findIndex(t => t.__key === key);
  if(i >= 0){ q.splice(i,1); store.setQueue(q); paintQueue();
    DATA.rows = DATA.rows.filter(r => r.key !== key);
    return { ok:true, local:true }; }
  try {
    await api({ method:"POST", body:{ action:"delete", key } });
    DATA.rows = DATA.rows.filter(r => r.key !== key);
    try{ localStorage.setItem("bud.cache", JSON.stringify(DATA)); }catch{}
    return { ok:true };
  } catch(e){ return { ok:false, error:e.message }; }
}

/* ── budget maths ────────────────────────────────────────────────────────── */
function currentMonth(){ const d=new Date(); return { m: MONTHS[d.getMonth()], y: d.getFullYear() }; }
function monthRows(){ const {m,y}=currentMonth();
  return DATA.rows.filter(r => r.month===m && Number(r.year)===y); }
function spentBy(){
  const by = {};
  for (const r of monthRows()) {
    const k = `${r.category}|${r.segment}`;
    by[k] = (by[k]||0) + Number(r.amount||0);
  }
  return by;
}
function elapsed(){
  const d = new Date(), days = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  return { frac: d.getDate()/days, day: d.getDate(), days, left: days-d.getDate() };
}
/** OK below 90% of the pro-rated line, Close approaching it, Over past budget. */
function statusOf(spent, budget){
  if (!budget) return spent>0 ? { k:"nobudget", label:"no budget", col:"var(--muted)" }
                              : { k:"none", label:"", col:"var(--muted)" };
  if (spent > budget)        return { k:"over",  label:"over",     col:"var(--over)" };
  if (spent/budget >= 0.9)   return { k:"close", label:"close",    col:"var(--close)" };
  const e = elapsed().frac;
  if (e>0.1 && (spent/budget)/e >= 1.35) return { k:"close", label:"ahead of pace", col:"var(--close)" };
  return { k:"ok", label:"on track", col:"var(--ok)" };
}

/* ── entry ───────────────────────────────────────────────────────────────── */
let amount="", catIdx=null, segIdx=null, lastSavedKey=null;

/* Which day the money was actually spent. Defaults to today, because that is the
   answer nine times in ten — but a purchase logged the next morning belongs to the
   day it happened, and at a month boundary that is the difference between the
   right budget and the wrong one. Dubai has no daylight saving, so noon at +04:00
   is an unambiguous way to name a date. */
let spentOn = null;                              // null = today
const isoDay = d => d.toLocaleDateString("en-CA");
function spentAtISO(){ return spentOn ? `${spentOn}T12:00:00+04:00` : null; }
function dayLabel(iso){
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short" });
}
function paintWhen(){
  const today = isoDay(new Date());
  $("#datePick").max = today;                    // you cannot spend money tomorrow
  const y = new Date(); y.setDate(y.getDate()-1);
  const yest = isoDay(y);
  const sel = spentOn ?? today;
  document.querySelectorAll("#whenPick button").forEach(b=>{
    const on = (b.dataset.d==="0" && sel===today) ||
               (b.dataset.d==="1" && sel===yest) ||
               (b.dataset.d==="pick" && sel!==today && sel!==yest);
    b.classList.toggle("on", on);
    if(b.dataset.d==="pick") b.textContent = on ? dayLabel(sel) : "Another day";
  });
}
function showStep(id){ ["stepAmount","stepCat","stepSeg","stepSaved"]
  .forEach(s => $("#"+s).classList.toggle("hide", s!==id)); }
function paintAmount(){
  const v=$("#amountView");
  v.innerHTML = `<small>${DATA.currency}</small>${amount||"0"}`;
  v.classList.toggle("zero", !amount);
  $("#toCat").disabled = !(parseFloat(amount)>0);
  $("#amountHint").textContent = parseFloat(amount)>0 ? "" : "How much?";
}
function key(k){
  if(k==="del") amount=amount.slice(0,-1);
  else if(k==="."){ if(!amount.includes(".")) amount=(amount||"0")+"."; }
  else { const [,dec]=amount.split(".");
    if(dec!==undefined && dec.length>=2) return;
    if(amount.replace(".","").length>=9) return;
    amount=(amount==="0"?"":amount)+k; }
  paintAmount();
}
function paintWho(){
  const w=$("#whoPick"); w.innerHTML="";
  DATA.people.forEach(p=>{
    const b=el("button",p===who?"on":null,p);
    b.onclick=()=>{ who=p; cfg={...cfg,who}; store.set(cfg); paintWho(); };
    w.appendChild(b);
  });
}
function paintCats(){
  $("#cAmt1").textContent = money2(parseFloat(amount));
  const spent = spentBy(), g=$("#catGrid"); g.innerHTML="";
  DATA.categories.forEach((c,i)=>{
    const bud = c.budgets.reduce((a,b)=>a+b,0);
    const sp  = c.segments.reduce((a,s,j)=>a+(spent[`${c.name}|${s}`]||0),0);
    const st  = statusOf(sp,bud);
    const b=el("button", st.k==="over"?"over":st.k==="close"?"close":null);
    b.append(el("span",null,c.name),
             el("i",null, bud ? `${Math.round(sp)} of ${Math.round(bud)}` : "no budget"));
    b.onclick=()=>{ catIdx=i; paintSegs(); showStep("stepSeg"); };
    g.appendChild(b);
  });
}
function paintSegs(){
  const c=DATA.categories[catIdx], spent=spentBy();
  $("#cAmt2").textContent = money2(parseFloat(amount));
  $("#cCat").textContent = c.name;
  const g=$("#segGrid"); g.innerHTML="";
  c.segments.forEach((s,i)=>{
    const bud=c.budgets[i]||0, sp=spent[`${c.name}|${s}`]||0, st=statusOf(sp,bud);
    const b=el("button", st.k==="over"?"over":st.k==="close"?"close":null);
    b.append(el("span",null,s),
             el("i",null, bud ? `${Math.round(sp)} of ${Math.round(bud)}` : "no budget"));
    b.onclick=()=>{ segIdx=i; save(); };
    g.appendChild(b);
  });
}
async function save(){
  const amt=parseFloat(amount), c=DATA.categories[catIdx], seg=c.segments[segIdx];
  const bud=c.budgets[segIdx]||0;
  $("#savedAmt").textContent = money2(amt);
  $("#savedCat").textContent = `${c.name} › ${seg} · ${who}`
    + (spentOn ? ` · ${dayLabel(spentOn)}` : "");
  $("#savedBudget").textContent = "";
  showStep("stepSaved");

  const at = spentAtISO();
  const res = await send({ amount:amt, who, category:c.name, segment:seg, ...(at?{at}:{}) });
  lastSavedKey = res.ok ? res.row.key : (res.localKey || null);
  $("#undoLast").classList.toggle("hide", !lastSavedKey);
  if(res.ok){
    DATA.rows.unshift({ ...res.row });
    try{ localStorage.setItem("bud.cache", JSON.stringify(DATA)); }catch{}
    if(bud){
      const sp = spentBy()[`${c.name}|${seg}`]||0;
      const st = statusOf(sp,bud);
      $("#savedBudget").textContent =
        `${seg}: ${money(sp)} of ${money(bud)} this month · ${money(Math.max(bud-sp,0))} left`;
      $("#savedBudget").style.color = st.col;
    }
  } else {
    $("#savedBudget").textContent = "Saved on this phone — it will reach the sheet when you're back online.";
    paintQueue();
  }
  amount=""; catIdx=null; segIdx=null; spentOn=null; paintAmount(); paintWhen();
}

/* ── budget view ─────────────────────────────────────────────────────────── */
function meter(name, spent, budget, subs){
  const st = statusOf(spent,budget), e = elapsed();
  const box = el("div","meter");
  const top = el("div","top");
  top.append(el("div","nm",name),
             el("div","amt", budget ? `${money(spent)} / ${money(budget)}` : money(spent)));
  box.appendChild(top);

  const bar=el("div","bar");
  const fill=el("div","fill");
  fill.style.width=(budget?Math.min(100,spent/budget*100):0)+"%";
  fill.style.background=st.col; bar.appendChild(fill);
  if(budget){ const mk=el("div","mark"); mk.style.left=Math.min(100,e.frac*100)+"%";
    mk.title=`On-budget line for day ${e.day} of ${e.days}`; bar.appendChild(mk); }
  box.appendChild(bar);

  const note=el("div","note");
  if(st.label){ const p=el("span","pill",st.label); p.style.color=st.col; p.style.borderColor=st.col; note.appendChild(p); }
  if(budget){
    const leftAmt = budget-spent;
    note.appendChild(el("span",null, leftAmt>=0
      ? `${money(leftAmt)} left · ${money(leftAmt/Math.max(e.left,1))}/day for ${e.left} days`
      : `${money(-leftAmt)} over`));
  }
  box.appendChild(note);

  if(subs?.length){
    const wrap=el("div","subs");
    subs.filter(s=>s.spent>0||s.budget>0).sort((a,b)=>b.spent-a.spent).forEach(s=>{
      const ss=statusOf(s.spent,s.budget);
      const row=el("div","sub");
      row.appendChild(el("span",null,s.name));
      const mini=el("div","mini");
      const bar2=el("i"); bar2.style.width=(s.budget?Math.min(100,s.spent/s.budget*100):0)+"%";
      bar2.style.background=ss.col; mini.appendChild(bar2);
      row.appendChild(mini);
      row.appendChild(el("b",null, s.budget?`${Math.round(s.spent)}/${Math.round(s.budget)}`:`${Math.round(s.spent)}`));
      wrap.appendChild(row);
    });
    if(wrap.children.length) box.appendChild(wrap);
  }
  return box;
}

function paintTrack(){
  const spent=spentBy(), e=elapsed(), {m,y}=currentMonth();
  $("#monthLabel").textContent = `${m} ${y}`;

  let totalBudget=0, totalSpent=0;
  const cats = DATA.categories.map(c=>{
    const subs = c.segments.map((s,i)=>({ name:s, budget:c.budgets[i]||0, spent:spent[`${c.name}|${s}`]||0 }));
    const b = subs.reduce((a,s)=>a+s.budget,0), sp = subs.reduce((a,s)=>a+s.spent,0);
    totalBudget+=b; totalSpent+=sp;
    return { name:c.name, budget:b, spent:sp, subs };
  });

  $("#total").innerHTML = short(totalSpent) + (totalBudget?` <small>of ${short(totalBudget)}</small>`:"");
  const line = totalBudget*e.frac, diff = totalSpent-line;
  $("#totalSub").textContent = !totalBudget ? "Set budgets in the Monthly tab."
    : Math.abs(diff)<1 ? "Exactly on the line for today"
    : diff>0 ? `${money(diff)} above the line for day ${e.day}`
             : `${money(-diff)} under the line — good`;
  $("#heroFill").style.width = totalBudget?Math.min(100,totalSpent/totalBudget*100)+"%":"0";
  $("#heroFill").style.background = statusOf(totalSpent,totalBudget).col;
  $("#heroMark").style.left = Math.min(100,e.frac*100)+"%";
  $("#heroNote").textContent = totalBudget
    ? `Day ${e.day} of ${e.days} — the mark is where an even spender would be.` : "";
  $("#tLeft").textContent = totalBudget?short(Math.max(totalBudget-totalSpent,0)):"—";
  $("#tSafe").textContent = totalBudget?short(Math.max(totalBudget-totalSpent,0)/Math.max(e.left,1)):"—";
  $("#tToday").textContent = short(DATA.rows.filter(r=>r.date===todayISO()).reduce((a,r)=>a+Number(r.amount||0),0));

  const rank={over:0,close:1,ok:2,nobudget:3,none:4};
  const mm=$("#meters"); mm.innerHTML="";
  cats.sort((a,b)=>rank[statusOf(a.spent,a.budget).k]-rank[statusOf(b.spent,b.budget).k] || b.spent-a.spent)
      .forEach(c=>mm.appendChild(meter(c.name,c.spent,c.budget,c.subs)));

  const rc=$("#recent"); rc.innerHTML="";
  const rows=monthRows();
  if(!rows.length) rc.appendChild(el("p","muted","Nothing logged this month yet."));
  rows.slice(0,25).forEach(r=>{
    const row=el("div","item");
    const d=el("div","dot");
    d.style.background = r.who==="Wassim"?"var(--me)":r.who==="Jamela"?"var(--them)":"var(--muted)";
    const mdiv=el("div","m");
    mdiv.append(el("b",null,`${r.category} › ${r.segment}`),
                el("span",null,`${r.date.slice(5)} · ${r.time||""} · ${r.who}`));
    const amt=el("div","a",money2(r.amount));
    row.append(d,mdiv,amt);

    // Two taps to delete: one to arm, one to confirm. No dialog, and no way to
    // lose an entry by brushing the screen.
    row.onclick = () => {
      if(row.classList.contains("armed")) return;
      document.querySelectorAll(".item.armed").forEach(x=>paintTrack());
      row.classList.add("armed");
      amt.remove();
      const del=el("button","del","Delete");
      const cancel=el("button","cancel","Keep");
      del.onclick = async (ev) => {
        ev.stopPropagation();
        del.textContent="…"; del.disabled=true;
        const res = await removeEntry(r.key);
        if(res.ok) paintTrack();
        else { del.disabled=false; del.textContent="Delete";
               mdiv.querySelector("span").textContent = res.error; }
      };
      cancel.onclick = (ev) => { ev.stopPropagation(); paintTrack(); };
      row.append(cancel, del);
    };
    rc.appendChild(row);
  });
}

/* ── wiring ──────────────────────────────────────────────────────────────── */
function showTab(n){
  ["add","track"].forEach(t=>$("#"+t).classList.toggle("hide", t!==n));
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("on", b.dataset.tab===n));
  if(n==="track"){ paintTrack(); refreshIfStale(); }
  if(n==="add"){ showStep("stepAmount"); paintWho(); paintWhen(); }
  $(".wrap").scrollTop=0;
}
document.querySelectorAll(".pad button").forEach(b=>b.onclick=()=>key(b.dataset.k));
document.querySelectorAll("#whenPick button").forEach(b=>b.onclick=()=>{
  if(b.dataset.d==="pick"){
    const inp=$("#datePick");
    inp.value = spentOn ?? isoDay(new Date());
    inp.hidden = false; inp.showPicker ? inp.showPicker() : inp.click();
    return;
  }
  const d=new Date(); d.setDate(d.getDate()-Number(b.dataset.d));
  spentOn = Number(b.dataset.d)===0 ? null : isoDay(d);
  paintWhen();
});
$("#datePick").onchange = e => {
  const v=e.target.value; e.target.hidden=true;
  if(!v) return;
  spentOn = (v === isoDay(new Date())) ? null : v;
  paintWhen();
};
$("#toCat").onclick      = ()=>{ paintCats(); showStep("stepCat"); };
$("#backAmount").onclick = ()=> showStep("stepAmount");
$("#backCat").onclick    = ()=>{ paintCats(); showStep("stepCat"); };
$("#addAnother").onclick = ()=>{ paintWho(); showStep("stepAmount"); };
$("#seeTrack").onclick   = ()=> showTab("track");
$("#undoLast").onclick   = async ()=>{
  const b=$("#undoLast");
  b.textContent="Removing…"; b.disabled=true;
  const res = await removeEntry(lastSavedKey);
  if(res.ok){
    lastSavedKey=null;
    $("#savedAmt").textContent="Removed";
    $("#savedCat").textContent="That entry is gone from the sheet.";
    $("#savedBudget").textContent="";
    b.classList.add("hide");
  } else {
    $("#savedBudget").textContent = res.error;
  }
  b.textContent="Undo — remove that entry"; b.disabled=false;
};
$("#retryQueue").onclick = ()=> flushQueue();
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$("#refresh").onclick = async ()=>{
  $("#refresh").textContent="…";
  try{ await loadData(); paintTrack(); }catch(e){ $("#totalSub").textContent=e.message; }
  $("#refresh").textContent="Refresh";
};
$("#connect").onclick = async ()=>{
  let url=$("#urlIn").value.trim(), token=$("#tokIn").value.trim();
  try { const u=new URL(url);
    if(u.searchParams.get("t")){ token=u.searchParams.get("t"); }
    if(u.searchParams.get("url")){ url=u.searchParams.get("url"); }
    else { u.search=""; url=u.toString(); } } catch {}
  if(!url||!token){ $("#setupMsg").textContent="Both the URL and the code are needed."; return; }
  cfg={...cfg,url,token}; $("#setupMsg").textContent="Checking…";
  try{ store.set(cfg); await loadData(); boot(); }
  catch(e){ $("#setupMsg").textContent=e.message; }
};

async function boot(){
  const u=new URL(location.href);
  const t=u.searchParams.get("t"), a=u.searchParams.get("url");
  if(t){ cfg={...cfg,token:t,...(a?{url:a}:{})}; store.set(cfg);
         history.replaceState({},"",location.pathname); }
  if(!cfg.token||!cfg.url){ $("#setup").classList.remove("hide"); return; }
  $("#setup").classList.add("hide"); $("#tabs").classList.remove("hide");
  const cached=loadCache();
  if(cached){ showTab("add"); paintAmount(); paintQueue(); }
  try{ await loadData(); }
  catch(e){ if(!cached){ $("#setup").classList.remove("hide");
    $("#setupMsg").textContent=e.message; return; } }
  showTab("add"); paintAmount(); paintQueue(); flushQueue();
}
/* ── keeping two devices in step ──────────────────────────────────────────
   There is one copy of the data — the sheet. Everything here is a view of it,
   so a view that sits open goes stale. Rather than poll (which would hammer the
   Apps Script quota for nothing), refetch when you come back to the app: on
   focus, on unlocking the phone, and when you open the Budget tab. That covers
   the real case — logging on the phone, then looking at the laptop. */
/* Coming back to the app is a deliberate act, so refetch then — the throttle is
   only there to absorb a window flapping between focus and blur, not to make you
   wait. Anything longer and "I just logged that on my phone, where is it?" fails. */
const THROTTLE_MS = 3000;
let inFlight = false;

async function refreshIfStale(force) {
  if (!cfg.token || !cfg.url || inFlight) return;
  if (!force && Date.now() - lastLoad < THROTTLE_MS) return;
  inFlight = true;
  try {
    await loadData();
    if (!$("#track").classList.contains("hide")) paintTrack();
    if (!$("#stepCat").classList.contains("hide")) paintCats();
    if (!$("#stepSeg").classList.contains("hide") && catIdx !== null) paintSegs();
  } catch { /* offline or asleep — the cached view stays up, nothing breaks */ }
  finally { inFlight = false; }
}

addEventListener("visibilitychange", () => { if (!document.hidden) refreshIfStale(); });
addEventListener("focus", () => refreshIfStale());
addEventListener("online", async () => { await flushQueue(); refreshIfStale(true); });
boot();
/* Relative paths throughout, so the app works both at a domain root and under a
   GitHub Pages project path like /monthly_budget/. */
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js",{scope:"./"}).catch(()=>{});
