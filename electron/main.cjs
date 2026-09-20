const { app, BrowserWindow, BrowserView, ipcMain, Tray, Menu, nativeImage, screen, session } = require("electron");
const path = require("path");
const APP_ICON = path.join(__dirname, "../assets/communication-hub-icon.ico");
const APP_ICON_PNG = path.join(__dirname, "../assets/communication-hub-icon.png");
const CONTEXT_ICON_DIR = path.join(__dirname, "../assets/context-icons");
const { pathToFileURL } = require("url");
const Store = require("electron-store").default;

const store = new Store();
let mainWindow, appWindow, settingsWindow, tray;
let appView = null;
let activeAppContext = null;
let sidebarHeight = 300;
const viewCache = new Map();
const isDev = !app.isPackaged;

function normalizeAccount(a){
  if(!a)return a;
  return {id:a.id,userId:a.userId||a.user_id,appId:a.appId||a.app_id,name:a.name||"Account",email:a.email||"",url:a.url||"",icon:a.icon||"",createdAt:a.createdAt||a.created_at};
}

const defaultApps = [
  { id:"gmail", name:"Gmail", url:"https://mail.google.com", icon:"✉", category:"Email" },
  { id:"outlook", name:"Outlook", url:"https://outlook.live.com/mail/", icon:"O", category:"Email" },
  { id:"linkedin", name:"LinkedIn", url:"https://www.linkedin.com", icon:"in", category:"Social" },
  { id:"instagram", name:"Instagram", url:"https://www.instagram.com", icon:"◎", category:"Social" },
  { id:"facebook", name:"Facebook", url:"https://www.facebook.com", icon:"f", category:"Social" }
];

const plans = {
  Free:{gmail:1,outlook:1,linkedin:0,instagram:0,facebook:0},
  Starter:{gmail:2,outlook:2,linkedin:1,instagram:1,facebook:1},
  Pro:{gmail:5,outlook:5,linkedin:3,instagram:3,facebook:3},
  Business:{gmail:10,outlook:10,linkedin:5,instagram:5,facebook:5}
};

function users(){ return store.get("users", []); }
function saveUsers(v){ store.set("users",v); return v; }
function accounts(){ return store.get("accounts",[]); }
function saveAccounts(v){ store.set("accounts",v); return v; }
function customLimitsFor(userId){ return store.get(`customLimits.${userId}`,{}); }
function customServicesFor(userId){
  const stored=store.get(`customServices.${userId}`,[]);
  const derived=accounts().filter(a=>a.userId===userId&&String(a.appId||"").startsWith("custom-")).map(a=>({id:a.appId,name:a.serviceName||a.name||"Custom Service",url:a.serviceUrl||a.url||"",icon:a.icon||String(a.name||"C").slice(0,1)}));
  const map=new Map(stored.map(s=>[s.id,s]));
  for(const service of derived) if(!map.has(service.id)) map.set(service.id,service);
  const merged=Array.from(map.values());
  if(JSON.stringify(merged)!==JSON.stringify(stored)) store.set(`customServices.${userId}`,merged);
  return merged;
}
function saveCustomServicesFor(userId,services){ store.set(`customServices.${userId}`,services||[]); return services||[]; }
function upsertCustomService(userId,service){
  const list=customServicesFor(userId);
  const normalized={id:String(service.id),name:String(service.name||"Custom Service").trim(),url:String(service.url||"").trim(),icon:String(service.icon||String(service.name||"C").slice(0,1)).trim()};
  const i=list.findIndex(x=>x.id===normalized.id);
  if(i>=0) list[i]={...list[i],...normalized}; else list.push(normalized);
  saveCustomServicesFor(userId,list);
  return normalized;
}
function removeCustomServiceFor(userId,appId){
  const list=customServicesFor(userId).filter(x=>x.id!==appId);
  saveCustomServicesFor(userId,list);
  const limits=customLimitsFor(userId);
  delete limits[appId];
  store.set(`customLimits.${userId}`,limits);
  return list;
}
function getTextScale(){
  const value=Number(store.get("ui.textScale",1));
  return Number.isFinite(value)?Math.max(0.85,Math.min(1.15,value)):1;
}
function setTextScale(value){
  const n=Math.max(0.85,Math.min(1.15,Number(value)||1));
  store.set("ui.textScale",n);
  return n;
}

