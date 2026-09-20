import React,{useEffect,useMemo,useState}from"react";
import{createRoot}from"react-dom/client";
import"./styles.css";

const APPS=[
{id:"gmail",name:"Gmail",icon:"✉",category:"Email"},
{id:"outlook",name:"Outlook",icon:"O",category:"Email"},
{id:"linkedin",name:"LinkedIn",icon:"in",category:"Social"},
{id:"instagram",name:"Instagram",icon:"◎",category:"Social"},
{id:"facebook",name:"Facebook",icon:"f",category:"Social"}
];

function Login({first,onDone}){
 const[f,setF]=useState({name:"",email:"",pin:""}),[mode,setMode]=useState(first?"register":"login"),[err,setErr]=useState("");
 async function submit(e){e.preventDefault();setErr("");let r;if(mode==="register")r=await window.desktop.auth.register(f);else r=await window.desktop.auth.login({email:f.email,pin:f.pin});if(r?.error){setErr(r.error);if(r.needsLogin)setMode("login");}else onDone(r)}
 return <div className="login-screen"><div className="login-card"><button type="button" className="login-close" onClick={()=>window.desktop.app.quit()} aria-label="Close Communication Hub" title="Close">×</button><div className="login-logo">C</div><div className="eyebrow">{mode==="register"?"FIRST TIME SETUP":"WELCOME BACK"}</div><h1>{mode==="register"?"Create your account":"Sign in"}</h1><p>{mode==="register"?"Create the owner account for this installation.":"Sign in to open your communication sidebar."}</p><form onSubmit={submit}>{mode==="register"&&<label>Name<input autoFocus value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Your name"/></label>}<label>Email<input autoFocus={mode==="login"} type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})} placeholder="you@example.com"/></label><label>6-digit PIN<input maxLength="6" inputMode="numeric" type="password" value={f.pin} onChange={e=>setF({...f,pin:e.target.value.replace(/\D/g,"")})} placeholder="••••••"/></label>{err&&<div className="form-error">{err}</div>}<button className="primary full">{mode==="register"?"Create account":"Sign in"}</button></form>{!first&&<button className="switch-auth" onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"Create a new account":"Back to sign in"}</button>}<small>Your account is stored securely on this desktop installation.</small></div></div>
}

function UserAdmin({users,plans,refresh,close,textScale,setTextScale}){
 const[u,setU]=useState(users[0]),[limits,setLimits]=useState(users[0]?.accountLimits||{}),[userAccounts,setUserAccounts]=useState([]),[customLimits,setCustomLimits]=useState({}),[customServiceDefs,setCustomServiceDefs]=useState([]),[customModal,setCustomModal]=useState(false),[tab,setTab]=useState("overview"),[saved,setSaved]=useState(false);
 const urls={gmail:"https://mail.google.com",outlook:"https://outlook.live.com/mail/",linkedin:"https://www.linkedin.com",instagram:"https://www.instagram.com",facebook:"https://www.facebook.com"};
 useEffect(()=>{if(u){setLimits(u.accountLimits||{});Promise.all([window.desktop.accounts.get(u.id),window.desktop.customLimits.get(u.id),window.desktop.customServices.get(u.id)]).then(([a,c,s])=>{setUserAccounts(a);setCustomLimits(c||{});setCustomServiceDefs(s||[])})}},[u]);
 useEffect(()=>{const off=window.desktop.customServices?.onUpdated?.(list=>setCustomServiceDefs(list||[]));const offRemoved=window.desktop.accounts?.onRemoved?.(removed=>{if(removed?.userId===u?.id)setUserAccounts(prev=>prev.filter(a=>a.id!==removed.id))});return()=>{off?.();offRemoved?.()};},[u?.id]);
 async function save(){
  const normalizedLimits={};
  for(const app of APPS) normalizedLimits[app.id]=Math.max(0,Math.min(50,Number(limits[app.id]??0)||0));
  const updatedUser=await window.desktop.users.update({id:u.id,name:u.name,accountLimits:normalizedLimits});
  if(updatedUser?.error){alert(updatedUser.error);return}
  const savedCustomLimits=await window.desktop.customLimits.set({userId:u.id,limits:customLimits});
  if(savedCustomLimits?.error){alert(savedCustomLimits.error);return}
  setLimits(normalizedLimits);
  setCustomLimits(savedCustomLimits||{});
  setU(updatedUser);
  await refresh();
  setSaved(true);
  setTimeout(()=>setSaved(false),1800);
 }
 const count=appId=>userAccounts.filter(a=>a.appId===appId).length;
 async function addServiceAccount(a){const current=count(a.id),max=limits[a.id]??0;if(current>=max){alert(`Account limit reached for ${a.name}.`);return}const list=await window.desktop.accounts.add({userId:u.id,appId:a.id,name:`${a.name} ${current+1}`});if(list?.error){alert(list.error);return}setUserAccounts(list);const created=list.filter(x=>x.appId===a.id).at(-1);if(created)await window.desktop.view.open({appConfig:{...a,url:urls[a.id]},account:created})}
 async function removeAccount(ac){const list=await window.desktop.accounts.remove({userId:u.id,accountId:ac.id});if(list?.error){alert(list.error);return}setUserAccounts(list)}
 async function addCustom(data){const id=`custom-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;const icon=(data.icon||data.name?.[0]||"C").toUpperCase();const service=await window.desktop.customServices.add({userId:u.id,id,name:data.name,url:data.url,icon});if(service?.error){alert(service.error);return}setCustomServiceDefs(prev=>[...prev,service]);const list=await window.desktop.accounts.add({userId:u.id,appId:id,name:data.name,url:data.url,icon,serviceName:data.name,serviceUrl:data.url});if(list?.error){await window.desktop.customServices.remove({userId:u.id,appId:id});setCustomServiceDefs(prev=>prev.filter(x=>x.id!==id));alert(list.error);return}setUserAccounts(list);setCustomLimits(prev=>prev[id]===undefined?{...prev,[id]:20}:prev);setCustomModal(false);const created=list.find(x=>x.appId===id);if(created)await window.desktop.view.open({appConfig:{id,name:data.name,url:data.url,icon,category:"Custom"},account:created})}
 async function addCustomAccount(ac){const current=count(ac.appId),max=customLimits[ac.appId]??20;if(current>=max){alert(`Account limit reached (${max}) for ${ac.name}.`);return}const list=await window.desktop.accounts.add({userId:u.id,appId:ac.appId,name:`${ac.name} ${current+1}`,url:ac.url,icon:ac.icon,serviceName:ac.name,serviceUrl:ac.url});if(list?.error){alert(list.error);return}setUserAccounts(list);const created=list.filter(x=>x.appId===ac.appId).at(-1);if(created)await window.desktop.view.open({appConfig:{id:ac.appId,name:ac.name,url:ac.url,icon:ac.icon,category:"Custom"},account:created})}
 const connected=userAccounts.filter(x=>!String(x.appId||"").startsWith("custom-"));
 const customAccounts=userAccounts.filter(x=>String(x.appId||"").startsWith("custom-"));
 const customServiceMap=new Map(customServiceDefs.map(s=>[s.id,s]));
 customAccounts.forEach(ac=>{if(!customServiceMap.has(ac.appId))customServiceMap.set(ac.appId,{id:ac.appId,name:ac.name||"Custom Service",url:ac.url||"",icon:ac.icon||String(ac.name||"C")[0].toUpperCase()});});
 const customServices=Array.from(customServiceMap.values()).map(s=>({id:s.id,appId:s.id,name:s.name,url:s.url,icon:s.icon||String(s.name||"C")[0].toUpperCase(),category:"Custom"}));
 async function removeCustomService(service){if(!window.confirm(`Remove ${service.name} and all of its connected accounts?`))return;const result=await window.desktop.customServices.remove({userId:u.id,appId:service.id});if(result?.error){alert(result.error);return}setCustomServiceDefs(result||[]);setUserAccounts(prev=>prev.filter(a=>a.appId!==service.id));setCustomLimits(prev=>{const next={...prev};delete next[service.id];return next;});}
 const tabs=[
  ["overview","Overview","⌂"],["plans","Plans & Limits","▣"],["accounts","Connected Accounts","✉"],["about","About","i"]
 ];
 return <div className="settings-shell">
  <header className="settings-header"><div><strong>Settings</strong><small>Manage your profile, plans and connected services</small></div><button className="settings-close" onClick={close}>×</button></header>
  <div className="settings-body">
   <nav className="settings-tabs">{tabs.map(([id,label,icon])=><button key={id} className={tab===id?"active":""} onClick={()=>setTab(id)}><span>{icon}</span><span>{label}</span></button>)}</nav>
   <main className="settings-content">
    {tab==="overview"&&<section className="settings-page"><div className="page-heading"><div><h2>Overview</h2><p>Quick view of this Communication Hub installation.</p></div><span className="status-pill">Local account</span></div><div className="overview-grid"><div className="overview-card"><span className="overview-icon">V</span><div><small>Signed in as</small><strong>{u?.name}</strong><em>{u?.email}</em></div></div><div className="overview-card"><span className="overview-icon">▣</span><div><small>Current plan</small><strong>{u?.plan}</strong><em>{connected.length} connected accounts</em></div></div><div className="overview-card"><span className="overview-icon">◉</span><div><small>Available services</small><strong>{new Set(connected.map(x=>x.appId)).size}</strong><em>Services with an account</em></div></div><div className="overview-card"><span className="overview-icon">+</span><div><small>Custom services</small><strong>{customAccounts.length}</strong><em>Personal web apps</em></div></div></div><div className="settings-info-card"><h3>How it works</h3><p>Use Connected Accounts to sign in to supported services. Services with no connected account stay hidden from the sidebar. Custom websites are managed from the Connected Accounts page and use their own isolated session.</p></div><div className="danger-zone"><div><h3>Clear all local session data</h3><p>Remove all users, connected accounts, saved sessions, custom services, limits and local application data from this desktop. The application will return to the login screen.</p></div><button type="button" className="danger-button" onClick={async()=>{if(window.confirm("Clear all Communication Hub data from this desktop? This cannot be undone.")){await window.desktop.auth.clearData()}}}>Clear all data</button></div></section>}
    {tab==="plans"&&<section className="settings-page"><div className="page-heading"><div><h2>Plans & Limits</h2><p>Edit the account limits for the selected user. Changes are used across the entire app.</p></div>{saved&&<span className="saved-badge">Saved</span>}</div>{u&&<div className="limits-panel"><div className="limit-profile"><span className="avatar large">{u.name[0]}</span><div><strong>{u.name}</strong><small>{u.email}</small></div><span className="limit-edit-hint">All limits editable</span></div><div className="limits-heading"><strong>Service account limits</strong><span>Set 0 to disable a service</span></div>{APPS.map(a=><div className="settings-limit-row" key={a.id}><span className="settings-service-icon">{a.icon}</span><div><strong>{a.name}</strong><small>{count(a.id)} currently connected</small></div><input type="number" min="0" max="50" value={limits[a.id]??0} onChange={e=>{const raw=e.target.value;if(raw===""){setLimits(prev=>({...prev,[a.id]:0}));return}setLimits(prev=>({...prev,[a.id]:Math.max(0,Math.min(50,Number(raw)||0))}))}}/></div> )}{customServices.map(service=><div className="settings-limit-row" key={`limit-${service.id}`}><span className="settings-service-icon">{service.icon||service.name?.[0]||"C"}</span><div><strong>{service.name}</strong><small>{count(service.id)} currently connected</small></div><input type="number" min="0" max="20" value={customLimits[service.id]??20} onChange={e=>{const raw=e.target.value;if(raw===""){setCustomLimits(prev=>({...prev,[service.id]:0}));return}setCustomLimits(prev=>({...prev,[service.id]:Math.max(0,Math.min(20,Number(raw)||0))}))}}/></div>)}<div className="settings-note">Every standard and custom service limit is editable here. Standard services allow up to 50 accounts; custom services allow up to 20.</div><button className="primary save-settings" onClick={save}>Save limits</button></div>}</section>}
    {tab==="accounts"&&<section className="settings-page"><div className="page-heading"><div><h2>Connected Accounts</h2><p>Add, open or remove accounts. Custom websites are managed here too.</p></div><button className="primary small-primary" onClick={()=>setCustomModal(true)}>+ Add custom account</button></div><div className="settings-account-grid large-grid">{APPS.map(a=>{const rows=userAccounts.filter(x=>x.appId===a.id),max=limits[a.id]??0;return <div className="settings-app-card" key={a.id}><div className="settings-app-card-head"><span className="side-icon app-icon">{a.icon}</span><div><b>{a.name}</b><small>{rows.length}/{max} connected</small></div><button disabled={rows.length>=max} onClick={()=>addServiceAccount(a)}>+ Add</button></div>{rows.length===0?<span className="settings-empty">No account connected</span>:rows.map(ac=><div className="settings-account-row" key={ac.id}><span className="avatar">{(ac.email||ac.name||"A")[0].toUpperCase()}</span><span>{ac.email||ac.name}<small>Click to open</small></span><button onClick={()=>window.desktop.view.open({appConfig:{...a,url:urls[a.id]},account:ac})}>Open</button><button className="settings-remove" onClick={()=>removeAccount(ac)}>×</button></div>)}</div>})}</div><div className="connected-custom-section"><div className="connected-custom-heading"><div><h3>Custom Accounts</h3><p>Websites such as Slack, Notion or Teams with their own isolated session.</p></div><button className="primary small-primary custom-add-primary" onClick={()=>setCustomModal(true)}>+ Add custom account</button></div>{customServices.length===0?<div className="empty-settings-state compact-empty"><div>+</div><strong>No custom services</strong><p>Add a website to manage it alongside your connected services.</p></div>:<div className="settings-account-grid large-grid">{customServices.map(service=>{const rows=customAccounts.filter(x=>x.appId===service.id),max=customLimits[service.id]??20;return <div className="settings-app-card" key={service.id}><div className="settings-app-card-head"><span className="side-icon app-icon">{service.icon}</span><div><b>{service.name}</b><small>{rows.length}/{max} connected</small></div><div className="service-card-actions"><button disabled={rows.length>=max} onClick={()=>addCustomAccount(service)}>+ Add</button><button className="settings-remove" title="Remove service" onClick={()=>removeCustomService(service)}>×</button></div></div>{rows.length===0?<span className="settings-empty">No account connected</span>:rows.map(ac=><div className="settings-account-row" key={ac.id}><span className="avatar">{(ac.email||ac.name||"A")[0].toUpperCase()}</span><span>{ac.email||ac.name}<small>Click to open</small></span><button onClick={()=>window.desktop.view.open({appConfig:{id:ac.appId,name:service.name,url:service.url,icon:service.icon,category:"Custom"},account:ac})}>Open</button><button className="settings-remove" onClick={()=>removeAccount(ac)}>×</button></div>)}</div>})}</div>}</div></section>}
    {tab==="about"&&<section className="settings-page"><div className="page-heading"><div><h2>About</h2><p>Communication Hub desktop application.</p></div></div><div className="about-card"><div className="about-logo">C</div><h3>Communication Hub</h3><p>One lightweight desktop workspace for your communication services.</p><div className="about-meta"><span>Version</span><strong>7.5.0</strong><span>Storage</span><strong>Local Electron Store</strong><span>Sessions</span><strong>Isolated per account</strong><span>Author</span><strong>Venu Dhanekula</strong><span>Contact</span><strong>hello@venudhanekula.qzz.io</strong></div></div><div className="text-size-card"><div className="text-size-card-head"><div><h3>Text size</h3><p>Adjust the Communication Hub interface text. The setting is saved for this desktop installation.</p></div><span className="text-size-value">{Math.round(textScale*100)}%</span></div><div className="text-size-control"><button type="button" onClick={()=>setTextScale(Math.max(.85,Math.round((textScale-.05)*100)/100))} disabled={textScale<=.85} aria-label="Decrease text size">A−</button><span className="text-size-scale-label">Small</span><input className="text-size-slider" type="range" min="0.85" max="1.15" step="0.05" value={textScale} onChange={e=>setTextScale(Number(e.target.value))} aria-label="Text size"/><span className="text-size-scale-label">Large</span><button type="button" onClick={()=>setTextScale(Math.min(1.15,Math.round((textScale+.05)*100)/100))} disabled={textScale>=1.15} aria-label="Increase text size">A+</button></div><p className="text-size-help">Default is 100%. Changes apply immediately across the Communication Hub UI, including the sidebar and Settings.</p></div></section>}
   </main>
  </div>
  {customModal&&<CustomAccountModal close={()=>setCustomModal(false)} save={addCustom}/>} 
 </div>
}

function CustomAccountModal({close,save}){
 const[f,setF]=useState({name:"",url:"",icon:""}),[err,setErr]=useState("");
 async function submit(e){e.preventDefault();setErr("");if(!f.name.trim()||!f.url.trim()){setErr("Service name and website URL are required.");return}let url=f.url.trim();if(!/^https?:\/\//i.test(url))url=`https://${url}`;await save({...f,name:f.name.trim(),url})}
 return <div className="modal-backdrop custom-backdrop"><div className="custom-modal"><div className="custom-modal-head"><div><strong>Add account</strong><small>Add a website to your Communication Hub</small></div><button onClick={close}>×</button></div><form onSubmit={submit} className="custom-form"><label>Service name<input autoFocus value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="Slack, Notion, Teams..."/></label><label>Website URL<input value={f.url} onChange={e=>setF({...f,url:e.target.value})} placeholder="https://example.com"/></label><label>Icon / short label<input maxLength="3" value={f.icon} onChange={e=>setF({...f,icon:e.target.value})} placeholder="S"/></label>{err&&<div className="form-error">{err}</div>}<div className="custom-form-actions"><button type="button" onClick={close}>Cancel</button><button className="primary" type="submit">Add account</button></div></form></div></div>
}

function Sidebar({user,onLogout}){
 const[accounts,setAccounts]=useState([]),[selected,setSelected]=useState(null),[popupDirection,setPopupDirection]=useState("down"),[customLimits,setCustomLimits]=useState({}),[customServiceDefs,setCustomServiceDefs]=useState([]);
 const urls={gmail:"https://mail.google.com",outlook:"https://outlook.live.com/mail/",linkedin:"https://www.linkedin.com",instagram:"https://www.instagram.com",facebook:"https://www.facebook.com"};
 const count=a=>accounts.filter(x=>x.appId===(typeof a==="string"?a:a.id)).length;
 useEffect(()=>{
  Promise.all([window.desktop.accounts.get(user.id),window.desktop.customLimits.get(),window.desktop.customServices.get(user.id)]).then(([list,limits,services])=>{
   setAccounts(list);
   setCustomLimits(limits||{});
   setCustomServiceDefs(services||[]);
   // Keep all service cards collapsed on launch. Opening a service is an explicit user action.
   setSelected(null);
  });
  const offUpdated=window.desktop.accounts.onUpdated(updated=>{
   if(updated?.userId===user.id)setAccounts(prev=>{
    const exists=prev.some(a=>a.id===updated.id);
    return exists?prev.map(a=>a.id===updated.id?{...a,...updated}:a):[...prev,updated];
   });
  });
  const offRemoved=window.desktop.accounts.onRemoved(removed=>{
   if(removed?.userId===user.id)setAccounts(prev=>prev.filter(a=>a.id!==removed.id));
  });
  const offCustom=window.desktop.customLimits?.onUpdated?.(limits=>setCustomLimits(limits||{}));
  const offServices=window.desktop.customServices?.onUpdated?.(services=>setCustomServiceDefs(services||[]));
  return ()=>{offUpdated?.();offRemoved?.();offCustom?.();offServices?.()};
 },[user.id]);
 useEffect(()=>{
  const a=APPS.find(x=>x.id===selected);if(!a)return;
  const first=accounts.find(x=>x.appId===a.id);if(first)window.desktop.view.preload({appConfig:{...a,url:urls[a.id]},account:first}).catch(()=>{});
 },[selected,accounts]);
 useEffect(()=>{
  if(!window.desktop.sidebar.resize)return;
  // Resize only when the connected-account set changes. Selecting/expanding
  // a service must never change the native sidebar window height.
  const connectedCount=visibleApps.length;
  const baseHeight=connectedCount===0 ? 250 : Math.min(760, 234 + (connectedCount * 63));
  window.desktop.sidebar.resize(baseHeight);
 },[accounts.length]);
 async function open(a,ac){const url=ac.url||urls[a.id]||"https://www.google.com";await window.desktop.view.open({appConfig:{...a,url},account:ac})}
 async function openSettings(){await window.desktop.sidebar.settingsOpen()}
 const customServices=customServiceDefs.map(s=>({id:s.id,name:s.name,icon:s.icon||String(s.name||"C")[0].toUpperCase(),category:"Custom",url:s.url}));
 const maxFor=a=>String(a.id).startsWith("custom-")?(customLimits[a.id]??20):(user.accountLimits?.[a.id]??0);
 const visibleApps=[...APPS.filter(a=>count(a)>0),...customServices.filter((a,i,self)=>self.findIndex(x=>x.id===a.id)===i)];
 return <aside className="sidebar expanded">
  <div className="profile-top">
   <div className="profile-mini"><div className="profile-avatar">{(user.name||"U")[0].toUpperCase()}</div><div className="profile-details"><strong>{user.name}</strong><span>{user.plan}</span></div></div>
   <div className="profile-actions">
    <button className="top-control minimize-control" onClick={()=>window.desktop.sidebar.minimize()} title="Minimize" aria-label="Minimize"><span className="minimize-glyph"></span></button>
    <button className="top-control logout-control" onClick={onLogout} title="Sign out" aria-label="Sign out"><svg className="logout-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4h6v16h-6"/><path d="M4 12h11"/><path d="m10 8 5 4-5 4"/></svg></button>
   </div>
  </div>
  <div className="side-apps">
   {visibleApps.map(a=><div className="side-app-wrap" key={a.id}>
    <button className={`side-app ${selected===a.id?"selected":""}`} onClick={(e)=>{if(selected===a.id){setSelected(null);return}const r=e.currentTarget.getBoundingClientRect();const spaceBelow=window.innerHeight-r.bottom;const spaceAbove=r.top;setPopupDirection(spaceBelow<230&&spaceAbove>spaceBelow?"up":"down");setSelected(a.id)}}><span className="side-icon app-icon">{a.icon}</span><span className="side-name">{a.name}</span><em>{count(a)}/{maxFor(a)}</em><span className={`chevron ${selected===a.id?"down":""}`} aria-hidden="true"></span></button>
    {selected===a.id&&<div className={`account-list account-popup-${popupDirection}`}>{accounts.filter(x=>x.appId===a.id).map(ac=><div className="account-item" key={ac.id}><button className="account-open" onClick={()=>open(a,ac)}><span className="avatar">{(ac.email||ac.name||"A")[0].toUpperCase()}</span><span>{ac.email||ac.name}<small>Click to open</small></span></button><button className="account-remove" onClick={async e=>{e.stopPropagation();const list=await window.desktop.accounts.remove({userId:user.id,accountId:ac.id});if(list?.error){alert(list.error);return}setAccounts(list);setSelected(null)}} title="Remove account" aria-label="Remove account">×</button></div>)}</div>}
   </div>)}
   {visibleApps.length===0&&<div className="empty-apps"><strong>No apps connected</strong><span>Add an account from Settings to get started.</span></div>}
  </div>
  <div className="side-bottom">
   <button className="settings-control" onClick={openSettings} title="Settings" aria-label="Settings">
    <span className="settings-glyph">⚙</span><b>Settings</b>
   </button>
  </div>
 </aside>
}

function SettingsPage({textScale,setTextScale}){const[users,setUsers]=useState([]),[plans,setPlans]=useState({});async function refresh(){const[u,p]=await Promise.all([window.desktop.users.list(),window.desktop.plans.list()]);setUsers(u);setPlans(p)}useEffect(()=>{refresh()},[]);async function close(){await window.desktop.sidebar.settingsClose()}if(!users.length)return <div className="settings-loading">Loading settings…</div>;return <UserAdmin users={users} plans={plans} refresh={refresh} close={close} textScale={textScale} setTextScale={setTextScale}/>}

function App(){const isSettings=new URLSearchParams(window.location.search).get("settings")==="1";const[state,setState]=useState(null),[checked,setChecked]=useState(false),[textScale,setTextScaleState]=useState(1);
 useEffect(()=>{let active=true;window.desktop.uiSettings.get().then(v=>{if(active){const n=Number(v)||1;setTextScaleState(n);document.documentElement.style.setProperty("--text-scale",String(n))}});const off=window.desktop.uiSettings.onUpdated(v=>{const n=Number(v)||1;setTextScaleState(n);document.documentElement.style.setProperty("--text-scale",String(n))});return()=>{active=false;off?.()}},[]);
 async function setTextScale(v){const n=Math.max(.85,Math.min(1.15,Number(v)||1));document.documentElement.style.setProperty("--text-scale",String(n));setTextScaleState(n);await window.desktop.uiSettings.set(n)}
 useEffect(()=>{window.desktop.auth.status().then(async s=>{if(s.loggedIn)setState(await window.desktop.auth.current());else setState({login:true,first:!s.hasUsers});setChecked(true)})},[]);
 if(isSettings)return <SettingsPage textScale={textScale} setTextScale={setTextScale}/>;if(!checked)return null;if(state?.login)return <Login first={state.first} onDone={u=>setState(u)}/>;return <Sidebar user={state} onLogout={async()=>{await window.desktop.auth.logout();setState({login:true,first:false})}}/>}
createRoot(document.getElementById("root")).render(<App/>);
