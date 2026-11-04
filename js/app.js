const H=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $=s=>document.querySelector(s);
const ST=["Planned","Material check","Material issued","In production","Sampling","Finished","MTC issued","On hold (NCR)"],GST=["18","12","5","28","0"];
const MODS={
so:{n:"Sales Order",p:"SO",g:"Sales",f:[["customer","Customer","text"],["pono","Customer PO no","text",0,1],["item","Item / grade","text"],["qty","Order qty (tons)","number"],["date","Order date","date"],["due","Delivery date","date"],["status","Status","select",["Open","Part dispatched","Closed"]]]},
wo:{n:"Work Order",p:"WO",g:"Production",f:[["so","Sales Order","ref:so",0,1],["item","Item / grade","text"],["qty","Qty to produce (shortfall, tons)","number"],["start","Start date","date"],["due","Due date","date"],["status","Status","select",ST]]},
ind:{n:"Indent",p:"IND",g:"Purchase",f:[["wo","Work Order","ref:wo",0,1],["item","Raw material","text"],["qty","Qty","number"],["req","Required by","date"],["status","Status","select",["Open","PO raised","Received"]]]},
po:{n:"Purchase Order",p:"PO",g:"Purchase",f:[["ind","Indent","ref:ind",0,1],["vendor","Vendor","text"],["item","Item","text"],["qty","Qty","number"],["rate","Rate (Rs)","number"],["gst","GST %","select",GST],["date","Delivery date","date"]]},
grn:{n:"GRN",p:"GRN",g:"Stock",f:[["po","Purchase Order","ref:po",0,1],["item","Item","text"],["qty","Qty received","number"],["heat","Heat / batch no","text",0,1],["date","Date","date"]]},
fgr:{n:"Finished Goods Receipt",p:"FGR",g:"Stock",f:[["wo","Work Order","ref:wo"],["item","Item","text"],["qty","Qty to stock (tons)","number"],["rej","Rejected / scrap (tons)","number",0,1],["date","Date","date"]]},
spectro:{n:"Spectro Test Report",p:"SPC",g:"Quality",f:[["wo","Work Order","ref:wo"],["sample","Sample Slip no","text"],["heat","Heat / batch no","text"],["date","Date","date"],["comp","Chemical composition","spectro"]]},
mtc:{n:"MTC",p:"MTC",g:"Quality",f:[["wo","Work Order","ref:wo"],["spectro","Spectro Report (must pass)","ref:spectro"],["customer","Customer","text"],["heat","Heat / batch no","text"],["qty","Qty (tons)","number"],["date","Date","date"]]},
dn:{n:"Dispatch Note",p:"DN",g:"Sales",f:[["so","Sales Order","ref:so"],["item","Item","text"],["qty","Qty (tons)","number"],["date","Date","date"],["vehicle","Vehicle no","text",0,1],["eway","E-way bill no","text",0,1]]},
inv:{n:"Sales Invoice",p:"INV",g:"Accounts",f:[["dn","Dispatch Note","ref:dn"],["customer","Customer","text"],["amount","Taxable amount (Rs)","number"],["gst","GST %","select",GST],["date","Date","date"]]}};
const KEYS=["dash","stock",...Object.keys(MODS)],NAME=k=>k=="dash"?"Dashboard":k=="stock"?"Stock page":MODS[k].n,LV=["none","view","edit"];
const TPL={planner:{l:"Planner",p:{dash:"view",stock:"view",so:"edit",wo:"edit",ind:"edit",po:"edit",dn:"edit",inv:"edit"}},
quality:{l:"Quality",p:{dash:"view",wo:"view",spectro:"edit",mtc:"edit"}},
stores:{l:"Stores",p:{dash:"view",stock:"view",so:"view",wo:"view",grn:"edit",fgr:"edit",dn:"edit"}},
viewer:{l:"Viewer",p:Object.fromEntries(KEYS.map(k=>[k,"view"]))}};
const A={so:[["Work Order","wo",r=>({so:r.id,item:r.item,qty:Math.max(0,r.qty-stock(r.item)),status:"Planned"})],["Dispatch","dn",r=>({so:r.id,item:r.item})]],
wo:[["Indent","ind",r=>({wo:r.id})],["Spectro","spectro",r=>({wo:r.id})],["FG Receipt","fgr",r=>({wo:r.id,item:r.item,qty:r.qty})]],
ind:[["PO","po",r=>({ind:r.id,item:r.item,qty:r.qty})]],po:[["GRN","grn",r=>({po:r.id,item:r.item,qty:r.qty})]],
spectro:[["MTC","mtc",r=>({spectro:r.id,wo:r.wo,heat:r.heat})]],dn:[["Invoice","inv",r=>({dn:r.id})]]};
const EL=["C","Si","Mn","P","S","Cr"];
/* Which field links each module back to its source record, and which steps may happen only once per source.
   Remove a module from ONCE to allow several (e.g. add "dn" to ONCE to block part dispatches). */