function setCustomLimitsFor(userId,limits){
  const normalized={};
  for(const [appId,value] of Object.entries(limits||{})){
    if(String(appId).startsWith("custom-")){
      const n=Math.max(0,Math.min(20,Number(value)||0));
      normalized[appId]=n;
    }
  }
  store.set(`customLimits.${userId}`,normalized);
  return normalized;
}
function currentUserId(){ return store.get("currentUserId",null); }
function currentUser(){ return users().find(u=>u.id===currentUserId()) || null; }
function publicUser(u){ if(!u)return null; const {pin,...safe}=u; return safe; }

function registerOwner(p){
  if(users().length) return {error:"A user already exists. Please sign in."};
  const u={id:`USR-${Date.now()}`,name:p.name.trim(),email:p.email.trim().toLowerCase(),pin:p.pin,role:"owner",plan:"Starter",status:"active",accountLimits:{...plans.Starter},createdAt:new Date().toISOString()};
  saveUsers([u]); store.set("currentUserId",u.id); return publicUser(u);
}
function login(p){
  const u=users().find(x=>x.email===p.email.trim().toLowerCase() && x.pin===p.pin);
  if(!u)return {error:"Invalid email or PIN."};
  if(u.status!=="active")return {error:"This account is inactive."};
  store.set("currentUserId",u.id); return publicUser(u);
}
function createManagedUser(p){
  const list=users();
  if(list.some(u=>u.email===p.email.trim().toLowerCase()))return {error:"A user with this email already exists."};
  const plan=plans[p.plan]?p.plan:"Starter";
  const u={id:`USR-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:p.name.trim(),email:p.email.trim().toLowerCase(),pin:p.pin||"123456",role:"user",plan,status:"active",accountLimits:{...plans[plan]},createdAt:new Date().toISOString()};
  list.push(u);saveUsers(list);return publicUser(u);
}
function setUser(p){
  const list=users(),i=list.findIndex(x=>x.id===p.id);if(i<0)return {error:"User not found."};
  if(p.name)list[i].name=p.name.trim();
  if(p.status)list[i].status=p.status;
  if(p.plan&&plans[p.plan]){list[i].plan=p.plan;list[i].accountLimits={...plans[p.plan]};}
  if(p.accountLimits)list[i].accountLimits={...list[i].accountLimits,...p.accountLimits};
  saveUsers(list);
  const updated=publicUser(list[i]);
  if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("user:updated",updated);
  if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("user:updated",updated);
  return updated;
}

function setLoginBounds(){
  if(!mainWindow)return;
  const display=screen.getPrimaryDisplay(); const area=display.workArea;
  const width=420; const height=Math.min(760, area.height-40);
  const x=area.x+Math.floor((area.width-width)/2); const y=area.y+Math.floor((area.height-height)/2);
  mainWindow.setResizable(false); mainWindow.setAlwaysOnTop(false);
  mainWindow.setBounds({x,y,width,height},false); mainWindow.show(); mainWindow.focus();
}

function setSidebarBounds(heightOverride){
  if(!mainWindow)return;
  const display=screen.getPrimaryDisplay(); const area=display.workArea;
  const width=Math.min(300, Math.max(260, area.width-24));
  const requested=Number(heightOverride);
  if(Number.isFinite(requested) && requested>0) sidebarHeight=requested;
  const height=Math.min(Math.max(sidebarHeight, 220), area.height-20);
  const y=area.y+Math.floor((area.height-height)/2);
  mainWindow.setBounds({x:area.x+area.width-width,y,width,height},false);
}
function resizeSidebar(height){
  if(!mainWindow || mainWindow.isDestroyed())return false;
  setSidebarBounds(height);
  return true;
}

function setSettingsBounds(){
  if(!mainWindow)return;
  const display=screen.getPrimaryDisplay(); const area=display.workArea;
  const width=Math.min(1080, area.width-48), height=Math.min(760, area.height-48);
  const x=area.x+Math.floor((area.width-width)/2), y=area.y+Math.floor((area.height-height)/2);
  if(!settingsWindow || settingsWindow.isDestroyed()){
    settingsWindow=new BrowserWindow({icon:path.join(CONTEXT_ICON_DIR,"settings.png"),x,y,width,height,frame:false,resizable:false,show:false,skipTaskbar:false,backgroundColor:"#f7f8fb",hasShadow:true,alwaysOnTop:false,webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    const url=isDev?"http://127.0.0.1:5173/?settings=1":`${pathToFileURL(path.join(__dirname,"../dist/index.html")).href}?settings=1`;
    settingsWindow.loadURL(url); settingsWindow.on("closed",()=>{settingsWindow=null;});
  }else settingsWindow.setBounds({x,y,width,height},false);
  settingsWindow.setAlwaysOnTop(false); settingsWindow.show(); settingsWindow.focus();
}

function setAppWindowBounds(){
  if(!appWindow || appWindow.isDestroyed() || !mainWindow)return;
  const display=screen.getPrimaryDisplay(), area=display.workArea;
  const sidebarWidth=mainWindow.getBounds().width;
  const desired=Math.floor(area.width*0.50);
  const width=Math.min(desired, Math.max(520, area.width-sidebarWidth-20));
  const x=area.x+area.width-sidebarWidth-width;
  appWindow.setBounds({x,y:area.y,width,height:area.height},false);
}

function showSidebar(){
  if(!mainWindow)return;
  mainWindow.setResizable(false); mainWindow.setAlwaysOnTop(true,"floating");
  setSidebarBounds();
  if(appWindow && !appWindow.isDestroyed()) setAppWindowBounds();
  mainWindow.show();
}

function layoutAppView(){
  if(!appWindow || appWindow.isDestroyed() || !appView || appView.webContents.isDestroyed())return;
  const b=appWindow.getContentBounds(), topBarHeight=44;
  appView.setBounds({x:0,y:topBarHeight,width:b.width,height:Math.max(0,b.height-topBarHeight)});
  appView.setAutoResize({width:true,height:true});
}

function createWindow(){
  mainWindow=new BrowserWindow({icon:APP_ICON,width:420,height:760,frame:false,transparent:false,resizable:false,hasShadow:false,show:false,alwaysOnTop:true,skipTaskbar:true,backgroundColor:"#ffffff",webPreferences:{preload:path.join(__dirname,"preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  if(isDev)mainWindow.loadURL("http://127.0.0.1:5173"); else mainWindow.loadFile(path.join(__dirname,"../dist/index.html"));
  mainWindow.on("closed",()=>{
    if(appWindow && !appWindow.isDestroyed())appWindow.close();
    if(settingsWindow && !settingsWindow.isDestroyed())settingsWindow.close();
    mainWindow=null;
  });
}

function partitionFor(appId,accountId){return `persist:account-${appId}-${accountId}`;}
function isCustomApp(appId){return String(appId||"").startsWith("custom-");}
function contextIconPath(appConfig){
  const id=String(appConfig?.id||"").toLowerCase();
  const map={gmail:"gmail.png",outlook:"outlook.png",linkedin:"linkedin.png",instagram:"instagram.png",facebook:"facebook.png",whatsapp:"whatsapp.png"};
  const file=map[id]||((id.startsWith("custom-"))?"custom.png":"custom.png");
  return path.join(CONTEXT_ICON_DIR,file);
}
function contextNativeImage(appConfig){
  const iconPath=contextIconPath(appConfig);
  return nativeImage.createFromPath(iconPath).isEmpty()?nativeImage.createFromPath(APP_ICON_PNG):nativeImage.createFromPath(iconPath);
}
function setTaskbarContext(appConfig){
  const icon=appConfig?contextNativeImage(appConfig):nativeImage.createFromPath(APP_ICON_PNG);
  // The service BrowserWindow is the taskbar window. Give it the same icon
  // that the sidebar uses for the active service. The tray follows the same context.
  if(appWindow && !appWindow.isDestroyed()) { try { appWindow.setIcon(icon); } catch {} }
  if(tray) { try { tray.setImage(icon); } catch {} }
}
function setSettingsTaskbarContext(){
  const iconPath=path.join(CONTEXT_ICON_DIR,"settings.png");
  const icon=nativeImage.createFromPath(iconPath);
  // Settings has its own taskbar entry, so use the Settings gear icon there
  // instead of the Communication Hub C icon.
  if(settingsWindow && !settingsWindow.isDestroyed()) { try { settingsWindow.setIcon(icon); } catch {} }
  if(tray) { try { tray.setImage(icon); } catch {} }
}
function restoreDefaultTaskbarContext(){
  const icon=nativeImage.createFromPath(APP_ICON_PNG);
  if(tray) { try { tray.setImage(icon); } catch {} }
}

// Electron identifies itself in the default user-agent. Some web services,
// including WhatsApp Web, can reject that UA even though the embedded Chromium
// engine is modern enough. Use a current Chrome UA for service BrowserViews.
const SERVICE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
function cacheKey(appConfig,account){return `${appConfig.id}::${account.id}`;}
function isViewUsable(view){
  return !!(view && view.webContents && typeof view.webContents.isDestroyed === "function" && !view.webContents.isDestroyed());
}
function extractEmailFromTitle(title=""){
  const match=String(title).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?match[0].toLowerCase():null;
}
async function updateAccountEmail(account,email){
  if(!account||!email)return;
  const normalized=String(email).trim().toLowerCase();
  if(!normalized||account.email===normalized)return;
  const list=accounts();
  const index=list.findIndex(a=>a.id===account.id);
  if(index<0)return;
  list[index]={...list[index],email:normalized,name:normalized};
  saveAccounts(list);
  const updated=normalizeAccount(list[index]);
  Object.assign(account,updated);
  if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("accounts:updated",updated);
  if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("accounts:updated",updated);
}

function attachView(view){
  if(!appWindow || appWindow.isDestroyed() || !isViewUsable(view))return false;
  for(const v of appWindow.getBrowserViews()){
    if(v!==view)appWindow.removeBrowserView(v);
  }
  appView=view; appWindow.setBrowserView(view); layoutAppView();
  return true;
}

async function createCachedView(appConfig,account){
  const key=cacheKey(appConfig,account);
  let view=viewCache.get(key);

  // BrowserView webContents can be destroyed when its host BrowserWindow closes.
  // Never reuse a stale view; create a fresh view while keeping the same session partition.
  if(isViewUsable(view)) return view;
  if(viewCache.has(key)) viewCache.delete(key);

  const partition=partitionFor(appConfig.id,account.id);
  view=new BrowserView({webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  viewCache.set(key,view);

  const wc=view.webContents;
  if(!wc || typeof wc.isDestroyed !== "function") {
    viewCache.delete(key);
    throw new Error(`Unable to create web contents for ${appConfig.name}`);
  }

  wc.setUserAgent(SERVICE_USER_AGENT);
  wc.setWindowOpenHandler(({url})=>({action:"allow",overrideBrowserWindowOptions:{webPreferences:{partition}}}));
  wc.on("page-title-updated",(_event,title)=>{
    const email=extractEmailFromTitle(title);
    if(email)updateAccountEmail(account,email);
  });
  wc.on("did-finish-load",()=>{
    if(!isViewUsable(view)) return;
    const email=extractEmailFromTitle(wc.getTitle());
    if(email)updateAccountEmail(account,email);
  });
  wc.on("destroyed",()=>{
    if(viewCache.get(key)===view) viewCache.delete(key);
    if(appView===view) appView=null;
  });

  try {
    await wc.loadURL(appConfig.url);
  } catch(error) {
    if(viewCache.get(key)===view) viewCache.delete(key);
    throw error;
  }
  return view;
}

async function openAccountView(appConfig,account){
  if(!mainWindow)return false;
  if(!appWindow || appWindow.isDestroyed()){
    const display=screen.getPrimaryDisplay(), area=display.workArea, sidebarWidth=mainWindow.getBounds().width;
    const desired=Math.floor(area.width*0.50);
    const width=Math.min(desired,Math.max(520,area.width-sidebarWidth-20));
    const x=area.x+area.width-sidebarWidth-width;
    appWindow=new BrowserWindow({icon:contextNativeImage(appConfig),x,y:area.y,width,height:area.height,frame:false,resizable:true,show:false,skipTaskbar:false,backgroundColor:"#ffffff",hasShadow:true,alwaysOnTop:false,webPreferences:{preload:path.join(__dirname,"appview-preload.cjs"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    const shellUrl=`${pathToFileURL(path.join(__dirname,"app-shell.html")).href}?name=${encodeURIComponent(appConfig.name)}`;
    await appWindow.loadURL(shellUrl);
    appWindow.on("resize",layoutAppView);
    appWindow.on("closed",()=>{appView=null; appWindow=null; activeAppContext=null; setTaskbarContext(null); showSidebar();});
  } else {
    appWindow.webContents.executeJavaScript(`document.getElementById('title').textContent=${JSON.stringify(appConfig.name)}`).catch(()=>{});
  }

  activeAppContext={id:appConfig.id,name:appConfig.name,icon:appConfig.icon};
  setTaskbarContext(appConfig);
  const view=await createCachedView(appConfig,account);
  if(!attachView(view)) return false;
  setAppWindowBounds();
  appWindow.setAlwaysOnTop(false); appWindow.show(); appWindow.focus();
  if(mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("view:state", {open:true, app:{id:appConfig.id,name:appConfig.name,icon:appConfig.icon}});
  showSidebar();
  return true;
}

function closeAppWindow(){
  if(appWindow && !appWindow.isDestroyed()) appWindow.close(); else {appView=null; activeAppContext=null; setTaskbarContext(null); if(mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("view:state", {open:false}); showSidebar();}
}

function createTray(){
  tray=new Tray(nativeImage.createFromPath(APP_ICON_PNG)); tray.setToolTip("Communication Hub");
  tray.setContextMenu(Menu.buildFromTemplate([{label:"Open Communication Hub",click:()=>showSidebar()},{type:"separator"},{label:"Quit",click:()=>app.quit()}]));
}

ipcMain.handle("auth:status",()=>{const u=currentUser();return {loggedIn:!!u,hasUsers:users().length>0};});
ipcMain.handle("auth:current",()=>publicUser(currentUser()));
ipcMain.handle("auth:register",async(_e,p)=>{const result=registerOwner(p);if(result?.error)return result;showSidebar();return result;});
ipcMain.handle("auth:login",async(_e,p)=>{const result=login(p);if(result?.error)return result;showSidebar();return result;});
ipcMain.handle("auth:logout",async()=>{store.delete("currentUserId");if(appWindow&&!appWindow.isDestroyed())appWindow.close();if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.close();setLoginBounds();return true;});

async function clearCompleteSessionData(){
  // Clear connected-service sessions and account data, but keep the local
  // Communication Hub owner profile so the user returns to the empty sidebar
  // instead of being forced through the login screen.
  const savedAccounts=accounts();
  const partitions=new Set(savedAccounts.map(a=>partitionFor(a.appId,a.id)));
  const uid=currentUserId();
  const existingUsers=users();
  const owner=existingUsers.find(u=>u.id===uid);

  for(const view of viewCache.values()){
    try{if(appWindow&&!appWindow.isDestroyed()&&appView===view)appWindow.removeBrowserView(view);}catch{}
  }
  viewCache.clear();
  appView=null;
  activeAppContext=null;
  if(appWindow&&!appWindow.isDestroyed()) appWindow.close();
  if(settingsWindow&&!settingsWindow.isDestroyed()) settingsWindow.close();

  for(const partition of partitions){
    try{
      const ses=session.fromPartition(partition);
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
    }catch{}
  }

  // Remove connected accounts, custom service definitions and custom limits.
  saveAccounts([]);
  store.delete("customServices");
  store.delete("customLimits");

  // Preserve the signed-in local owner and selected plan.
  if(owner){
    saveUsers([owner]);
    store.set("currentUserId", owner.id);
    restoreDefaultTaskbarContext();
    setSidebarBounds();
    if(mainWindow&&!mainWindow.isDestroyed()){
      mainWindow.webContents.send("accounts:cleared");
      mainWindow.webContents.send("custom-services:updated",[]);
      mainWindow.webContents.send("custom-limits:updated",{});
      mainWindow.webContents.send("accounts:updated",null);
      mainWindow.show();
      mainWindow.focus();
    }
  }else{
    store.delete("currentUserId");
    restoreDefaultTaskbarContext();
    setLoginBounds();
  }
  return true;
}

ipcMain.handle("auth:clear-data",async()=>clearCompleteSessionData());

ipcMain.handle("users:list",()=>{const u=currentUser();return u?[publicUser(u)]:[];});
ipcMain.handle("users:create",(_e,p)=>createManagedUser(p||{}));
ipcMain.handle("users:update",(_e,p)=>setUser(p||{}));
ipcMain.handle("users:delete",(_e,id)=>{const uid=typeof id==="string"?id:id?.id;const list=users();if(!uid)return {error:"User id is required."};if(uid===currentUserId())return {error:"The signed-in owner cannot be deleted from this desktop."};saveUsers(list.filter(u=>u.id!==uid));saveAccounts(accounts().filter(a=>a.userId!==uid));return true;});
ipcMain.handle("ui-settings:get",()=>getTextScale());
ipcMain.handle("ui-settings:set",(_e,value)=>{const scale=setTextScale(value);if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("ui-settings:updated",scale);if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("ui-settings:updated",scale);return scale;});
ipcMain.handle("plans:list",()=>plans);
ipcMain.handle("apps:get",()=>defaultApps);
ipcMain.handle("custom-limits:get",(_e,userId)=>customLimitsFor(userId||currentUserId()));
ipcMain.handle("custom-limits:set",(_e,p)=>{const uid=p?.userId||currentUserId();if(!uid)return {error:"Not signed in."};const limits=setCustomLimitsFor(uid,p?.limits||{});if(uid===currentUserId()){if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("custom-limits:updated",limits);if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("custom-limits:updated",limits);}return limits;});
ipcMain.handle("custom-services:get",(_e,userId)=>customServicesFor(userId||currentUserId()));
ipcMain.handle("custom-services:add",(_e,p)=>{const uid=p?.userId||currentUserId();if(!uid)return {error:"Not signed in."};const service=upsertCustomService(uid,p||{});const limits=customLimitsFor(uid);if(limits[service.id]===undefined){limits[service.id]=20;store.set(`customLimits.${uid}`,limits);}if(uid===currentUserId()){if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("custom-services:updated",customServicesFor(uid));if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("custom-services:updated",customServicesFor(uid));if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("custom-limits:updated",limits);if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("custom-limits:updated",limits);}return service;});
ipcMain.handle("custom-services:remove",(_e,p)=>{const uid=p?.userId||currentUserId();const appId=String(p?.appId||"");if(!uid||!appId)return {error:"Service id is required."};saveAccounts(accounts().filter(a=>!(a.userId===uid&&a.appId===appId)));const list=removeCustomServiceFor(uid,appId);const removed={userId:uid,appId};if(uid===currentUserId()){if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("accounts:removed",removed);if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("accounts:removed",removed);if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("custom-services:updated",list);if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("custom-services:updated",list);}return list;});
ipcMain.handle("accounts:get",(_e,userId)=>{const uid=userId||currentUserId();return accounts().filter(a=>a.userId===uid).map(normalizeAccount);});
ipcMain.handle("accounts:add",(_e,p)=>{const uid=p.userId||currentUserId();if(!uid)return {error:"Not signed in."};const appId=String(p.appId||"");const list=accounts();const current=list.filter(a=>a.userId===uid&&a.appId===appId).length;const limit=appId.startsWith("custom-")?(customLimitsFor(uid)[appId]??20):(users().find(u=>u.id===uid)?.accountLimits?.[appId]??0);if(current>=limit)return {error:`Account limit reached (${limit}). Increase the limit in Settings → Plans & Limits.`};if(appId.startsWith("custom-") && p.serviceName){upsertCustomService(uid,{id:appId,name:p.serviceName,url:p.serviceUrl||p.url,icon:p.icon});}
const created={id:`ACC-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,userId:uid,appId,name:String(p.name||"Account").trim(),email:p.email?String(p.email).trim().toLowerCase():"",url:p.url?String(p.url).trim():"",icon:String(p.icon||"").trim(),serviceName:String(p.serviceName||p.name||"").trim(),serviceUrl:String(p.serviceUrl||p.url||"").trim(),createdAt:new Date().toISOString()};list.push(created);saveAccounts(list);if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("accounts:updated",created);if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("accounts:updated",created);return list.filter(a=>a.userId===uid).map(normalizeAccount);});
ipcMain.handle("accounts:remove",(_e,p)=>{const uid=p.userId||currentUserId();const target=accounts().find(a=>a.id===p.accountId&&a.userId===uid);if(!target)return {error:"Account not found."};saveAccounts(accounts().filter(a=>a.id!==p.accountId));const key=`${target.appId}::${target.id}`;const v=viewCache.get(key);if(appView===v)closeAppWindow();viewCache.delete(key);const removed={id:target.id,userId:target.userId,appId:target.appId};if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("accounts:removed",removed);if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.webContents.send("accounts:removed",removed);return accounts().filter(a=>a.userId===uid).map(normalizeAccount);});

