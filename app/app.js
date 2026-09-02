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
/* This is a personal, single-sheet project — always the same Apps Script, so the
   app connects itself on open instead of asking. A device that already saved a
   different config (testing against another sheet, say) keeps using that; this
   only fills in what is otherwise empty. */
const DEFAULT_URL   = "https://script.google.com/macros/s/AKfycbzDMT4kwJvcZHd2Cov-QYqj330PLEuiBQndoOvrvgUy20n-QJtpQQnPpJbzlWO5n0CdSw/exec";
const DEFAULT_TOKEN = "REPLACE_WITH_A_LONG_RANDOM_STRING";

let cfg = store.get();
if(!cfg.url || !cfg.token){ cfg = { ...cfg, url: cfg.url||DEFAULT_URL, token: cfg.token||DEFAULT_TOKEN }; store.set(cfg); }
let DATA = { categories: [], rows: [], people: ["Wassim","Jamela"], currency: "AED" };
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
/* Every function here takes an optional {m,y} — omit it and you get the real
   current month, exactly as before, which is what the entry flow's category
   and segment buttons always want (their "0 of 1200" status is always about
   this month, whatever date you're backdating an entry to). The Budget tab is
   the one place that browses other months, via viewingMonth() below. */
function currentMonth(){ const d=new Date(); return { m: MONTHS[d.getMonth()], y: d.getFullYear() }; }
function monthRows(my){ const {m,y}=my||currentMonth();
  return DATA.rows.filter(r => r.month===m && Number(r.year)===y); }
function spentBy(my){
  const by = {};
  for (const r of monthRows(my)) {
    const k = `${r.category}|${r.segment}`;
    by[k] = (by[k]||0) + Number(r.amount||0);
  }
  return by;
}
/* live: my is (or defaults to) the real current month, so "day X of Y" and a
   safe-to-spend pace are meaningful. Otherwise there is no "today" inside the
   month being browsed — a past month reads as fully elapsed, a future one as
   not yet started, and neither gets a pace judgement. */
function elapsed(my){
  const c = currentMonth(), target = my || c;
  const days = new Date(target.y, MONTHS.indexOf(target.m)+1, 0).getDate();
  if (target.m===c.m && target.y===c.y) {
    const d = new Date();
    return { frac: d.getDate()/days, day: d.getDate(), days, left: days-d.getDate(), live:true, past:false };
  }
  const idx = MONTHS.indexOf(target.m)+target.y*12, cidx = MONTHS.indexOf(c.m)+c.y*12;
  const past = idx < cidx;
  return past ? { frac:1, day:days, days, left:0, live:false, past:true }
              : { frac:0, day:0, days, left:days, live:false, past:false };
}

/* Which month the Budget tab is showing — null means "the real current
   month," so a fresh visit is always live unless something explicitly sent
   you to another month (the date-picker link, or ‹ / › on the tab itself). */
let viewedMonth = null;
function viewingMonth(){ return viewedMonth || currentMonth(); }
function sameMonth(a,b){ return a.m===b.m && a.y===b.y; }
/** OK below 90% of the pro-rated line, Close approaching it, Over past budget. */
function statusOf(spent, budget, my){
  if (!budget) return spent>0 ? { k:"nobudget", label:"no budget", col:"var(--muted)" }
                              : { k:"none", label:"", col:"var(--muted)" };
  if (spent > budget)        return { k:"over",  label:"over",     col:"var(--over)" };
  if (spent/budget >= 0.9)   return { k:"close", label:"close",    col:"var(--close)" };
  const e = elapsed(my);
  if (e.live && e.frac>0.1 && (spent/budget)/e.frac >= 1.35) return { k:"close", label:"ahead of pace", col:"var(--close)" };
  return { k:"ok", label:"on track", col:"var(--ok)" };
}

/* ── entry ───────────────────────────────────────────────────────────────── */
let amount="", catIdx=null, segIdx=null, lastSavedKeys=[];
let splitMonths=1;                               // 1 = log it as one transaction, as before
const undoLabel = n => n>1 ? `Undo — remove all ${n} entries` : "Undo — remove that entry";

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
/* For a rent-style split: same day next month, clamped when that month is
   shorter (Jan 31 → Feb 28, not the overflow you'd get from naive date math). */