const LINK={wo:"so",dn:"so",ind:"wo",spectro:"wo",fgr:"wo",po:"ind",grn:"po",mtc:"spectro",inv:"dn"};
const ONCE=new Set(["wo","spectro","mtc","po","grn","inv"]);
/* ---------- state and permissions ---------- */
let DB=null,U=null,me={},boot=0,isAdmin=false,canW=true,acc=null,accList=[],reqList=[],cache={},unsubs={},NM={},requested=false;
let P={k:"",page:0,size:25,q:"",rows:[],total:0,kids:{},loading:false},STK={},DS=null;
const REFC={};let LOADERR="";let FR={key:"",loading:false,children:{}};
let S={view:"dash",form:null,menu:false,msg:"",err:""};
const perm=k=>isAdmin?"edit":(acc&&acc.perms&&acc.perms[k])||"none";
const can=k=>perm(k)!="none",wr=k=>perm(k)=="edit"&&canW;
const D=k=>k==P.k?P.rows:[],t=x=>String(x||"").trim().toLowerCase();
const nm=id=>NM[id]||"Person "+String(id).slice(-4);
/* ---------- server-side data: one page at a time ---------- */
const later=(()=>{const m={};return(n,f,ms=400)=>{clearTimeout(m[n]);m[n]=setTimeout(f,ms)}})();
let chUn=null,reqId=0;
function curView(){let v=S.view;if(MODS[v]&&P.k!=v){openList(v);refreshView()}return v}
function openList(k){P={k,page:0,size:25,q:"",rows:[],total:0,kids:{},loading:true}}
async function loadStk(){const{data,error}=await sb.from("stock_levels").select("*");if(error)throw error;STK={};(data||[]).forEach(r=>STK[r.item_key]={i:r.label,in:+r.qty_in,out:+r.qty_out})}
async function loadPage(){const k=P.k;if(!k)return;const my=++reqId;P.loading=true;
const r=await DB.page("rec_"+k,{page:P.page,size:P.size,q:P.q});
if(!r.rows.length&&P.page>0){P.page=Math.max(0,Math.ceil(r.total/P.size)-1);return loadPage()}
const ids=r.rows.map(x=>x.id),kids={};
if(ids.length)await Promise.all((A[k]||[]).map(async a=>{const t=a[1];if(!can(t))return;const m={};(await DB.byIds("rec_"+t,LINK[t],ids)).forEach(x=>(m[x[LINK[t]]]=m[x[LINK[t]]]||[]).push(x));kids[t]=m}));
if(my!=reqId||P.k!=k)return;P.rows=r.rows;P.total=r.total;P.kids=kids;P.loading=false}
async function refreshView(){const v=curView();LOADERR="";
try{if(can("stock")||can("dn")||can("so"))await loadStk();
if(MODS[v]){if(P.k!=v)openList(v);await loadPage()}
else if(v=="dash"&&can("dash")){const{data,error}=await sb.rpc("dashboard_stats");if(error)throw error;DS=data}
}catch(e){P.loading=false;const m=e.message||"error";LOADERR=/dashboard_stats|stock_levels|schema cache|does not exist|Could not find/i.test(m)?"The database needs the speed-up script. Open Supabase, SQL Editor, and run scale.sql once. ("+m+")":"Could not load data: "+m}
if(!S.form||S.step)render()}
function sync(){txStart();if(!chUn)chUn=DB.onChange(Object.keys(MODS).map(k=>"rec_"+k),()=>later("chg",refreshView,500));refreshView()}
const optsHtml=rs=>rs.map(r=>`<option value="${H(r.id)}" label="${H(r.customer||r.item||r.sample||"")}">`).join("");
async function fillRefs(){document.querySelectorAll("input[data-ref]").forEach(async i=>{const rk=i.dataset.ref;
if(!REFC[rk]||Date.now()-REFC[rk].t>20000){try{REFC[rk]={t:Date.now(),rows:(await DB.page("rec_"+rk,{size:15})).rows}}catch(e){return}}
const dl=$("#dl_"+i.id.slice(2));if(dl)dl.innerHTML=(i.value?`<option value="${H(i.value)}">`:"")+optsHtml(REFC[rk].rows)})}
function loadNames(){const ids=[...accList,...reqList].map(x=>x.id);if(!ids.length)return;U.profiles(ids).then(p=>{let ch=0;ids.forEach(i=>{const n=(p[i]&&p[i].name)||"";if(NM[i]!==n){NM[i]=n;ch=1}});if(ch)render()})}
function stock(item){const o=STK[t(item)];return o?o.in-o.out:0}
const judge=c=>{const v=c.filter(x=>x.ach!=="");if(!v.length)return"Pending";return v.every(x=>(x.min===""||+x.ach>=+x.min)&&(x.max===""||+x.ach<=+x.max))?"Pass":"Fail"};
async function add(k,o){o.id=MODS[k].p+"-"+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,4).toUpperCase();o.by=me.id||"";await DB.doc("rec_"+k+"/"+o.id).set(o);return o}
const AL={so:[["so","once"],["so","qty"]],wo:[["wo","multi"],["wo","multi"],["wo","once"]],ind:[["ind","once"]],po:[["po","once"]],spectro:[["spectro","once"]],dn:[["dn","once"]]};
function acts(k,r,i){return(A[k]||[]).map((a,j)=>{const[lf,md]=AL[k][j],L=can(a[1])?((P.kids[a[1]]||{})[r.id]||[]):[],b=`data-a="act" data-k="${k}" data-i="${i}" data-j="${j}"`;
if(md=="once"&&L.length)return`<span class="tag ok" title="${H(L.map(x=>x.id).join(", "))}">✓ ${a[0]}</span> `;
if(md=="qty"){const s=L.reduce((n,x)=>n+ +x.qty,0);if(L.length&&s>=+r.qty)return`<span class="tag ok">✓ Dispatched ${s}/${r.qty} t</span> `;return wr(a[1])?`<button class="btn s" ${b}>+ ${a[0]}${s?` (${s}/${r.qty} t)`:""}</button>`:""}
if(!wr(a[1]))return L.length?`<span class="tag">${a[0]} ×${L.length}</span> `:"";
return`<button class="btn s${L.length?" dn":""}" ${b}>${L.length?"✓ ":"+ "}${a[0]}${L.length>1?" ×"+L.length:""}</button>`}).join("")}
function flowState(k,r){
if(k==="so")return r.status==="Closed"?["Complete","ok"]:r.status==="Part dispatched"?["In progress",""]:["Pending",""];
if(k==="wo")return r.status==="On hold (NCR)"?["On hold","bad"]:["Finished","MTC issued"].includes(r.status)?["Complete","ok"]:["In progress",""];
if(k==="ind")return r.status==="Received"?["Complete","ok"]:r.status==="PO raised"?["In progress",""]:["Pending",""];
if(k==="po"){if(!can("grn"))return["Not tracked",""];const received=((P.kids.grn||{})[r.id]||[]).reduce((n,x)=>n+(+x.qty||0),0);return received>=+r.qty?["Complete","ok"]:received?["In progress",""]:["Pending",""]}
if(k==="spectro")return r.result==="Fail"?["Reviewed: Fail","bad"]:r.result==="Pass"?["Complete","ok"]:["Pending",""];
if(k==="dn")return !can("inv")?["Not tracked",""]:((P.kids.inv||{})[r.id]||[]).length?["Complete","ok"]:["Invoice pending",""];
return ["Complete","ok"]}
function flowBadge(k,r){const[s,c]=flowState(k,r);return`<span class="tag ${c}">${H(s)}</span>`}
const g=async(k,id)=>{try{const s=await DB.doc("rec_"+k+"/"+id).get();return s.exists?s.data():null}catch(e){return null}};
function formLinkKey(){if(!S.form)return"";const{k,v,id}=S.form;const refs=MODS[k].f.filter(f=>f[2].startsWith("ref:")).map(f=>f[2].slice(4)+":"+String(v[f[0]]||"").trim());return k+"/"+(id||"new")+"|"+refs.join("|")}
function formLinks(k,v,id){const parents=MODS[k].f.filter(f=>f[2].startsWith("ref:")).map(f=>{const[fid,label,ty]=f,rk=ty.slice(4),rid=String(v[fid]||"").trim();return rid&&can(rk)?`<button class="btn s" data-a="openrec" data-k="${rk}" data-id="${H(rid)}">Open ${H(MODS[rk].n)} ${H(rid)}</button>`:""}).filter(Boolean);
const children=(A[k]||[]).flatMap((a,j)=>{const target=a[1];if(!id||!can(target))return[];const found=(FR.children[target]||[]),mode=(AL[k]||[])[j]?.[1],items=found.map(r=>`<button class="btn s" data-a="openrec" data-k="${target}" data-id="${H(r.id)}">Open ${H(MODS[target].n)} ${H(r.id)}</button>`);if(wr(target)&&(!found.length||mode!=="once"))items.push(`<button class="btn s" data-a="newrel" data-k="${k}" data-j="${j}">+ New ${H(MODS[target].n)}</button>`);return items});
const all=[...parents,...children];if(!all.length)return id&&FR.loading?'<div class="card"><h3>Related modules</h3><span class="mute">Loading linked records...</span></div>':"";return`<div class="card"><h3>Related modules</h3><div class="bar2" style="flex-wrap:wrap">${all.join("")}</div></div>`}
function loadFormLinks(){if(!S.form)return;const key=formLinkKey();if(FR.key===key)return;const{k,id}=S.form;FR={key,loading:!!id,children:{}};if(!id){FR.loading=false;return}const jobs=(A[k]||[]).filter(a=>can(a[1])).map(async a=>{const target=a[1];try{FR.children[target]=await DB.byIds("rec_"+target,LINK[target],[id])}catch(e){FR.children[target]=[]}});Promise.all(jobs).then(()=>{if(S.form&&formLinkKey()===key){FR.loading=false;render()}})}
function formDirty(){if(!S.form)return false;const{k,v}=S.form;return MODS[k].f.some(([fid,,ty])=>{if(ty==="spectro"){const cur=[...document.querySelectorAll(".sr")].map(r=>{const i=r.querySelectorAll("input");return{e:i[0].value.trim(),min:i[1].value,max:i[2].value,ach:i[3].value}});return JSON.stringify(cur)!==JSON.stringify(v[fid]||EL.map(e=>({e,min:"",max:"",ach:""})))}const el=$("#f_"+fid);return el&&el.value.trim()!==String(v[fid]??"")})}
const upd=(k,id,d)=>DB.doc("rec_"+k+"/"+id).update(d).catch(()=>{});
const rows=async(k,f,v)=>{try{return(await DB.collection("rec_"+k).where(f,"==",v).get()).docs.map(d=>d.data())}catch(e){return[]}};
async function setWO(id,s,from){if(!id)return;const w=await g("wo",id);if(!w||(from&&!from.includes(w.status)))return;await upd("wo",id,{status:s})}
const EARLY=["Planned","Material check","Material issued","In production"];
async function chain(k,o){
if(k=="ind")await setWO(o.wo,"Material check",["Planned"]);
if(k=="po"&&o.ind)await upd("ind",o.ind,{status:"PO raised"});
if(k=="grn"&&o.po){const p=await g("po",o.po);if(p&&p.ind){await upd("ind",p.ind,{status:"Received"});const ind=await g("ind",p.ind);if(ind&&ind.wo){const all=await rows("ind","wo",ind.wo);if(all.every(x=>x.id==ind.id||x.status=="Received"))await setWO(ind.wo,"Material issued",["Planned","Material check"])}}}
if(k=="spectro")await setWO(o.wo,o.result=="Fail"?"On hold (NCR)":"Sampling",o.result=="Fail"?undefined:EARLY);
if(k=="fgr")await setWO(o.wo,"Finished");
if(k=="mtc")await setWO(o.wo,"MTC issued");
if(k=="dn"&&o.so){const so=await g("so",o.so);if(so){const tot=(await rows("dn","so",o.so)).reduce((n,x)=>n+ +x.qty,0);await upd("so",o.so,{status:tot>=+so.qty?"Closed":"Part dispatched"})}}}
async function demo(){const td=new Date().toISOString().slice(0,10);
await add("fgr",{wo:"",item:"Ductile Iron Casting",qty:"30",rej:"",date:td});
const so=await add("so",{customer:"Sharma Castings",pono:"PO-7781",item:"Ductile Iron Casting",qty:"100",date:td,due:td,status:"Open"});
const w=await add("wo",{so:so.id,item:"Ductile Iron Casting",qty:"70",start:td,due:td,status:"Sampling"});
await add("spectro",{wo:w.id,sample:"SS-01",heat:"H-2201",date:td,comp:[{e:"C",min:"3.4",max:"3.8",ach:"3.6"},{e:"Si",min:"2.2",max:"2.8",ach:"2.5"}],result:"Pass"});
await add("ind",{wo:w.id,item:"Pig iron",qty:"40",req:td,status:"Open"})}
/* ---------- views ---------- */
function msgView(h,b){return`<div class="login"><h1>Foundry ERP</h1><div class="card"><p>${h}</p>${b||""}</div></div>`}
function noAccess(){return msgView(`Hello ${H(me.name||"there")}. You do not have access to any ERP module yet.`,`${S.msg?`<p class="msg bad" role="alert">${H(S.msg)}</p>`:""}${canW&&me.id?(requested?'<p class="msg" role="status">Access request sent. An administrator must approve it before ERP modules appear.</p>':'<button class="btn p" data-a="req">Request access</button>'):'<p class="mute">Ask the administrator to grant you access.</p>'}`)}
function shell(body){const gs={};Object.keys(MODS).filter(can).forEach(k=>(gs[MODS[k].g]=gs[MODS[k].g]||[]).push(k));
const nav=b=>`<button data-a="nav" data-v="${b[0]}"${S.view==b[0]?' class="on"':""}>${b[1]}</button>`;
return`<header class="top"><button class="hb" data-a="menu" aria-label="Menu" aria-expanded="${S.menu}"><span></span><span></span><span></span></button><b>Foundry ERP</b><span class="mute sm">${H(me.name||"")}${isAdmin?" (admin)":""}</span><button class="btn s" data-a="out">Sign out</button></header>`+(S.menu?`<div class="scrim" data-a="menu"></div><aside class="dr"><h3>Overview</h3>${can("dash")?nav(["dash","Dashboard"]):""}${can("stock")?nav(["stock","Stock"]):""}${isAdmin||can("dash")?nav(["txn","Transactions"]):""}${Object.keys(gs).map(g=>`<h3>${g}</h3>`+gs[g].map(k=>nav([k,MODS[k].n])).join("")).join("")}${isAdmin?"<h3>Admin</h3>"+nav(["users","Users and access"]):""}</aside>`:"")+`<main>${LOCAL?'<div class="msg">Local mode: data is saved only in this browser. Open the artifact from claude.ai to share data with other users.</div>':""}${LOADERR?`<div class="msg" role="alert" style="background:#f5c26b55">${H(LOADERR)}</div>`:""}${canW?"":'<div class="msg">You have view-only access to this page, so changes cannot be saved.</div>'}${body}</main>`}
function dash(){if(!DS)return LOADERR?"":'<p class="mute">Loading...</p>';
const n=s=>(DS.wo_by_status||{})[s]||0,W=+DS.wo_total,pass=+DS.sp_pass,fail=+DS.sp_fail,spt=+DS.sp_total,mtc=+DS.mtc_total;
const k=(v,l,c,icon)=>`<article class="kpi ${c||""}"><span class="kpi-icon" aria-hidden="true">${icon}</span><div><b>${v}</b><span>${l}</span></div></article>`,mx=Math.max(1,W);
const bar=(l,v,c,m)=>`<div class="row"><span>${l}</span><div class="bar"><i class="${c||""}" style="width:${Math.min(100,v/m*100)}%"></i></div><b>${v}</b></div>`,q=Math.max(1,spt),waiting=n("Planned")+n("Material check")+n("Material issued"),holds=n("On hold (NCR)"),hasStock=can("stock")||can("dn")||can("so"),stockRows=Object.values(STK),stockIn=stockRows.reduce((v,r)=>v+r.in,0),stockOut=stockRows.reduce((v,r)=>v+r.out,0),stockBalance=stockIn-stockOut,passRate=spt?Math.round(pass/spt*100):0,today=new Date().toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"});
const lab=tn=>{const e=Object.entries(SCHEMA).find(([x,v])=>v.t==tn);return e&&MODS[e[0].slice(4)]?MODS[e[0].slice(4)].n:tn},jump=(v,l)=>(v=="txn"?(isAdmin||can("dash")):can(v))?`<button class="btn s" data-a="nav" data-v="${v}">${l}</button>`:"",activity=TX.slice(0,5).map(r=>`<li><span class="activity-dot ${r.action=="DELETE"?"bad":r.action=="UPDATE"?"q":"ok"}"></span><div><b>${H(r.changed_by_name||"System")}</b> ${H(r.action.toLowerCase())} <span>${H(lab(r.table_name))}</span><small>${H(r.record_id||"")}</small></div><time>${H(new Date(r.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}))}</time></li>`).join("");
return`<section class="dash-hero"><div><span class="dash-eyebrow">OPERATIONS COMMAND CENTER</span><h2>Foundry dashboard</h2><p>Production, quality, stock and activity in one live view.</p><div class="dash-hero-meta"><span class="live-pill"><i></i>Live</span><span>${H(today)}</span></div></div><div class="dash-mark" aria-hidden="true">F</div></section>
<section class="dash-section"><div class="section-heading"><div><span class="dash-eyebrow">AT A GLANCE</span><h3>Today's operations</h3></div><div class="dash-actions">${jump("wo","Work orders")}${jump("stock","Stock")}${jump("txn","Transactions")}</div></div><div class="kpis">${k(W,"Work Orders","","WO")}${k(waiting,"Waiting material","e","WM")}${k(n("In production"),"In production","","IP")}${k(+DS.so_open,"Open Sales Orders","","SO")}${k(passRate+"%","Quality pass rate","g","QA")}${k(holds,"NCR holds",holds?"r":"g","!")}${k(mtc,"MTC issued","g","MTC")}</div></section>
<section class="dash-section"><div class="grid dash-panels"><article class="card dash-panel"><div class="panel-heading"><div><span class="dash-eyebrow">LIVE WORKFLOW</span><h3>Work orders by stage</h3><p>Current distribution across production</p></div><span class="panel-total">${W}<small>total</small></span></div><div class="stage-list">${ST.map(s=>bar(s,n(s),s==="On hold (NCR)"?"bad":"",mx)).join("")}</div></article><article class="card dash-panel"><div class="panel-heading"><div><span class="dash-eyebrow">QUALITY</span><h3>Quality overview</h3><p>Testing results and certification</p></div><span class="panel-total">${spt}<small>samples</small></span></div><div class="stage-list">${bar("Samples tested",spt,"q",q)}${bar("Passed",pass,"ok",q)}${bar("Failed (NCR)",fail,"bad",q)}${bar("MTC issued",mtc,"ok",Math.max(1,spt))}</div><div class="quality-note"><span class="quality-dot ${fail?"warn":""}"></span>${spt?`${passRate}% pass rate${fail?` - ${fail} requires review`:""}`:"No samples tested yet"}</div></article></div></section>
<section class="dash-section"><div class="grid dash-lower"><article class="card dash-panel dash-stock"><div class="panel-heading"><div><span class="dash-eyebrow">STOCK POSITION</span><h3>${hasStock?"Material balance":"Stock access"}</h3><p>${hasStock?"Receipts and dispatches recorded in the ERP":"Ask an administrator for stock access."}</p></div><span class="panel-total">${hasStock?stockRows.length:"-"}<small>${hasStock?"items":"items"}</small></span></div>${hasStock?`<div class="stock-summary"><div><span>Inward</span><b>${stockIn}</b><small>tons</small></div><div><span>Outward</span><b>${stockOut}</b><small>tons</small></div><div class="stock-balance"><span>Balance</span><b>${stockBalance}</b><small>tons</small></div></div><div class="dash-panel-footer">${jump("stock","Open stock")}</div>`:`<div class="empty-state">Stock data is shown here when your role has stock, sales-order, or dispatch access.</div>`}</article><article class="card dash-panel dash-activity"><div class="panel-heading"><div><span class="dash-eyebrow">RECENT ACTIVITY</span><h3>Latest changes</h3><p>Live transaction audit</p></div>${jump("txn","View all")}</div><ul class="activity-list">${activity||'<li class="empty-state">No transactions yet.</li>'}</ul></article></div></section>
${!W&&isAdmin&&canW?`<div class="card dash-empty"><p>No data yet. Add a first look with sample workflow records.</p><button class="btn p" data-a="demo">Load demo data</button></div>`:""}`}
let TX=[],txUn=null;
async function txLoad(){const{data,error}=await sb.from("transactions").select("*").order("created_at",{ascending:false}).limit(500);if(error)throw error;
const kept={};TX=(data||[]).filter(r=>{const name=String(r.changed_by_name||"").trim(),key=name?"user:"+name:"system";kept[key]=(kept[key]||0)+1;return kept[key]<=5});if(!S.form)render()}
function txStart(){if(txUn||!window.sb||!(isAdmin||can("dash")))return;
txLoad();const ch=sb.channel("txn-"+Math.random()).on("postgres_changes",{event:"INSERT",schema:"public",table:"transactions"},()=>later("tx",txLoad,500)).subscribe();txUn=()=>sb.removeChannel(ch)}
function txnV(){const lab=tn=>{const e=Object.entries(SCHEMA).find(([k,x])=>x.t==tn);return e&&MODS[e[0].slice(4)]?MODS[e[0].slice(4)].n:tn};
const skip=["created_at","created_by"],sum=r=>{if(r.action=="INSERT")return"Created";if(r.action=="DELETE")return"Deleted";
const o=r.old_data||{},n=r.new_data||{};const c=Object.keys(n).filter(k=>!skip.includes(k)&&JSON.stringify(o[k])!=JSON.stringify(n[k]));
return c.map(k=>k+": "+(o[k]==null?"-":typeof o[k]=="object"?"...":o[k])+" → "+(n[k]==null?"-":typeof n[k]=="object"?"...":n[k])).join("; ")||"Updated"};
return`<h2>Transactions</h2><p class="mute">Latest five changes per user, including System, newest first.</p><div class="card scroll"><table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Details</th></tr></thead><tbody>${TX.map(r=>`<tr><td>${H(new Date(r.created_at).toLocaleString())}</td><td>${H(r.changed_by_name||"System")}</td><td><b>${r.action=="INSERT"?"Created":r.action=="UPDATE"?"Updated":"Deleted"}</b></td><td>${H(lab(r.table_name))}</td><td>${H(r.record_id||"")}</td><td>${H(sum(r))}</td></tr>`).join("")||'<tr><td colspan="6" class="mute">No transactions yet.</td></tr>'}</tbody></table></div>`}
function stockV(){const m=STK;
const rows=Object.values(m);return`<h2>Stock</h2><p class="mute">Calculated from GRN and Finished Goods Receipts (in) and Dispatch Notes (out).</p><div class="card scroll"><table><thead><tr><th>Item</th><th>In (tons)</th><th>Out (tons)</th><th>Balance</th></tr></thead><tbody>${rows.map(o=>`<tr><td>${H(o.i)}</td><td>${o.in}</td><td>${o.out}</td><td><b>${o.in-o.out}</b></td></tr>`).join("")||'<tr><td colspan="4" class="mute">No stock movements yet.</td></tr>'}</tbody></table></div>`}
function list(k){const m=MODS[k],cs=m.f.filter(f=>f[2]!="spectro").slice(0,6),rs=D(k);
const tg=v=>`<span class="tag ${v=="Pass"?"ok":v=="Fail"||/hold/.test(v)?"bad":""}">${H(v)}</span>`;
return`<div class="bar2"><h2 style="flex:1">${m.n}</h2>${wr(k)?`<button class="btn p" data-a="new" data-k="${k}">New ${m.n}</button>`:'<span class="tag">View only</span>'}</div>${S.msg?`<div class="msg" role="status">${H(S.msg)}</div>`:""}<div class="tools"><input id="q" type="search" placeholder="Search ${m.n} (number, customer, item...)" aria-label="Search" value="${H(P.q)}"></div><div class="card scroll"><table><thead><tr><th>No</th>${cs.map(f=>`<th>${f[1]}</th>`).join("")}${k=="spectro"?"<th>Result</th>":""}<th>Workflow</th><th></th></tr></thead><tbody>${rs.map((r,i)=>`<tr class="r" data-a="edit" data-k="${k}" data-i="${i}"><td><b>${r.id}</b></td>${cs.map(f=>`<td>${f[2]=="select"&&f[0]=="status"?tg(r[f[0]]||""):H(r[f[0]])}</td>`).join("")}${k=="spectro"?`<td>${tg(r.result)}</td>`:""}<td>${flowBadge(k,r)}</td><td>${acts(k,r,i)}</td></tr>`).join("")||`<tr><td colspan="10" class="mute">${P.loading?"Loading...":P.q.trim()?"No match.":"Nothing here yet."}</td></tr>`}</tbody></table></div><div class="tools"><span class="mute sm" style="flex:1">${P.total?`${P.page*P.size+1}-${Math.min(P.total,(P.page+1)*P.size)} of ${P.total}`:""}</span><button class="btn s" data-a="prev"${P.page?"":" disabled"}>Previous</button><button class="btn s" data-a="next"${(P.page+1)*P.size<P.total?"":" disabled"}>Next</button></div>`}
function form(){const{k,v,id}=S.form,m=MODS[k];
const fld=([fid,l,ty,op,opt])=>{const x=v[fid]??"";
if(ty=="select")return`<label>${l}<select id="f_${fid}">${op.map(o=>`<option${o==x?" selected":""}>${o}</option>`).join("")}</select></label>`;
if(ty.startsWith("ref:")){const rk=ty.slice(4);return`<label>${l}<input id="f_${fid}" list="dl_${fid}" data-ref="${rk}" autocomplete="off" placeholder="${opt?"Optional. Type to search...":"Type to search..."}" value="${H(x)}"><datalist id="dl_${fid}">${x?`<option value="${H(x)}">`:""}${optsHtml(REFC[rk]?REFC[rk].rows:[])}</datalist></label>`}
if(ty=="spectro"){const c=x||EL.map(e=>({e,min:"",max:"",ach:""}));return`<div style="grid-column:1/-1"><span class="mute sm">${l} (required range and achieved value)</span><div class="scroll"><table><thead><tr><th>Element</th><th>Min</th><th>Max</th><th>Achieved</th><th>Result</th><th></th></tr></thead><tbody id="srb">${c.map(srRow).join("")}</tbody></table></div><button class="btn s" type="button" data-a="addrow">+ Add element</button></div>`}
return`<label>${l}<input id="f_${fid}" type="${ty}" value="${H(x)}"${ty=="number"?' step="any" min="0"':""}></label>`};
const w=wr(k);return`<h2>${id?(w?"Edit ":"")+id:"New "+m.n}</h2><div class="card"><div class="fg" id="fgd">${m.f.map(fld).join("")}</div>${formLinks(k,v,id)}<div id="hint" class="mute"></div>${S.err?`<div class="msg bad" role="alert">${H(S.err)}</div>`:""}<div class="bar2">${w?'<button class="btn p" data-a="save">Save</button>':""}<button class="btn" data-a="cancel">${w?"Cancel":"Back"}</button><button class="btn" onclick="print()">Print</button>${id&&isAdmin&&canW?'<button class="btn" data-a="del">Delete</button>':""}</div></div>`}
function users(){const ts=Object.keys(TPL);
return`<h2>Users and access</h2><p class="mute">People create their own account on the sign-in screen. Search for them here by name or email, then grant module access.</p>
<div class="card"><h3>Add a person</h3><input id="us" placeholder="Search by name" aria-label="Search people"><div id="found"></div></div>
${reqList.length?`<div class="card"><h3>Access requests</h3>${reqList.map(r=>`<div class="bar2"><b>${H(nm(r.id))}</b>${ts.map(x=>`<button class="btn s" data-a="grant" data-id="${r.id}" data-t="${x}">${TPL[x].l}</button>`).join("")}</div>`).join("")}</div>`:""}
<h3 style="margin-top:18px">People with access</h3>${accList.map(a=>`<div class="card" data-uid="${a.id}"><div class="bar2"><b style="flex:1">${H(nm(a.id))}</b><span class="mute">${H(a.label||"")}</span><button class="btn s" data-a="revoke" data-id="${a.id}">Remove</button></div><div class="fg">${KEYS.map(k=>`<label>${NAME(k)}<select class="mx" data-k="${k}">${LV.map(l=>`<option${((a.perms||{})[k]||"none")==l?" selected":""}>${l}</option>`).join("")}</select></label>`).join("")}</div></div>`).join("")||'<p class="mute">Nobody yet. The owner and editors always have full access.</p>'}`}
function home(){return can("dash")?"dash":can("stock")?"stock":Object.keys(MODS).find(can)||"dash"}
function render(){const a=$("#app");
if(boot==0){a.innerHTML=msgView("Loading...");return}
if(boot==2){a.innerHTML=msgView("Could not load your data.",`<p class="mute sm">${H(DG)}</p><div class="bar2"><button class="btn" data-a="retry">Try again</button><button class="btn" data-a="out">Sign out</button></div>`);return}
if(!isAdmin&&!KEYS.some(can)){a.innerHTML=noAccess();return}
let v=S.view;if(v=="txn"&&!(isAdmin||can("dash"))||v=="users"&&!isAdmin||(v=="dash"||v=="stock")&&!can(v)||MODS[v]&&!can(v))v=home();
let b;if(S.form&&can(S.form.k))b=form();else if(v=="dash")b=dash();else if(v=="stock")b=stockV();else if(v=="txn")b=txnV();else if(v=="users")b=users();else b=list(v);
const af=document.activeElement,keep=af&&af.id=="q"?af.selectionStart:null;
 a.innerHTML=shell(b)+stepModal();hint();{const g=$("#stepGo");if(g)g.focus()}if(keep!=null){const q=$("#q");if(q){q.focus();q.setSelectionRange(keep,keep)}}if(S.form){fillRefs();loadFormLinks()}document.querySelectorAll(".sr").forEach(calc);
if(S.form&&!wr(S.form.k))document.querySelectorAll("#fgd input,#fgd select").forEach(x=>x.disabled=true)}
function stepModal(){if(!S.step)return"";const st=S.step,r=D(st.k)[st.i],x=r&&A[st.k]&&A[st.k][st.j];if(!x){S.step=null;return""}
const to=MODS[x[1]].n,from=MODS[st.k].n,v=x[2](r),fl=MODS[x[1]].f;
const rows=Object.keys(v).filter(k=>v[k]!==undefined&&v[k]!=="").map(k=>{const f=fl.find(y=>y[0]==k);return`<tr><td class="mute">${H(f?f[1]:k)}</td><td><b>${H(v[k])}</b></td></tr>`}).join("");
if(st.dup)return`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="stt"><div class="box"><h3 id="stt">${H(to)} already exists</h3>
<p><b>${H(from)} ${H(r.id)}</b> already has a <b>${H(to)}</b>: <b>${st.dup.map(H).join(", ")}</b>. It cannot be created again.</p>
<div class="bar2">${can(x[1])?`<button class="btn p" data-a="nav" data-v="${x[1]}">View ${H(to)}</button>`:""}<button class="btn" id="stepGo" data-a="stepNo">Close</button></div></div></div>`;
const warn=x[1]=="mtc"&&r.result!="Pass"?`<div class="msg" style="background:#f5c26b55">Spectro result is <b>${H(r.result||"not set")}</b>. An MTC normally needs a Pass.</div>`:"";
return`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="stt"><div class="box"><h3 id="stt">Move to ${H(to)}?</h3>
<p>You are moving from <b>${H(from)} ${H(r.id)}</b> to a new <b>${H(to)}</b>. These details carry over:</p>
<table><tbody>${rows||'<tr><td class="mute">Nothing to carry over.</td></tr>'}</tbody></table>${warn}
<div class="bar2"><button class="btn p" id="stepGo" data-a="stepGo">Continue to ${H(to)}</button><button class="btn" data-a="stepNo">Cancel</button></div></div></div>`}
document.addEventListener("keydown",e=>{if(e.key=="Escape"&&S.step){S.step=null;render()}});
function hint(){const h=$("#hint");if(!h||!S.form||!["so","dn"].includes(S.form.k))return;const i=$("#f_item"),q=$("#f_qty");if(!i)return;const s=stock(i.value),n=+q.value||0;
h.textContent=i.value?`In stock: ${s} tons. `+(S.form.k=="so"?(n>s?`Shortfall ${n-s} tons: create a Work Order for it after saving.`:"Stock covers the full order."):(n>s?"Not enough stock for this dispatch.":"")):""}
const srRow=r=>`<tr class="sr">${["e","min","max","ach"].map(q=>`<td><input value="${H(r[q])}" ${q=="e"?"":'type="number" step="any"'} aria-label="${q}"></td>`).join("")}<td class="res">-</td><td><button class="btn s" type="button" data-a="delrow" aria-label="Remove this row">Remove</button></td></tr>`;
function calc(r){const v=[...r.querySelectorAll("input")].map(x=>x.value),c=r.querySelector(".res");if(v[3]===""||(v[1]===""&&v[2]==="")){c.textContent="-";c.className="res";return}
const ok=(v[1]===""||+v[3]>=+v[1])&&(v[2]===""||+v[3]<=+v[2]);c.textContent=ok?"Within range":"Out of range";c.className="res "+(ok?"ok":"bad")}
async function submit(){const{k,id}=S.form,m=MODS[k],o={};let err="";
if(!wr(k))return;
for(const[fid,l,ty,op,opt]of m.f){if(ty=="spectro"){o[fid]=[...document.querySelectorAll(".sr")].map(r=>{const i=r.querySelectorAll("input");return{e:i[0].value.trim(),min:i[1].value,max:i[2].value,ach:i[3].value}}).filter(x=>x.e&&x.ach!=="");if(!o[fid].length)err=err||"Enter at least one achieved value."}
else{o[fid]=$("#f_"+fid).value.trim();if(!o[fid]&&!opt&&ty!="date")err=err||l+" is required.";if(o[fid]&&ty.startsWith("ref:")&&!(await g(ty.slice(4),o[fid])))err=err||l+" "+o[fid]+" was not found. Pick one from the suggestions."}if(ty=="number"&&+o[fid]<0)err=err||l+" cannot be negative."}
if(k=="spectro")o.result=judge(o.comp);
if(k=="mtc"){const s=await g("spectro",o.spectro);if(s&&s.result!="Pass")err=err||"MTC needs a Spectro Report that passed. Quality must decide on failed material first."}
if(k=="dn"&&!id&&+o.qty>stock(o.item))err=err||`Only ${stock(o.item)} tons in stock for this item.`;
if(!id&&!err&&ONCE.has(k)&&o[LINK[k]]){const ex=await rows(k,LINK[k],o[LINK[k]]);if(ex.length)err=`${m.n} ${ex.map(y=>y.id).join(", ")} already exists for ${o[LINK[k]]}. It cannot be created again.`}
if(err){S.err=err;S.form.v=Object.assign(S.form.v,o);render();return}
try{let r;if(id){r={...S.form.v,...o};await DB.doc("rec_"+k+"/"+id).set(r)}else r=await add(k,o);
await chain(k,o);S.msg=r.id+" saved. Linked statuses updated.";if(k=="spectro"&&o.result=="Fail")S.msg=r.id+" failed. Work Order is on hold until Quality decides.";
S.form=null;S.err="";S.view=k;if(P.k==k)P.page=0;await refreshView()}catch(e){S.err="Could not save: "+(e.message||e.code||"error")}render()}
async function setAcc(id,perms,label){await DB.doc("access/"+id).set({perms,label})}
document.addEventListener("click",async e=>{const a=e.target.closest("[data-a]");if(!a)return;const d=a.dataset;
try{switch(d.a){
case"out":await window.signOut();return;case"menu":S.menu=!S.menu;break;
case"retry":await start();return;
case"nav":S={view:d.v,form:null,menu:false,msg:"",err:""};if(MODS[d.v]&&P.k!=d.v)openList(d.v);render();await refreshView();return;
case"prev":if(P.page>0){P.page--;await loadPage()}break;
case"next":if((P.page+1)*P.size<P.total){P.page++;await loadPage()}break;
case"new":S.form={k:d.k,v:{status:MODS[d.k].f.find(f=>f[0]=="status")?.[3][0]},id:null};S.err="";S.msg="";break;
case"edit":if(e.target.closest("button"))return;S.form={k:d.k,v:{...D(d.k)[d.i]},id:D(d.k)[d.i].id};S.err="";break;
case"openrec":{if(formDirty()&&!confirm("Leave this form? Unsaved changes will be lost."))return;const r=await g(d.k,d.id);if(!r){S.msg="Related record "+d.id+" could not be opened.";break}S.view=d.k;S.form={k:d.k,v:r,id:d.id};S.err="";S.msg="";break}
case"newrel":{if(formDirty()&&!confirm("Leave this form? Unsaved changes will be lost."))return;const src=S.form.v,a=A[d.k][+d.j];S.view=a[1];S.form={k:a[1],v:a[2](src),id:null};S.err="";S.msg="";break}
case"act":{const st={k:d.k,i:d.i,j:d.j},r=D(st.k)[st.i],t=A[st.k][st.j][1];
if(ONCE.has(t)){const ex=await rows(t,LINK[t],r.id);if(ex.length)st.dup=ex.map(y=>y.id)}S.step=st;break}
case"stepNo":S.step=null;break;
case"addrow":{const b=$("#srb");if(!b)return;b.insertAdjacentHTML("beforeend",srRow({e:"",min:"",max:"",ach:""}));const n=b.lastElementChild;calc(n);n.querySelector("input").focus();return}
case"delrow":{const tr=a.closest("tr");if(tr)tr.remove();return}
case"stepGo":{const st=S.step,r=D(st.k)[st.i],x=A[st.k][st.j];
if(ONCE.has(x[1])){const ex=await rows(x[1],LINK[x[1]],r.id);if(ex.length){st.dup=ex.map(y=>y.id);break}}
S.step=null;S.view=x[1];S.form={k:x[1],v:x[2](r),id:null};S.err="";break}
case"save":await submit();return;case"cancel":S.form=null;S.err="";if(MODS[S.view]&&P.k!=S.view){openList(S.view);await refreshView()}break;
case"del":if(confirm("Delete "+S.form.id+"?")){await DB.doc("rec_"+S.form.k+"/"+S.form.id).delete();S.form=null;await refreshView()}break;
case"demo":await demo();DS=null;await refreshView();break;
case"req":await DB.doc("requests/"+me.id).set({at:Date.now()});requested=true;break;
case"grant":await setAcc(d.id,{...TPL[d.t].p},TPL[d.t].l);DB.doc("requests/"+d.id).delete().catch(()=>{});break;
case"revoke":if(confirm("Remove access for "+nm(d.id)+"?"))await DB.doc("access/"+d.id).delete();break}}catch(x){S.msg="Action failed: "+(x.message||x.code||"error")}
render()});
document.addEventListener("input",async e=>{if(e.target.id=="q"){P.q=e.target.value;later("q",async()=>{P.page=0;try{await loadPage()}catch(x){S.msg="Search failed: "+x.message}render()},350)}
const ri=e.target.closest("input[data-ref]");if(ri)later("ref"+ri.id,async()=>{try{const r=await DB.page("rec_"+ri.dataset.ref,{size:15,q:ri.value});const dl=$("#dl_"+ri.id.slice(2));if(dl)dl.innerHTML=optsHtml(r.rows)}catch(x){}},300);
const r=e.target.closest(".sr");if(r)calc(r);if(e.target.id=="f_item"||e.target.id=="f_qty")hint();
if(e.target.id=="us"){const q=e.target.value.trim(),f=$("#found");if(q.length<2){f.innerHTML="";return}
const rs=await U.search(q);f.innerHTML=rs.filter(p=>!accList.some(a=>a.id==p.id)).slice(0,6).map(p=>{NM[p.id]=p.name;return`<div class="bar2"><span style="flex:1">${H(p.name)}</span><button class="btn s" data-a="grant" data-id="${p.id}" data-t="viewer">Add as Viewer</button></div>`}).join("")||'<p class="mute sm">No match.</p>'}});
document.addEventListener("change",async e=>{if(!e.target.classList.contains("mx"))return;const c=e.target.closest("[data-uid]"),p={};
c.querySelectorAll(".mx").forEach(s=>{if(s.value!="none")p[s.dataset.k]=s.value});await setAcc(c.dataset.uid,p,"Custom")});
document.addEventListener("keydown",e=>{if(e.key=="Escape"&&S.menu){S.menu=false;render()}});
let DG="",LOCAL=false;
async function start(){boot=0;render();DB=makeDB(window.sb);U=makeU(window.sb);
try{await U.me()}catch(e){if(e.message=="SESSION_INVALID"){try{await sb.auth.signOut()}catch(x){}showLogin(false);note("Your saved sign-in is no longer valid. Please sign in again.");return}DG=e.message||"Profile not found. Did you run schema.sql?";boot=2;render();return}
me=await U.me();isAdmin=!!(me.isOwner||me.canEdit);canW=(await U.can("data.write"))!==false;
if(me.id)DB.doc("access/"+me.id).onSnapshot(s=>{acc=s.exists?s.data():null;sync();render()},()=>{});
if(isAdmin){DB.collection("access").onSnapshot(s=>{accList=s.docs.map(d=>({...d.data(),id:d.id}));loadNames();render()},()=>{});
DB.collection("requests").onSnapshot(s=>{reqList=s.docs.map(d=>({id:d.id}));loadNames();render()},()=>{})}
boot=1;sync();render()}