ipcMain.handle("view:preload",async(_e,p)=>{try{await createCachedView(p.appConfig,p.account);return true;}catch{return false;}});
ipcMain.handle("view:open",(_e,p)=>openAccountView(p.appConfig,p.account));
ipcMain.handle("view:close",()=>{closeAppWindow();return true;});
ipcMain.handle("view:reload",()=>{if(appView&&!appView.webContents.isDestroyed())return appView.webContents.reload();return false;});
ipcMain.handle("app:close",()=>{closeAppWindow();return true;});
ipcMain.handle("app:quit",()=>{app.quit();return true;});
ipcMain.handle("app:minimize",()=>{if(appWindow&&!appWindow.isDestroyed())appWindow.minimize();return true;});
ipcMain.handle("app:reload",()=>{if(appView&&!appView.webContents.isDestroyed())appView.webContents.reload();return true;});
ipcMain.handle("sidebar:show",()=>{showSidebar();return true;});
ipcMain.handle("sidebar:toggle",()=>{showSidebar();return true;});
ipcMain.handle("sidebar:minimize",()=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.minimize();return true;});
ipcMain.handle("sidebar:resize",(_e,height)=>resizeSidebar(height));
ipcMain.handle("settings:open",()=>{setSettingsTaskbarContext();setSettingsBounds();if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send("settings:state", {open:true});return true;});
ipcMain.handle("settings:close",()=>{if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.close();if(activeAppContext)setTaskbarContext(activeAppContext);else restoreDefaultTaskbarContext();if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.webContents.send("settings:state", {open:false});mainWindow.show();}return true;});

app.whenReady().then(async()=>{
  app.setAppUserModelId("com.communicationhub.desktop");
  createWindow();createTray();
  mainWindow.once("ready-to-show",()=>{const u=currentUser();if(u)showSidebar();else setLoginBounds();});
});
app.on("window-all-closed",e=>e.preventDefault());
