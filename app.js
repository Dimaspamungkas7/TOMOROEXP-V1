/* Expiry Monitor starter. Configure config.js and apply schema.sql first. */
(() => {
  const cfg = window.EXPIRY_CONFIG || {};
  const ready = cfg.supabaseUrl && cfg.supabaseAnonKey &&
    !cfg.supabaseUrl.includes("PASTE_") && !cfg.supabaseAnonKey.includes("PASTE_");
  const $ = (id) => document.getElementById(id);
  const CATEGORIES = ["Milk","Pastry","Premade","Cloud","Chemical","Tea","Powder","Syrup"];
  let sb, session, profile, currentStore = null, stores = [], masters = [], products = [], history = [];
  let audioEnabled = false, audioCtx = null, alarmSignature = "", alarmTimer = null, alarmSnoozedUntil = 0;
  const warned = new Set();
  const roleNames = {super_admin:"Super Admin",area_manager:"Area Manager",store_user:"User Toko"};
  const fmt = (d) => new Date(d).toLocaleString("id-ID",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
  const monthNow = () => new Date().toISOString().slice(0,7);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const toast = (msg, error=false) => { const el=$("toast"); el.textContent=msg; el.classList.toggle("error",error); el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"),4000); };
  const show = (id, yes=true) => $(id).classList.toggle("hidden",!yes);
  const setBusy = (form,busy) => { const b=form.querySelector('button[type="submit"],button:not([type])'); if(b){b.disabled=busy;b.dataset.old ||= b.textContent;b.textContent=busy?"Memproses…":b.dataset.old;} };
  const categoryOptions = (selected="") => CATEGORIES.map(c=>`<option ${c===selected?"selected":""}>${c}</option>`).join("");
  const authEmail = (code) => `${String(code).trim().toLowerCase()}@expiry.local`;

  async function init(){
    if(!ready || !window.supabase){ $("loginForm").querySelector("button").disabled=true; toast("Isi config.js dengan URL dan anon key Supabase terlebih dahulu.",true); return; }
    sb = window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
    $("regCategory").innerHTML=categoryOptions(); $("addCategory").innerHTML=categoryOptions();
    $("historyMonth").value=monthNow();
    bindUI();
    const {data:{session:s}}=await sb.auth.getSession();
    if(s) await enterApp(s);
  }
  function bindUI(){
    $("loginForm").addEventListener("submit",login);
    $("logoutBtn").addEventListener("click",logout);
    $("nav").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)goPage(b.dataset.page);});
    document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>{if(b.dataset.goto==="add"){goPage("monitor");show("addPanel",true);}else goPage(b.dataset.goto);}));
    document.querySelectorAll("[data-close-add]").forEach(b=>b.addEventListener("click",()=>show("addPanel",false)));
    $("storeSelect").addEventListener("change",async e=>{currentStore=stores.find(s=>s.id===e.target.value)||null;alarmSignature="";await loadStoreData();});
    $("regCategory").addEventListener("change",()=>{});
    $("addCategory").addEventListener("change",populateMasterDropdown);
    $("registerForm").addEventListener("submit",registerProduct);
    $("addForm").addEventListener("submit",addProduct);
    $("historyMonth").addEventListener("change",renderHistory);
    $("historyStatus").addEventListener("change",renderHistory);
    $("exportBtn").addEventListener("click",exportExcel);
    $("soundToggle").addEventListener("click",enableAudio);
    $("createStoreForm").addEventListener("submit",createStore);
    $("createManagerForm").addEventListener("submit",createManager);
    $("masterList").addEventListener("click",deleteMaster);
    $("monitorProducts").addEventListener("click",resolveProduct);
    $("dashboardProducts").addEventListener("click",resolveProduct);
    $("historyTable").addEventListener("click",resolveProduct);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)renderProducts();});
  }
  async function login(e){
    e.preventDefault();
    const code=$("loginCode").value.trim(), password=$("loginPassword").value;
    try{
      const {data,error}=await sb.auth.signInWithPassword({email:authEmail(code),password});
      if(error) throw error;
      await enterApp(data.session);
} catch (err) {
  console.error("Login error:", err);
  toast(`Login gagal: ${err.message || "Error tidak diketahui"}`, true);
}  }
  async function logout(){if(alarmTimer)clearInterval(alarmTimer);await sb.auth.signOut();session=null;profile=null;show("appView",false);show("loginView",true);}
  async function enterApp(s){
    session=s;
    const {data:p,error}=await sb.from("profiles").select("*").eq("id",s.user.id).single();
    if(error||!p){await sb.auth.signOut();toast("Profil akun tidak ditemukan. Hubungi admin.",true);return;}
    profile=p;
    $("identity").innerHTML=`<b>${esc(p.display_name||p.login_code)}</b><br>${esc(roleNames[p.role]||p.role)}<br><span class="muted">${esc(p.login_code||"")}</span>`;
    $("roleLabel").textContent=roleNames[p.role]||p.role;
    show("loginView",false);show("appView",true);
    document.querySelectorAll(".admin-only").forEach(el=>show(el,p.role!=="store_user"));
    document.querySelectorAll(".super-only").forEach(el=>show(el,p.role==="super_admin"));
    show("storePicker",p.role!=="store_user");
    if(p.role==="store_user"){
      const {data:st}=await sb.from("stores").select("*").eq("id",p.store_id).single();
      currentStore=st;stores=st?[st]:[];
    }else{
      let q=sb.from("stores").select("*").eq("active",true).order("code");
      if(p.role==="area_manager")q=q.eq("area_id",p.area_id);
      const {data,error:e2}=await q;if(e2)throw e2;stores=data||[];
      $("storeSelect").innerHTML=stores.map(st=>`<option value="${st.id}">${esc(st.code)} — ${esc(st.name)}</option>`).join("");
      currentStore=stores[0]||null;
      if(currentStore)$("storeSelect").value=currentStore.id;
    }
    $("statStores").textContent=p.role==="store_user"?"1":stores.length;
    goPage("dashboard");
    await loadStoreData();
    if(alarmTimer)clearInterval(alarmTimer);
    alarmTimer=setInterval(()=>{renderProducts();checkAlarms();},1000);
    subscribeRealtime();
  }
  function subscribeRealtime(){
    sb.removeAllChannels();
    const channel=sb.channel("expiry-live-"+profile.id)
      .on("postgres_changes",{event:"*",schema:"public",table:"monitored_products"},async()=>{await loadStoreData();})
      .on("postgres_changes",{event:"*",schema:"public",table:"product_catalog"},async()=>{await loadMasters();})
      .on("postgres_changes",{event:"*",schema:"public",table:"transactions"},async()=>{await loadHistory();renderStats();renderHistory();});
    channel.subscribe();
  }
  async function loadStoreData(){await loadMasters();await loadProducts();await loadHistory();renderAll();}
  async function loadMasters(){
    if(!currentStore){masters=[];renderMasterList();populateMasterDropdown();return;}
    const {data,error}=await sb.from("product_catalog").select("*").eq("store_id",currentStore.id).eq("active",true).order("category").order("name");
    if(error){toast("Gagal memuat master produk: "+error.message,true);return;}
    masters=data||[];renderMasterList();populateMasterDropdown();
  }
  async function loadProducts(){
    if(!currentStore){products=[];return;}
    const {data,error}=await sb.from("monitored_products").select("*, product_catalog(name,category)").eq("store_id",currentStore.id).in("status",["active","expired"]).order("expires_at");
    if(error){toast("Gagal memuat produk: "+error.message,true);return;}
    products=data||[];
  }
  async function loadHistory(){
    if(!currentStore){history=[];return;}
    const {data,error}=await sb.from("transactions").select("*").eq("store_id",currentStore.id).order("created_at",{ascending:false}).limit(5000);
    if(error){toast("Gagal memuat history: "+error.message,true);return;}
    history=data||[];
  }
  function renderAll(){renderStats();renderProducts();renderHistory();renderMasterList();}
  function goPage(page){
    if(page==="add"){show("addPanel",true);page="monitor";}
    document.querySelectorAll(".page").forEach(el=>show(el.id==="page-"+page));
    document.querySelectorAll("[data-page]").forEach(el=>el.classList.toggle("active",el.dataset.page===page));
    const titles={dashboard:["Dashboard","Ringkasan kondisi holding time."],monitor:["Holding Time","Daftar countdown produk pada toko terpilih."],register:["Register Product","Kelola master produk untuk dropdown."],history:["History & Rekap","Lacak transaksi Used/Waste dan unduh Excel."],stores:["Data Toko","Daftar toko dalam area tanggung jawab."],accounts:["Manajemen Akun","Pembuatan akun sesuai hak akses."]};
    $("pageTitle").textContent=titles[page]?.[0]||"Dashboard";$("pageSubtitle").textContent=titles[page]?.[1]||"";
    if(page==="stores")renderStores();
  }
  function productStatus(p){
    if(p.status==="used")return {key:"used",label:"Used"};
    if(p.status==="waste")return {key:"waste",label:"Waste"};
    const ms=new Date(p.expires_at).getTime()-Date.now();
    if(ms<=0)return {key:"expired",label:"Expired"};
    if(ms<=Number(p.warning_minutes||5)*60000)return {key:"warning",label:"Warning"};
    return {key:"safe",label:"Aman"};
  }
  function timeLeft(p){
    let ms=new Date(p.expires_at).getTime()-Date.now();
    if(ms<=0)return "SUDAH EXPIRED";
    const d=Math.floor(ms/86400000);ms%=86400000;const h=Math.floor(ms/3600000);ms%=3600000;const m=Math.floor(ms/60000);const s=Math.floor(ms%60000/1000);
    return `${d?d+"h ":""}${h?String(h).padStart(2,"0")+":" : ""}${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }
  function productName(p){return p.product_catalog?.name||p.product_name||"Produk";}
  function productCard(p){
    const st=productStatus(p);
    return `<article class="product-card ${st.key==="warning"?"warning":st.key==="expired"?"expired":""}"><h3>${esc(productName(p))}</h3><div class="meta">${esc(p.product_catalog?.category||p.category||"")} · Rak ${esc(p.location||"-")}<br>Qty: ${esc(p.qty)} ${esc(p.unit)}<br>Expired: ${fmt(p.expires_at)}</div><div class="timer">${timeLeft(p)}</div><span class="status ${st.key}">${st.label}</span>${["active","expired"].includes(p.status)?`<div class="alarm-actions"><button class="secondary" data-action="used" data-id="${p.id}">Used</button><button class="danger" data-action="waste" data-id="${p.id}">Waste</button></div>`:""}</article>`;
  }
  function renderProducts(){
    const active=products.filter(p=>["active","expired"].includes(p.status));
    $("monitorProducts").innerHTML=active.length?active.map(productCard).join(""):`<div class="empty-state">Belum ada produk yang sedang dihitung. Klik Add Product untuk memulai.</div>`;
    $("dashboardProducts").className="product-list";
    $("dashboardProducts").innerHTML=active.slice(0,6).map(p=>`<div class="product-row"><div><h3>${esc(productName(p))}</h3><p>${esc(p.location||"-")} · ${esc(p.qty)} ${esc(p.unit)} · ${esc(productStatus(p).label)}</p></div><div class="timer">${timeLeft(p)}</div></div>`).join("")||`<div class="empty-state">Belum ada produk aktif.</div>`;
    checkAlarms();
  }
  function renderStats(){
    const active=products.filter(p=>p.status==="active").length;
    const warning=products.filter(p=>productStatus(p).key==="warning").length;
    const expired=products.filter(p=>productStatus(p).key==="expired").length;
    const m=monthNow();const tx=history.filter(t=>String(t.created_at).slice(0,7)===m);
    const used=tx.filter(t=>t.disposition==="used").reduce((a,t)=>a+Number(t.qty),0);
    const waste=tx.filter(t=>t.disposition==="waste").reduce((a,t)=>a+Number(t.qty),0);
    $("statActive").textContent=active;$("statWarning").textContent=warning;$("statExpired").textContent=expired;
    $("statWaste").textContent=waste.toLocaleString("id-ID");$("statWasteUnit").textContent="unit bulan ini";
    $("summaryUsed").textContent=used.toLocaleString("id-ID");$("summaryWaste").textContent=waste.toLocaleString("id-ID");
    const total=used+waste||1;$("usedBar").style.width=(used/total*100)+"%";$("wasteBar").style.width=(waste/total*100)+"%";
    $("statStores").textContent=profile?.role==="store_user"?"1":stores.length;
  }
  function populateMasterDropdown(){
    const cat=$("addCategory").value||CATEGORIES[0];
    const items=masters.filter(m=>m.category===cat);
    $("addMasterProduct").innerHTML=items.map(m=>`<option value="${m.id}" data-unit="${esc(m.default_unit)}">${esc(m.name)}</option>`).join("");
    if(!items.length)$("addMasterProduct").innerHTML='<option value="">Belum ada produk di kategori ini</option>';
    const opt=$("addMasterProduct").selectedOptions[0];if(opt?.dataset.unit)$("addUnit").value=opt.dataset.unit;
  }
  async function registerProduct(e){
    e.preventDefault();if(!currentStore){toast("Tidak ada toko aktif.",true);return;}
    const form=e.currentTarget;setBusy(form,true);
    try{
      const payload={store_id:currentStore.id,category:$("regCategory").value,name:$("regName").value.trim(),default_unit:$("regUnit").value,active:true,created_by:session.user.id};
      const {error}=await sb.from("product_catalog").insert(payload);if(error)throw error;
      $("regName").value="";await loadMasters();toast("Produk berhasil diregistrasi. Countdown belum dimulai.");
    }catch(err){toast("Gagal register produk: "+err.message,true);}finally{setBusy(form,false);}
  }
  async function addProduct(e){
    e.preventDefault();if(!currentStore){toast("Pilih toko terlebih dahulu.",true);return;}
    const masterId=$("addMasterProduct").value;if(!masterId){toast("Pilih atau register produk terlebih dahulu.",true);return;}
    const expiry=new Date(`${$("addExpiryDate").value}T${$("addExpiryTime").value}:00`);
    if(Number.isNaN(expiry.getTime())){toast("Tanggal/jam expired tidak valid.",true);return;}
    const form=e.currentTarget;setBusy(form,true);
    try{
      const m=masters.find(x=>x.id===masterId);
      const payload={store_id:currentStore.id,master_product_id:masterId,qty:Number($("addQty").value),unit:$("addUnit").value,location:$("addLocation").value.trim(),expires_at:expiry.toISOString(),note:$("addNote").value.trim(),status:"active",warning_minutes:5,created_by:session.user.id};
      const {error}=await sb.from("monitored_products").insert(payload);if(error)throw error;
      $("addNote").value="";await loadStoreData();show("addPanel",false);toast(`Countdown ${m?.name||"produk"} dimulai.`);
    }catch(err){toast("Gagal menambahkan produk: "+err.message,true);}finally{setBusy(form,false);}
  }
  async function resolveProduct(e){
    const b=e.target.closest("[data-action]");if(!b)return;
    const p=products.find(x=>x.id===b.dataset.id);if(!p)return;
    const disposition=b.dataset.action;if(!confirm(`Catat ${p.qty} ${p.unit} ${productName(p)} sebagai ${disposition.toUpperCase()}?`))return;
    try{
      const {error}=await sb.from("transactions").insert({store_id:p.store_id,monitored_product_id:p.id,product_name:productName(p),category:p.product_catalog?.category||"",qty:Number(p.qty),unit:p.unit,disposition,acted_by:session.user.id});
      if(error)throw error;
      const {error:updateError}=await sb.from("monitored_products").update({status:disposition,resolved_at:new Date().toISOString(),resolved_by:session.user.id}).eq("id",p.id);
      if(updateError)throw updateError;
      await loadStoreData();toast(`Transaksi ${disposition.toUpperCase()} berhasil dicatat.`);
    }catch(err){toast("Gagal menyimpan transaksi: "+err.message,true);}
  }
  async function deleteMaster(e){
    const b=e.target.closest("[data-delete-master]");if(!b)return;
    if(!confirm("Nonaktifkan produk master ini? Riwayat lama tetap tersimpan."))return;
    const {error}=await sb.from("product_catalog").update({active:false}).eq("id",b.dataset.deleteMaster);
    if(error)toast(error.message,true);else{await loadMasters();toast("Produk master dinonaktifkan.");}
  }
  function renderMasterList(){
    if(!masters.length){$("masterList").innerHTML='<div class="empty-state">Belum ada master produk.</div>';return;}
    $("masterList").innerHTML=`<table><thead><tr><th>Kategori</th><th>Nama</th><th>Satuan</th><th>Aksi</th></tr></thead><tbody>${masters.map(m=>`<tr><td>${esc(m.category)}</td><td>${esc(m.name)}</td><td>${esc(m.default_unit)}</td><td><button class="danger" data-delete-master="${m.id}">Nonaktifkan</button></td></tr>`).join("")}</tbody></table>`;
  }
  function renderHistory(){
    const month=$("historyMonth").value,status=$("historyStatus").value;
    const rows=history.filter(t=>(!month||String(t.created_at).slice(0,7)===month)&&(!status||t.disposition===status));
    $("historyTable").innerHTML=rows.length?`<table><thead><tr><th>Tanggal</th><th>Produk</th><th>Kategori</th><th>Jumlah</th><th>Status</th><th>Dicatat oleh</th></tr></thead><tbody>${rows.map(t=>`<tr><td>${fmt(t.created_at)}</td><td>${esc(t.product_name)}</td><td>${esc(t.category||"-")}</td><td>${esc(t.qty)} ${esc(t.unit)}</td><td><span class="status ${t.disposition}">${t.disposition.toUpperCase()}</span></td><td>${esc(t.acted_by_name||t.acted_by||"-")}</td></tr>`).join("")}</tbody></table>`:`<div class="empty-state">Tidak ada transaksi pada filter ini.</div>`;
    renderStats();
  }
  async function exportExcel(){
    const month=$("historyMonth").value,status=$("historyStatus").value;
    const rows=history.filter(t=>(!month||String(t.created_at).slice(0,7)===month)&&(!status||t.disposition===status));
    if(!rows.length){toast("Tidak ada data untuk diekspor.",true);return;}
    // Generate a real .xlsx workbook using SheetJS loaded on demand.
    try{
      if(!window.XLSX){await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});}
      const data=[["Tanggal","Kode Toko","Produk","Kategori","Jumlah","Satuan","Status","User ID"],...rows.map(t=>[fmt(t.created_at),currentStore?.code||"",t.product_name,t.category||"",Number(t.qty),t.unit,t.disposition.toUpperCase(),t.acted_by||""])];
      const ws=XLSX.utils.aoa_to_sheet(data);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"History");XLSX.writeFile(wb,`expiry-history-${currentStore?.code||"store"}-${month||"all"}.xlsx`);toast("File Excel berhasil dibuat.");
    }catch(err){toast("Export Excel gagal. Periksa koneksi internet.",true);}
  }
  async function createStore(e){
    e.preventDefault();const f=e.currentTarget;setBusy(f,true);
    try{
      const result=await callManageUser({action:"create_store",code:$("newStoreCode").value.trim(),name:$("newStoreName").value.trim(),password:$("newStorePassword").value});
      toast("Akun toko berhasil dibuat.");f.reset();await reloadStores();
    }catch(err){toast("Gagal membuat toko: "+err.message,true);}finally{setBusy(f,false);}
  }
  async function createManager(e){
    e.preventDefault();const f=e.currentTarget;setBusy(f,true);
    try{
      const result=await callManageUser({action:"create_manager",code:$("newManagerCode").value.trim(),name:$("newManagerName").value.trim(),areaName:$("newAreaName").value.trim(),password:$("newManagerPassword").value});
      toast("Akun Area Manager berhasil dibuat.");f.reset();
    }catch(err){toast("Gagal membuat Area Manager: "+err.message,true);}finally{setBusy(f,false);}
  }
  async function callManageUser(body){
    const {data:{session:s}}=await sb.auth.getSession();
    const {data,error}=await sb.functions.invoke("manage-user",{body,headers:{Authorization:`Bearer ${s.access_token}`}});
    if(error)throw new Error(error.message);if(data?.error)throw new Error(data.error);return data;
  }
  async function reloadStores(){
    let q=sb.from("stores").select("*").eq("active",true).order("code");if(profile.role==="area_manager")q=q.eq("area_id",profile.area_id);
    const {data,error}=await q;if(error)throw error;stores=data||[];$("storeSelect").innerHTML=stores.map(st=>`<option value="${st.id}">${esc(st.code)} — ${esc(st.name)}</option>`).join("");currentStore=stores[0]||null;await loadStoreData();renderStores();
  }
  function renderStores(){
    const list=stores||[];$("storesTable").innerHTML=list.length?`<table><thead><tr><th>Kode</th><th>Nama Toko</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${list.map(st=>`<tr><td>${esc(st.code)}</td><td>${esc(st.name)}</td><td><span class="status safe">Aktif</span></td><td><button class="secondary" data-select-store="${st.id}">Pantau</button></td></tr>`).join("")}</tbody></table>`:`<div class="empty-state">Belum ada toko.</div>`;
    $("storesTable").querySelectorAll("[data-select-store]").forEach(b=>b.addEventListener("click",async()=>{currentStore=stores.find(s=>s.id===b.dataset.selectStore);$("storeSelect").value=currentStore.id;await loadStoreData();goPage("dashboard");}));
  }
  async function enableAudio(){
    try{audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();await audioCtx.resume();audioEnabled=true;$("soundToggle").textContent="Audio aktif";toast("Audio diaktifkan. Pastikan volume perangkat cukup.");checkAlarms();}
    catch(e){toast("Browser tidak mengizinkan audio. Coba tekan tombol lagi.",true);}
  }
  function siren(){
    if(!audioEnabled||!audioCtx)return;
    const now=audioCtx.currentTime;
    [0,0.24,0.48].forEach((offset,i)=>{const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type="sawtooth";osc.frequency.setValueAtTime(i%2?950:650,now+offset);osc.frequency.linearRampToValueAtTime(i%2?650:950,now+offset+0.18);gain.gain.setValueAtTime(0.0001,now+offset);gain.gain.linearRampToValueAtTime(0.22,now+offset+0.03);gain.gain.exponentialRampToValueAtTime(0.0001,now+offset+0.2);osc.connect(gain);gain.connect(audioCtx.destination);osc.start(now+offset);osc.stop(now+offset+0.21);});
  }
  function checkAlarms(){
    if(!profile||!currentStore)return;
    const imminents=products.filter(p=>p.status==="active"&&new Date(p.expires_at).getTime()>Date.now()&&new Date(p.expires_at).getTime()-Date.now()<=Number(p.warning_minutes||5)*60000);
    const expired=products.filter(p=>p.status==="active"&&new Date(p.expires_at).getTime()<=Date.now());
    const all=[...expired,...imminents];
    const signature=all.map(p=>p.id+":"+productStatus(p).key).sort().join("|");
    if(signature&&signature!==alarmSignature&&Date.now()>alarmSnoozedUntil){
      alarmSignature=signature;
      if(audioEnabled)siren();
      if(all.length){
        const msg=expired.length?`${expired.length} produk sudah expired.`:`Perhatian! Terdapat ${imminents.length} produk yang akan memasuki masa expired.`;
        toast(msg,expired.length>0);
        if("speechSynthesis" in window && audioEnabled){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(expired.length?`Perhatian! ${expired.length} produk sudah expired.`:`Perhatian! Terdapat ${imminents.length} produk yang akan memasuki masa expired.`);u.lang="id-ID";u.rate=0.95;speechSynthesis.speak(u);}
      }
    }
    if(!signature)alarmSignature="";
  }
  // Snooze UI hook reserved for the next iteration; currently changing store resets alarm signature.
  async function unusedSnooze(){alarmSnoozedUntil=Date.now()+5*60*1000;alarmSignature="";}
  async function deleteUnused(){}
  init().catch(e=>toast("Terjadi kesalahan awal: "+e.message,true));
})();