function addMonthsClamped(iso, n){
  const d = new Date(iso + "T12:00:00");
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth()+n, 1);
  t.setDate(Math.min(day, new Date(t.getFullYear(), t.getMonth()+1, 0).getDate()));
  return isoDay(t);
}
/* Splits amt into n parts that round to 2dp and still sum to exactly amt — the
   remainder from rounding lands on the last part rather than drifting away. */
function splitAmount(amt, n){
  const part = Math.round(amt/n*100)/100;
  const parts = Array(n-1).fill(part);
  parts.push(Math.round((amt - part*(n-1))*100)/100);
  return parts;
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

  // Backdating (or splitting into a future month) is exactly when you'd want
  // to see how that other month looks, not this one — so once the picked date
  // actually falls outside today's month, offer a straight line to it.
  const link = $("#seeMonthBudget"), c = currentMonth();
  const d = new Date(sel+"T12:00:00"), my = { m:MONTHS[d.getMonth()], y:d.getFullYear() };
  if (spentOn && !sameMonth(my,c)) {
    link.textContent = `See ${my.m} ${my.y} budget →`;
    link.classList.remove("hide");
    link.onclick = ev => { ev.preventDefault(); viewedMonth = my; showTab("track"); };
  } else {
    link.classList.add("hide");
  }
}
function showStep(id){ ["stepAmount","stepCat","stepSeg","stepSaved"]
  .forEach(s => $("#"+s).classList.toggle("hide", s!==id)); }
