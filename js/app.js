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
/* ---------- state and permissions ---------- */
let DB=null,U=null,me={},boot=0,isAdmin=false,canW=true,acc=null,accList=[],reqList=[],cache={},unsubs={},NM={},requested=false;
let S={view:"dash",form:null,menu:false,msg:"",err:""};
const perm=k=>isAdmin?"edit":(acc&&acc.perms&&acc.perms[k])||"none";
const can=k=>perm(k)!="none",wr=k=>perm(k)=="edit"&&canW;
const D=k=>cache[k]||[],t=x=>String(x||"").trim().toLowerCase();
const nm=id=>NM[id]||"Person "+String(id).slice(-4);
function sync(){const need=new Set();Object.keys(MODS).forEach(k=>can(k)&&need.add(k));
if(can("stock")||can("dn")||can("so"))["grn","fgr","dn"].forEach(k=>need.add(k));
if(can("dash"))["so","wo","spectro","mtc"].forEach(k=>need.add(k));
Object.keys(unsubs).forEach(k=>{if(!need.has(k)){unsubs[k]();delete unsubs[k];delete cache[k]}});
need.forEach(k=>{if(unsubs[k])return;unsubs[k]=DB.collection("rec_"+k).onSnapshot(s=>{cache[k]=s.docs.map(d=>d.data()).sort((a,b)=>a.id<b.id?-1:1);render()},()=>{})})}
function loadNames(){const ids=[...accList,...reqList].map(x=>x.id);if(!ids.length)return;U.profiles(ids).then(p=>{let ch=0;ids.forEach(i=>{const n=(p[i]&&p[i].name)||"";if(NM[i]!==n){NM[i]=n;ch=1}});if(ch)render()})}
function stock(item){let s=0;D("grn").forEach(r=>t(r.item)==t(item)&&(s+=+r.qty));D("fgr").forEach(r=>t(r.item)==t(item)&&(s+=+r.qty));D("dn").forEach(r=>t(r.item)==t(item)&&(s-=+r.qty));return s}
const judge=c=>{const v=c.filter(x=>x.ach!=="");if(!v.length)return"Pending";return v.every(x=>(x.min===""||+x.ach>=+x.min)&&(x.max===""||+x.ach<=+x.max))?"Pass":"Fail"};
async function add(k,o){o.id=MODS[k].p+"-"+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,4).toUpperCase();o.by=me.id||"";await DB.doc("rec_"+k+"/"+o.id).set(o);return o}
const AL={so:[["so","once"],["so","qty"]],wo:[["wo","multi"],["wo","multi"],["wo","once"]],ind:[["ind","once"]],po:[["po","once"]],spectro:[["spectro","once"]],dn:[["dn","once"]]};
function acts(k,r,i){return(A[k]||[]).map((a,j)=>{const[lf,md]=AL[k][j],L=can(a[1])?D(a[1]).filter(x=>x[lf]==r.id):[],b=`data-a="act" data-k="${k}" data-i="${i}" data-j="${j}"`;
if(md=="once"&&L.length)return`<span class="tag ok" title="${H(L.map(x=>x.id).join(", "))}">✓ ${a[0]}</span> `;
if(md=="qty"){const s=L.reduce((n,x)=>n+ +x.qty,0);if(L.length&&s>=+r.qty)return`<span class="tag ok">✓ Dispatched ${s}/${r.qty} t</span> `;return wr(a[1])?`<button class="btn s" ${b}>+ ${a[0]}${s?` (${s}/${r.qty} t)`:""}</button>`:""}
if(!wr(a[1]))return L.length?`<span class="tag">${a[0]} ×${L.length}</span> `:"";
return`<button class="btn s${L.length?" dn":""}" ${b}>${L.length?"✓ ":"+ "}${a[0]}${L.length>1?" ×"+L.length:""}</button>`}).join("")}
const g=async(k,id)=>{try{const s=await DB.doc("rec_"+k+"/"+id).get();return s.exists?s.data():null}catch(e){return null}};
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
function noAccess(){return msgView(`Hello ${H(me.name||"there")}. You do not have access to any ERP module yet.`,(canW&&me.id?(requested?'<p class="mute">Request sent. The administrator will grant access.</p>':'<button class="btn p" data-a="req">Request access</button>'):'<p class="mute">Ask the administrator to grant you access.</p>'))}
function shell(body){const gs={};Object.keys(MODS).filter(can).forEach(k=>(gs[MODS[k].g]=gs[MODS[k].g]||[]).push(k));
const nav=b=>`<button data-a="nav" data-v="${b[0]}"${S.view==b[0]?' class="on"':""}>${b[1]}</button>`;
return`<header class="top"><button class="hb" data-a="menu" aria-label="Menu" aria-expanded="${S.menu}"><span></span><span></span><span></span></button><b>Foundry ERP</b><span class="mute sm">${H(me.name||"")}${isAdmin?" (admin)":""}</span><button class="btn s" data-a="out">Sign out</button></header>`+(S.menu?`<div class="scrim" data-a="menu"></div><aside class="dr"><h3>Overview</h3>${can("dash")?nav(["dash","Dashboard"]):""}${can("stock")?nav(["stock","Stock"]):""}${Object.keys(gs).map(g=>`<h3>${g}</h3>`+gs[g].map(k=>nav([k,MODS[k].n])).join("")).join("")}${isAdmin?"<h3>Admin</h3>"+nav(["users","Users and access"]):""}</aside>`:"")+`<main>${LOCAL?'<div class="msg">Local mode: data is saved only in this browser. Open the artifact from claude.ai to share data with other users.</div>':""}${canW?"":'<div class="msg">You have view-only access to this page, so changes cannot be saved.</div>'}${body}</main>`}
function dash(){const W=D("wo"),sp=D("spectro"),n=s=>W.filter(w=>w.status==s).length,pass=sp.filter(x=>x.result=="Pass").length,fail=sp.filter(x=>x.result=="Fail").length;
const k=(v,l,c)=>`<div class="kpi ${c||""}"><b>${v}</b><span>${l}</span></div>`,mx=Math.max(1,W.length);
const bar=(l,v,c,m)=>`<div class="row"><span>${l}</span><div class="bar"><i class="${c||""}" style="width:${v/m*100}%"></i></div><b>${v}</b></div>`,q=Math.max(1,sp.length);
return`<h2>Dashboard</h2><div class="kpis">${k(W.length,"Work Orders")}${k(W.length-n("MTC issued"),"Open Work Orders","e")}${k(n("In production"),"In production")}${k(D("so").filter(s=>s.status!="Closed").length,"Open Sales Orders")}${k(pass,"Spectro passed","g")}${k(fail,"Spectro failed","r")}${k(D("mtc").length,"MTC issued","g")}</div>
<div class="grid"><div class="card"><h3>Work Orders by stage</h3>${ST.map(s=>bar(s,n(s),"",mx)).join("")}</div><div class="card"><h3>Quality stages</h3>${bar("Samples tested",sp.length,"q",q)}${bar("Passed",pass,"ok",q)}${bar("Failed (NCR)",fail,"bad",q)}${bar("MTC issued",D("mtc").length,"ok",q)}</div></div>
${!W.length&&isAdmin&&canW?`<div class="card"><p>No data yet.</p><button class="btn p" data-a="demo">Load demo data</button></div>`:""}`}
function stockV(){const m={};["grn","fgr","dn"].forEach(k=>D(k).forEach(r=>{const i=r.item.trim(),o=m[t(i)]||(m[t(i)]={i,in:0,out:0});k=="dn"?o.out+=+r.qty:o.in+=+r.qty}));
const rows=Object.values(m);return`<h2>Stock</h2><p class="mute">Calculated from GRN and Finished Goods Receipts (in) and Dispatch Notes (out).</p><div class="card scroll"><table><thead><tr><th>Item</th><th>In (tons)</th><th>Out (tons)</th><th>Balance</th></tr></thead><tbody>${rows.map(o=>`<tr><td>${H(o.i)}</td><td>${o.in}</td><td>${o.out}</td><td><b>${o.in-o.out}</b></td></tr>`).join("")||'<tr><td colspan="4" class="mute">No stock movements yet.</td></tr>'}</tbody></table></div>`}
function list(k){const m=MODS[k],cs=m.f.filter(f=>f[2]!="spectro").slice(0,6),rs=D(k);
const tg=v=>`<span class="tag ${v=="Pass"?"ok":v=="Fail"||/hold/.test(v)?"bad":""}">${H(v)}</span>`;
return`<div class="bar2"><h2 style="flex:1">${m.n}</h2>${wr(k)?`<button class="btn p" data-a="new" data-k="${k}">New ${m.n}</button>`:'<span class="tag">View only</span>'}</div>${S.msg?`<div class="msg" role="status">${H(S.msg)}</div>`:""}<div class="card scroll"><table><thead><tr><th>No</th>${cs.map(f=>`<th>${f[1]}</th>`).join("")}${k=="spectro"?"<th>Result</th>":""}<th></th></tr></thead><tbody>${rs.map((r,i)=>`<tr class="r" data-a="edit" data-k="${k}" data-i="${i}"><td><b>${r.id}</b></td>${cs.map(f=>`<td>${f[2]=="select"&&f[0]=="status"?tg(r[f[0]]||""):H(r[f[0]])}</td>`).join("")}${k=="spectro"?`<td>${tg(r.result)}</td>`:""}<td>${acts(k,r,i)}</td></tr>`).join("")||`<tr><td colspan="9" class="mute">Nothing here yet.</td></tr>`}</tbody></table></div>`}
function form(){const{k,v,id}=S.form,m=MODS[k];
const fld=([fid,l,ty,op,opt])=>{const x=v[fid]??"";
if(ty=="select")return`<label>${l}<select id="f_${fid}">${op.map(o=>`<option${o==x?" selected":""}>${o}</option>`).join("")}</select></label>`;
if(ty.startsWith("ref:")){const rk=ty.slice(4);return`<label>${l}<select id="f_${fid}">${opt?'<option value="">None</option>':'<option value="">Select...</option>'}${D(rk).map(r=>`<option value="${r.id}"${r.id==x?" selected":""}>${r.id} ${H(r.customer||r.item||r.sample||"")}</option>`).join("")}</select></label>`}
if(ty=="spectro"){const c=x||EL.map(e=>({e,min:"",max:"",ach:""}));return`<div style="grid-column:1/-1"><span class="mute sm">${l} (required range and achieved value)</span><div class="scroll"><table><thead><tr><th>Element</th><th>Min</th><th>Max</th><th>Achieved</th><th>Result</th></tr></thead><tbody>${c.map(r=>`<tr class="sr">${["e","min","max","ach"].map(q=>`<td><input value="${H(r[q])}" ${q=="e"?"":'type="number" step="any"'} aria-label="${q}"></td>`).join("")}<td class="res">-</td></tr>`).join("")}</tbody></table></div></div>`}
return`<label>${l}<input id="f_${fid}" type="${ty}" value="${H(x)}"${ty=="number"?' step="any" min="0"':""}></label>`};
const w=wr(k);return`<h2>${id?(w?"Edit ":"")+id:"New "+m.n}</h2><div class="card"><div class="fg" id="fgd">${m.f.map(fld).join("")}</div><div id="hint" class="mute"></div>${S.err?`<div class="msg bad" role="alert">${H(S.err)}</div>`:""}<div class="bar2">${w?'<button class="btn p" data-a="save">Save</button>':""}<button class="btn" data-a="cancel">${w?"Cancel":"Back"}</button><button class="btn" onclick="print()">Print</button>${id&&isAdmin&&canW?'<button class="btn" data-a="del">Delete</button>':""}</div></div>`}
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
let v=S.view;if(v=="users"&&!isAdmin||(v=="dash"||v=="stock")&&!can(v)||MODS[v]&&!can(v))v=home();
let b;if(S.form&&can(S.form.k))b=form();else if(v=="dash")b=dash();else if(v=="stock")b=stockV();else if(v=="users")b=users();else b=list(v);
a.innerHTML=shell(b);hint();document.querySelectorAll(".sr").forEach(calc);
if(S.form&&!wr(S.form.k))document.querySelectorAll("#fgd input,#fgd select").forEach(x=>x.disabled=true)}
function hint(){const h=$("#hint");if(!h||!S.form||!["so","dn"].includes(S.form.k))return;const i=$("#f_item"),q=$("#f_qty");if(!i)return;const s=stock(i.value),n=+q.value||0;
h.textContent=i.value?`In stock: ${s} tons. `+(S.form.k=="so"?(n>s?`Shortfall ${n-s} tons: create a Work Order for it after saving.`:"Stock covers the full order."):(n>s?"Not enough stock for this dispatch.":"")):""}
function calc(r){const v=[...r.querySelectorAll("input")].map(x=>x.value),c=r.querySelector(".res");if(v[3]===""||(v[1]===""&&v[2]==="")){c.textContent="-";c.className="res";return}
const ok=(v[1]===""||+v[3]>=+v[1])&&(v[2]===""||+v[3]<=+v[2]);c.textContent=ok?"Within range":"Out of range";c.className="res "+(ok?"ok":"bad")}
async function submit(){const{k,id}=S.form,m=MODS[k],o={};let err="";
if(!wr(k))return;
for(const[fid,l,ty,op,opt]of m.f){if(ty=="spectro"){o[fid]=[...document.querySelectorAll(".sr")].map(r=>{const i=r.querySelectorAll("input");return{e:i[0].value.trim(),min:i[1].value,max:i[2].value,ach:i[3].value}}).filter(x=>x.e&&x.ach!=="");if(!o[fid].length)err=err||"Enter at least one achieved value."}
else{o[fid]=$("#f_"+fid).value.trim();if(!o[fid]&&!opt&&ty!="date")err=err||l+" is required."}if(ty=="number"&&+o[fid]<0)err=err||l+" cannot be negative."}
if(k=="spectro")o.result=judge(o.comp);
if(k=="mtc"){const s=D("spectro").find(x=>x.id==o.spectro);if(s&&s.result!="Pass")err=err||"MTC needs a Spectro Report that passed. Quality must decide on failed material first."}
if(k=="dn"&&!id&&+o.qty>stock(o.item))err=err||`Only ${stock(o.item)} tons in stock for this item.`;
if(err){S.err=err;S.form.v=Object.assign(S.form.v,o);render();return}
try{let r;if(id){r={...D(k).find(x=>x.id==id),...o};await DB.doc("rec_"+k+"/"+id).set(r)}else r=await add(k,o);
await chain(k,o);S.msg=r.id+" saved. Linked statuses updated.";if(k=="spectro"&&o.result=="Fail")S.msg=r.id+" failed. Work Order is on hold until Quality decides.";
S.form=null;S.err="";S.view=k}catch(e){S.err="Could not save: "+(e.message||e.code||"error")}render()}
async function setAcc(id,perms,label){await DB.doc("access/"+id).set({perms,label})}
document.addEventListener("click",async e=>{const a=e.target.closest("[data-a]");if(!a)return;const d=a.dataset;
try{switch(d.a){
case"out":await window.signOut();return;case"menu":S.menu=!S.menu;break;
case"retry":await start();return;
case"nav":S={view:d.v,form:null,menu:false,msg:"",err:""};break;
case"new":S.form={k:d.k,v:{status:MODS[d.k].f.find(f=>f[0]=="status")?.[3][0]},id:null};S.err="";S.msg="";break;
case"edit":if(e.target.closest("button"))return;S.form={k:d.k,v:{...D(d.k)[d.i]},id:D(d.k)[d.i].id};S.err="";break;
case"act":{const r=D(d.k)[d.i],x=A[d.k][d.j];S.view=x[1];S.form={k:x[1],v:x[2](r),id:null};S.err="";break}
case"save":await submit();return;case"cancel":S.form=null;S.err="";break;
case"del":if(confirm("Delete "+S.form.id+"?")){await DB.doc("rec_"+S.form.k+"/"+S.form.id).delete();S.form=null}break;
case"demo":await demo();break;
case"req":await DB.doc("requests/"+me.id).set({at:Date.now()});requested=true;break;
case"grant":await setAcc(d.id,{...TPL[d.t].p},TPL[d.t].l);DB.doc("requests/"+d.id).delete().catch(()=>{});break;
case"revoke":if(confirm("Remove access for "+nm(d.id)+"?"))await DB.doc("access/"+d.id).delete();break}}catch(x){S.msg="Action failed: "+(x.message||x.code||"error")}
render()});
document.addEventListener("input",async e=>{const r=e.target.closest(".sr");if(r)calc(r);if(e.target.id=="f_item"||e.target.id=="f_qty")hint();
if(e.target.id=="us"){const q=e.target.value.trim(),f=$("#found");if(q.length<2){f.innerHTML="";return}
const rs=await U.search(q);f.innerHTML=rs.filter(p=>!accList.some(a=>a.id==p.id)).slice(0,6).map(p=>{NM[p.id]=p.name;return`<div class="bar2"><span style="flex:1">${H(p.name)}</span><button class="btn s" data-a="grant" data-id="${p.id}" data-t="viewer">Add as Viewer</button></div>`}).join("")||'<p class="mute sm">No match.</p>'}});
document.addEventListener("change",async e=>{if(!e.target.classList.contains("mx"))return;const c=e.target.closest("[data-uid]"),p={};
c.querySelectorAll(".mx").forEach(s=>{if(s.value!="none")p[s.dataset.k]=s.value});await setAcc(c.dataset.uid,p,"Custom")});
document.addEventListener("keydown",e=>{if(e.key=="Escape"&&S.menu){S.menu=false;render()}});
let DG="",LOCAL=false;
async function start(){boot=0;render();DB=makeDB(window.sb);U=makeU(window.sb);
try{await U.me()}catch(e){DG=e.message||"Profile not found. Did you run schema.sql?";boot=2;render();return}
me=await U.me();isAdmin=!!(me.isOwner||me.canEdit);canW=(await U.can("data.write"))!==false;
if(me.id)DB.doc("access/"+me.id).onSnapshot(s=>{acc=s.exists?s.data():null;sync();render()},()=>{});
if(isAdmin){DB.collection("access").onSnapshot(s=>{accList=s.docs.map(d=>({...d.data(),id:d.id}));loadNames();render()},()=>{});
DB.collection("requests").onSnapshot(s=>{reqList=s.docs.map(d=>({id:d.id}));loadNames();render()},()=>{})}
boot=1;sync();render()}