function paintAmount(){
  const v=$("#amountView");
  v.innerHTML = `<small>${DATA.currency}</small>${amount||"0"}`;
  v.classList.toggle("zero", !amount);
  const amt = parseFloat(amount);
  $("#toCat").disabled = !(amt>0);
  $("#splitHint").textContent = (amt>0 && splitMonths>1)
    ? `${money2(amt/splitMonths)}/mo × ${splitMonths} months` : "";
}
function paintMonths(){
  document.querySelectorAll("#monthsPick button").forEach(b=>
    b.classList.toggle("on", Number(b.dataset.n)===splitMonths));
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
let saving=false;
/* A fast double-tap on the segment button — easy to do on a touchscreen, and
   nothing here disabled it — used to fire save() twice and log the same
   transaction twice. This flag makes the second tap a no-op instead. */
async function save(){
  if(saving) return; saving=true;
  try{ await doSave(); } finally{ saving=false; }
}
async function doSave(){
  const amt=parseFloat(amount), c=DATA.categories[catIdx], seg=c.segments[segIdx];
  const bud=c.budgets[segIdx]||0;
  const n=splitMonths, parts=splitAmount(amt,n);
  const baseIso = spentOn ?? isoDay(new Date());  // the month everything else is chained from

  $("#savedAmt").textContent = n>1 ? `${money2(amt)} · split ${n}×` : money2(amt);
  $("#savedCat").textContent = `${c.name} › ${seg} · ${who}`
    + (spentOn ? ` · ${dayLabel(spentOn)}` : "")
    + (n>1 ? ` · ${money2(parts[0])}/mo` : "");
  $("#savedBudget").textContent = "";
  showStep("stepSaved");

  // Entry 0 keeps today/yesterday/pick exactly as a single save always has — the
  // server's own clock still wins when nothing was backdated. Every later month
  // is unambiguously in the future, so it has to carry an explicit date.
  const keys=[]; let failed=false, lastErr="";
  for(let i=0;i<n;i++){
    const iso = i===0 ? baseIso : addMonthsClamped(baseIso,i);
    const at  = i===0 ? spentAtISO() : `${iso}T12:00:00+04:00`;
    const res = await send({ amount:parts[i], who, category:c.name, segment:seg, ...(at?{at}:{}) });
    if(res.ok){ DATA.rows.unshift({ ...res.row }); keys.push(res.row.key); }
    else { failed=true; lastErr=res.error; if(res.localKey) keys.push(res.localKey); }
  }
  try{ localStorage.setItem("bud.cache", JSON.stringify(DATA)); }catch{}
  lastSavedKeys = keys;
  $("#undoLast").classList.toggle("hide", !keys.length);
  $("#undoLast").textContent = undoLabel(keys.length);

  if(!failed){
    const sp = spentBy()[`${c.name}|${seg}`]||0;
    if(bud){
      const st = statusOf(sp,bud);
      $("#savedBudget").textContent =
        `${seg}: ${money(sp)} of ${money(bud)} this month · ${money(Math.max(bud-sp,0))} left`;
      $("#savedBudget").style.color = st.col;
    }
  } else {
    $("#savedBudget").textContent = n>1
      ? `Some months saved on this phone — they'll reach the sheet when you're back online. (${lastErr})`
      : "Saved on this phone — it will reach the sheet when you're back online.";
    paintQueue();
  }
  amount=""; catIdx=null; segIdx=null; spentOn=null; splitMonths=1;
  paintAmount(); paintWhen(); paintMonths();
}

/* ── budget view ─────────────────────────────────────────────────────────── */
function meter(name, spent, budget, subs, my){
  const st = statusOf(spent,budget,my), e = elapsed(my);
  const box = el("div","meter");
  const top = el("div","top");
  top.append(el("div","nm",name),
             el("div","amt", budget ? `${money(spent)} / ${money(budget)}` : money(spent)));
  box.appendChild(top);

  const bar=el("div","bar");
  const fill=el("div","fill");
  fill.style.width=(budget?Math.min(100,spent/budget*100):0)+"%";
  fill.style.background=st.col; bar.appendChild(fill);
  if(budget && e.live){ const mk=el("div","mark"); mk.style.left=Math.min(100,e.frac*100)+"%";
    mk.title=`On-budget line for day ${e.day} of ${e.days}`; bar.appendChild(mk); }
  box.appendChild(bar);

  const note=el("div","note");
  if(st.label){ const p=el("span","pill",st.label); p.style.color=st.col; p.style.borderColor=st.col; note.appendChild(p); }
  if(budget){
    const leftAmt = budget-spent;
    const perDay = e.live ? ` · ${money(leftAmt/Math.max(e.left,1))}/day for ${e.left} days` : "";
    note.appendChild(el("span",null, leftAmt>=0
      ? `${money(leftAmt)} left${perDay}`
      : `${money(-leftAmt)} over`));
  }
  box.appendChild(note);

  if(subs?.length){
    const wrap=el("div","subs");
    subs.filter(s=>s.spent>0||s.budget>0).sort((a,b)=>b.spent-a.spent).forEach(s=>{
      const ss=statusOf(s.spent,s.budget,my);
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
  const my = viewingMonth(), spent=spentBy(my), e=elapsed(my);
  $("#monthLabel").textContent = `${my.m} ${my.y}`;
  $("#backToToday").classList.toggle("hide", e.live);

  let totalBudget=0, totalSpent=0;
  const cats = DATA.categories.map(c=>{
    const subs = c.segments.map((s,i)=>({ name:s, budget:c.budgets[i]||0, spent:spent[`${c.name}|${s}`]||0 }));
    const b = subs.reduce((a,s)=>a+s.budget,0), sp = subs.reduce((a,s)=>a+s.spent,0);
    totalBudget+=b; totalSpent+=sp;
    return { name:c.name, budget:b, spent:sp, subs };
  });

  $("#total").innerHTML = short(totalSpent) + (totalBudget?` <small>of ${short(totalBudget)}</small>`:"");
  if(e.live){
    const line = totalBudget*e.frac, diff = totalSpent-line;
    $("#totalSub").textContent = !totalBudget ? "Set budgets in the Monthly tab."
      : Math.abs(diff)<1 ? "Exactly on the line for today"
      : diff>0 ? `${money(diff)} above the line for day ${e.day}`
               : `${money(-diff)} under the line — good`;
  } else {
    $("#totalSub").textContent = !totalBudget ? "Set budgets in the Monthly tab."
      : e.past ? `${money(totalSpent)} spent that month`
               : `${money(totalBudget)} budgeted for that month`;
  }
  $("#heroFill").style.width = totalBudget?Math.min(100,totalSpent/totalBudget*100)+"%":"0";
  $("#heroFill").style.background = statusOf(totalSpent,totalBudget,my).col;
  $("#heroMark").classList.toggle("hide", !e.live);
  if(e.live) $("#heroMark").style.left = Math.min(100,e.frac*100)+"%";
  $("#heroNote").textContent = !totalBudget ? ""
    : e.live ? `Day ${e.day} of ${e.days} — the mark is where an even spender would be.`
    : e.past ? "That month is over." : "That month hasn't started yet.";

  $("#tLeft").textContent = totalBudget?short(Math.max(totalBudget-totalSpent,0)):"—";
  $("#tSafeLabel").textContent = e.live || !e.past ? "Safe / day" : "Avg / day";
  $("#tSafe").textContent = e.past ? short(totalSpent/Math.max(e.days,1))
    : totalBudget ? short(Math.max(totalBudget-totalSpent,0)/Math.max(e.left,1)) : "—";
  $("#tTodayLabel").textContent = e.live ? "Today" : "Entries";
  $("#tToday").textContent = e.live
    ? short(DATA.rows.filter(r=>r.date===todayISO()).reduce((a,r)=>a+Number(r.amount||0),0))
    : String(monthRows(my).length);

  const rank={over:0,close:1,ok:2,nobudget:3,none:4};
  const mm=$("#meters"); mm.innerHTML="";
  cats.sort((a,b)=>rank[statusOf(a.spent,a.budget,my).k]-rank[statusOf(b.spent,b.budget,my).k] || b.spent-a.spent)
      .forEach(c=>mm.appendChild(meter(c.name,c.spent,c.budget,c.subs,my)));

  const rc=$("#recent"); rc.innerHTML="";
  const rows=monthRows(my);
  if(!rows.length) rc.appendChild(el("p","muted", e.live ? "Nothing logged this month yet."
    : "Nothing logged that month."));
  /* Only one row can be armed at a time. Swapping to a different row used to
     call paintTrack() to unarm the old one, which rebuilds #recent from scratch —
     but that also detached the row the tap just landed on, so nothing visibly
     armed until a second, separate tap. Unarming in place, with no rebuild,
     keeps the row the finger is actually on in sync with what is on screen. */
  let unarmPrev = null;
  rows.slice(0,25).forEach(r=>{
    const row=el("div","item");
    const d=el("div","dot");
    d.style.background = r.who==="Wassim"?"var(--me)":r.who==="Jamela"?"var(--them)":"var(--muted)";
    const mdiv=el("div","m");
    mdiv.append(el("b",null,`${r.category} › ${r.segment}`),
                el("span",null,`${r.date.slice(5)} · ${r.time||""} · ${r.who}`));
    const amt=el("div","a",money2(r.amount));
    row.append(d,mdiv,amt);
    const unarm = () => {
      row.classList.remove("armed");
      amt.classList.remove("hide");
      row.querySelectorAll(".del,.cancel").forEach(b=>b.remove());
    };

    // Two taps to delete: one to arm, one to confirm. No dialog, and no way to
    // lose an entry by brushing the screen.
    row.onclick = () => {
      if(row.classList.contains("armed")) return;
      if(unarmPrev) unarmPrev();
      unarmPrev = unarm;
      row.classList.add("armed");
      amt.classList.add("hide");
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
      cancel.onclick = (ev) => { ev.stopPropagation(); unarm(); unarmPrev=null; };
      row.append(cancel, del);
    };
    rc.appendChild(row);
  });
}

/* ── wiring ──────────────────────────────────────────────────────────────── */
/* iOS in particular will silently reload a backgrounded home-screen app — lock
   the phone on the Budget tab, come back, and without this the page boots
   fresh and always lands back on Add. That "did my save even go through?"
   moment is exactly what leads to logging the same thing twice, so the tab you
   were actually on survives a reload the same way the sheet URL does. */
function lastTab(){
  const t = (()=>{ try{ return localStorage.getItem("bud.tab"); }catch{ return null; } })();
  return t==="track" ? "track" : "add";
}
function showTab(n){
  try{ localStorage.setItem("bud.tab", n); }catch{}
  /* Leaving a half-typed amount sitting there is exactly what causes
     duplicates: check the Budget tab mid-entry, come back, find the same
     number still showing, and — with no way to tell "still typing" from
     "already saved" apart — log it again for real. Checking Budget always
     abandons whatever wasn't finished yet, so Add is never ambiguous: it's
     either a fresh 0, or nothing was lost because it was already saved. */
  if(n==="track"){ amount=""; catIdx=null; segIdx=null; spentOn=null; splitMonths=1; }
  /* A month you jumped to from a backdated entry is a one-trip thing — the
     next time you open Budget on its own, it should be this month again. */
  if(n==="add"){ viewedMonth=null; }
  ["add","track"].forEach(t=>$("#"+t).classList.toggle("hide", t!==n));
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("on", b.dataset.tab===n));
  if(n==="track"){ paintTrack(); refreshIfStale(); }
  if(n==="add"){ showStep("stepAmount"); paintWho(); paintWhen(); paintMonths(); paintAmount(); }
  $(".wrap").scrollTop=0;
}
function shiftMonth(delta){
  const v = viewingMonth();
  const idx = MONTHS.indexOf(v.m) + delta, y = v.y + Math.floor(idx/12);
  viewedMonth = { m: MONTHS[((idx%12)+12)%12], y };
  paintTrack();
}
$("#prevMonth").onclick   = ()=> shiftMonth(-1);
$("#nextMonth").onclick   = ()=> shiftMonth(1);
$("#backToToday").onclick = ev => { ev.preventDefault(); viewedMonth=null; paintTrack(); };
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
document.querySelectorAll("#monthsPick button").forEach(b=>b.onclick=()=>{
  splitMonths = Number(b.dataset.n);
  paintMonths(); paintAmount();
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
/* A split save can leave several rows behind at once (one per month), so Undo
   removes every key from that save, not just one — a half-undone split would
   otherwise leave silent months behind with no way back to this screen. */
$("#undoLast").onclick   = async ()=>{
  const b=$("#undoLast");
  b.textContent="Removing…"; b.disabled=true;
  const remaining=[]; let lastErr="";
  for(const k of lastSavedKeys){
    const res = await removeEntry(k);
    if(!res.ok){ remaining.push(k); lastErr=res.error; }
  }
  lastSavedKeys = remaining;
  if(!remaining.length){
    $("#savedAmt").textContent="Removed";
    $("#savedCat").textContent="That entry is gone from the sheet.";
    $("#savedBudget").textContent="";
    b.classList.add("hide");
  } else {
    $("#savedBudget").textContent = lastErr;
  }
  b.textContent=undoLabel(remaining.length); b.disabled=false;
};
$("#retryQueue").onclick = ()=> flushQueue();
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
$("#refresh").onclick = async ()=>{
  $("#refresh").textContent="…";
  try{ await loadData(); paintTrack(); }catch(e){ $("#totalSub").textContent=e.message; }
  $("#refresh").textContent="Refresh";
};
/* One field, not two: the code lives in the URL itself as ?t=…, the same way the
   ?url=&t= deep link already works below. Paste either the exec URL with the code
   on the end, or the full deep link — both carry a "t" param to pull the code from. */
$("#connect").onclick = async ()=>{
  let url=$("#urlIn").value.trim(), token="";
  try { const u=new URL(url);
    token = u.searchParams.get("t") || "";
    if(u.searchParams.get("url")){ url=u.searchParams.get("url"); }
    else { u.search=""; url=u.toString(); } } catch {}
  if(!url||!token){ $("#setupMsg").textContent="Paste the full link — it should end …?t=your-code."; return; }
  cfg={...cfg,url,token}; $("#setupMsg").textContent="Checking…";
  try{ store.set(cfg); await loadData(); boot(); }
  catch(e){ $("#setupMsg").textContent=e.message; }
};

function prefillSetup(){
  $("#urlIn").value = cfg.url ? (cfg.token ? `${cfg.url}?t=${cfg.token}` : cfg.url) : "";
}
async function boot(){
  const u=new URL(location.href);
  const t=u.searchParams.get("t"), a=u.searchParams.get("url");
  if(t){ cfg={...cfg,token:t,...(a?{url:a}:{})}; store.set(cfg);
         history.replaceState({},"",location.pathname); }
  if(!cfg.token||!cfg.url){ prefillSetup(); $("#setup").classList.remove("hide"); return; }
  $("#setup").classList.add("hide"); $("#tabs").classList.remove("hide");
  const cached=loadCache();
  if(cached){ showTab(lastTab()); paintAmount(); paintQueue(); }
  try{ await loadData(); }
  catch(e){ if(!cached){ prefillSetup(); $("#setup").classList.remove("hide");
    $("#setupMsg").textContent=e.message; return; } }
  showTab(lastTab()); paintAmount(); paintQueue(); flushQueue();
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
