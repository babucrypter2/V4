import { useState, useRef, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  LayoutDashboard, Calculator, Settings, Trash2, Pencil,
  Download, Upload, X, RefreshCw, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Check, Edit2, Plus, Shield,
  AlertTriangle, Clock, Globe, Lock, Info
} from "lucide-react";

// ── IndexedDB ──────────────────────────────────────────────
const DB_NAME = "crypto_ledger_db";
const DB_VERSION = 1;
const IDB_STORES = ["txs", "exps", "convs"];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      IDB_STORES.forEach(s => {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
      });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbSaveAll(store, items) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    os.clear();
    items.forEach(item => os.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function useIDB(storeName, lsKey, init) {
  const [val, setVal] = useState(init);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const items = await idbGetAll(storeName);
        if (items.length > 0) { setVal(items); }
        else {
          try {
            const ls = localStorage.getItem(lsKey);
            if (ls) {
              const parsed = JSON.parse(ls);
              if (Array.isArray(parsed) && parsed.length > 0) {
                await idbSaveAll(storeName, parsed); setVal(parsed); localStorage.removeItem(lsKey);
              }
            }
          } catch {}
        }
      } catch {
        try { const ls = localStorage.getItem(lsKey); if (ls) setVal(JSON.parse(ls)); } catch {}
      }
      setReady(true);
    })();
  }, []);
  const set = async newVal => {
    setVal(newVal);
    try { await idbSaveAll(storeName, newVal); }
    catch { try { localStorage.setItem(lsKey, JSON.stringify(newVal)); } catch {} }
  };
  return [val, set, ready];
}

function useLS(key, init) {
  const [val, setVal] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; }
  });
  const set = v => { setVal(v); try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
  return [val, set];
}
function calcIncomeTax(income){
  if(income<=0)return 0;let tax=0;
  if(income>40000000){tax+=(income-40000000)*0.45;income=40000000;}
  if(income>18000000){tax+=(income-18000000)*0.40;income=18000000;}
  if(income>9000000){tax+=(income-9000000)*0.33;income=9000000;}
  if(income>6950000){tax+=(income-6950000)*0.23;income=6950000;}
  if(income>3300000){tax+=(income-3300000)*0.20;income=3300000;}
  if(income>1950000){tax+=(income-1950000)*0.10;income=1950000;}
  tax+=income*0.05;return Math.round(tax);
}
function calcTax(t){
  if(t<=0)return{income:0,resident:0,total:0};
  const i=calcIncomeTax(t),r=Math.round(t*0.10);
  return{income:i,resident:r,total:i+r};
}

const MONTHS=["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
function fmtJPY(n){return(n<0?"-":"")+"¥"+Math.abs(Math.round(n)).toLocaleString("ja-JP");}
function fmtUSD(n){return(n<0?"-":"")+"$"+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});}
function todayStr(){return new Date().toISOString().split("T")[0];}
function nowJST(){const d=new Date(),j=new Date(d.getTime()+9*3600000);return j.toISOString().slice(0,16).replace("T"," ")+" JST";}

const ER_API_URL="https://open.er-api.com/v6/latest/USD";
const RATE_SOURCE_NAME="ExchangeRate-API（市場中間値）";

async function getRate(){
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),8000);
    const res=await fetch(ER_API_URL,{signal:ctrl.signal});
    clearTimeout(timer);
    if(!res.ok)throw new Error("api fail");
    const data=await res.json();
    const rate=data?.rates?.JPY;
    return rate?Math.round(rate*100)/100:null;
  }catch(e){console.warn("ExchangeRate-API:",e.message);return null;}
}

const CY=new Date().getFullYear();
const DEF_TX_CATS=["perp","現物","エアドロ"];
const DEF_EXP_CATS=["エアドロ","ガス","両建て"];
const DEF_EXP_PROJS=["Hyperliquid","Lighter"];

function initTx(){return{currency_type:"USD",profit_usd:"",loss_usd:"",profit_jpy:"",loss_jpy:"",category:"",memo:"",created_at:todayStr()};}
function initExp(){return{currency_type:"USD",amount_jpy:"",amount_usd:"",category:"",project:"",memo:"",created_at:todayStr()};}
function initConv(){return{amount_usdc:"",memo:"",created_at:todayStr()};}

function calcUsdc(txs,exps,convs){
  const prof=txs.filter(t=>t.currency_type==="USD"&&(t.profit_usd||0)>0);
  const totAcq=prof.reduce((s,t)=>s+(t.profit_usd||0),0);
  const avgRate=totAcq>0?prof.reduce((s,t)=>s+(t.profit_usd||0)*(t.usd_jpy_rate||150),0)/totAcq:0;
  const totExpUsd=exps.filter(e=>e.currency_type==="USD").reduce((s,e)=>s+(e.amount_usd||0),0);
  const totConv=convs.reduce((s,c)=>s+c.amount_usdc,0);
  return{totalAcquired:totAcq,avgRate,totalExpUsd:totExpUsd,totalConverted:totConv,holdings:Math.max(0,totAcq-totExpUsd-totConv)};
}

function parseCSVImport(text){
  const lines=text.split("\n").map(l=>l.trim());
  let section=null,headers=null;
  const txs=[],exps=[];
  for(const line of lines){
    if(line.startsWith("## 損益明細")){section="tx";headers=null;continue;}
    if(line.startsWith("## 経費明細")){section="exp";headers=null;continue;}
    if(line.startsWith("#")||!line)continue;
    const cols=line.split(",").map(c=>c.replace(/^"|"$/g,"").trim());
    if(!headers){headers=cols;continue;}
    if(section==="tx"&&headers){
      const o={};headers.forEach((h,i)=>o[h]=cols[i]||"");
      if(!o.date)continue;
      txs.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2),created_at:o.date,category:o.category||"",profit_usd:parseFloat(o.profit_usd)||0,loss_usd:parseFloat(o.loss_usd)||0,profit_jpy:parseFloat(o.profit_jpy)||0,loss_jpy:parseFloat(o.loss_jpy)||0,usd_jpy_rate:parseFloat(o.usd_jpy_rate)||null,rate_source:o.rate_source||null,rate_status:parseFloat(o.usd_jpy_rate)?"ok":"na",currency_type:(parseFloat(o.profit_usd)||parseFloat(o.loss_usd))?"USD":"JPY",memo:o.memo||""});
    }
    if(section==="exp"&&headers){
      const o={};headers.forEach((h,i)=>o[h]=cols[i]||"");
      if(!o.date)continue;
      exps.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2),created_at:o.date,category:o.category||"",project:o.project||"",amount_jpy:parseFloat(o.amount_jpy)||0,amount_usd:parseFloat(o.amount_usd)||null,usd_jpy_rate:parseFloat(o.usd_jpy_rate)||null,rate_source:o.rate_source||null,rate_status:parseFloat(o.usd_jpy_rate)?"ok":"na",currency_type:parseFloat(o.amount_usd)?"USD":"JPY",memo:o.memo||""});
    }
  }
  return{txs,exps};
}

function Lbl({cls,children,required,color}){
  const col=color==="green"?"text-emerald-500 font-bold":color==="red"?"text-rose-500 font-bold":(cls||"");
  return <label className={"text-xs uppercase tracking-wide mb-1 block "+col}>{children}{required&&<span className="text-red-500 ml-0.5">*</span>}</label>;
}
function Inp({dark,className,error,...rest}){
  return <input {...rest} lang="en" style={{colorScheme:dark?"dark":"light",fontSize:"16px"}} className={"w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors "+(error?"border-red-500 ":dark?"border-gray-700 focus:border-gray-500 ":"border-gray-300 focus:border-gray-500 ")+(dark?"bg-gray-800 text-white placeholder-gray-600 ":"bg-gray-50 text-gray-900 ")+(className||"")} />;
}
function DateInp({dark,className,error,...rest}){
  return <input {...rest} type="date" lang="en" style={{colorScheme:dark?"dark":"light",fontSize:"13px"}} className={"w-full rounded-xl border px-2 py-1.5 outline-none transition-colors "+(error?"border-red-500 ":dark?"border-gray-700 focus:border-gray-500 ":"border-gray-300 focus:border-gray-500 ")+(dark?"bg-gray-800 text-white ":"bg-gray-50 text-gray-900 ")+(className||"")} />;
}
function NumInp({dark,className,error,color,...rest}){
  const borderCls=error?"border-red-500 ":color==="green"?"border-emerald-500 focus:border-emerald-400 ":color==="red"?"border-rose-500 focus:border-rose-400 ":dark?"border-gray-700 focus:border-gray-500 ":"border-gray-300 focus:border-gray-500 ";
  const bgCls=color==="green"?(dark?"bg-emerald-950/40 text-white ":"bg-emerald-50 text-gray-900 "):color==="red"?(dark?"bg-rose-950/40 text-white ":"bg-rose-50 text-gray-900 "):(dark?"bg-gray-800 text-white placeholder-gray-600 ":"bg-gray-50 text-gray-900 ");
  return <input {...rest} type="number" inputMode="decimal" lang="en" style={{colorScheme:dark?"dark":"light",fontSize:"16px"}} className={"w-full rounded-xl border px-3 py-2 text-sm outline-none transition-colors "+borderCls+bgCls+(className||"")} />;
}
function CurrencyToggle({dark,value,onChange}){
  return <div className={"flex rounded-xl overflow-hidden border "+(dark?"border-gray-700":"border-gray-300")}>
    {["USD","JPY"].map(c=><button key={c} type="button" onClick={()=>onChange(c)} className={"flex-1 py-2 text-sm font-bold "+(value===c?(dark?"bg-gray-600 text-white":"bg-gray-700 text-white"):(dark?"text-gray-400":"text-gray-500"))}>{c}</button>)}
  </div>;
}
function CatChips({dark,cats,setCats,selected,onSelect,placeholder}){
  const [adding,setAdding]=useState(false);
  const [val,setVal]=useState("");
  function add(){const v=val.trim();if(v&&!cats.includes(v)){setCats([...cats,v]);if(onSelect)onSelect(v);}setVal("");setAdding(false);}
  return <div className="space-y-1.5">
    <div className="flex flex-wrap gap-1.5">
      {cats.map(c=><span key={c} className={"inline-flex items-center gap-0.5 text-xs px-2 py-1 rounded-lg border cursor-pointer "+(selected===c?"bg-orange-500 text-white border-orange-500":(dark?"border-gray-700 text-gray-300":"border-gray-300 text-gray-600"))}>
        <span onClick={()=>onSelect&&onSelect(c)}>{c}</span>
        <button type="button" onClick={e=>{e.stopPropagation();setCats(cats.filter(x=>x!==c));if(selected===c&&onSelect)onSelect("");}} className="ml-0.5 opacity-60 hover:opacity-100 text-rose-400">×</button>
      </span>)}
      <button type="button" onClick={()=>setAdding(true)} className={"text-xs px-2 py-1 rounded-lg border "+(dark?"border-gray-700 text-gray-500":"border-gray-300 text-gray-400")}><Plus size={10} className="inline"/> 追加</button>
    </div>
    {adding&&<div className="flex gap-1.5">
      <Inp dark={dark} placeholder={placeholder||"新規追加"} value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} className="flex-1 py-1.5"/>
      <button type="button" onClick={add} className={"px-2 rounded-lg text-xs text-white "+(dark?"bg-gray-600":"bg-gray-800")}>OK</button>
      <button type="button" onClick={()=>{setAdding(false);setVal("");}} className={"px-2 rounded-lg text-xs "+(dark?"text-gray-400":"text-gray-500")}>✕</button>
    </div>}
  </div>;
}
function CTip({active,payload,label,dark}){
  if(!active||!payload||!payload.length)return null;
  const v=payload[0].value;
  return <div className={"px-3 py-2 rounded-lg text-sm shadow-lg border "+(dark?"bg-gray-800 border-gray-700 text-white":"bg-white border-gray-200 text-gray-900")}>
    <p className="font-semibold">{label}</p><p className={v>=0?"text-emerald-500":"text-rose-500"}>{fmtJPY(v)}</p>
  </div>;
}
function TxRow({t,cur,dark,dv,hov,sub,onEdit,onDel}){
  const net=cur==="USD"?(t.profit_usd||0)-(t.loss_usd||0):(t.profit_jpy||0)-(t.loss_jpy||0);
  return <div className={"flex items-center gap-2 px-3 py-2 border-b "+dv+" last:border-0"}>
    <span className={"text-xs w-11 shrink-0 "+sub}>{t.created_at.slice(5).replace("-","/")}</span>
    <span className={"text-xs px-1.5 py-0.5 rounded font-medium shrink-0 "+(dark?"bg-gray-700 text-gray-300":"bg-gray-100 text-gray-600")}>{t.category}</span>
    <span className={"text-xs flex-1 truncate "+sub}>{t.memo}</span>
    <div className="text-right shrink-0">
      <p className={"text-xs font-bold "+(net>=0?"text-emerald-500":"text-rose-500")}>{cur==="USD"?fmtUSD(net):fmtJPY(net)}</p>
      {t.usd_jpy_rate&&<p className={"text-xs "+sub}>¥{t.usd_jpy_rate}</p>}
      {t.rate_status==="pending"&&<p className="text-xs text-amber-400 flex items-center gap-0.5 justify-end"><Clock size={9}/>レート待機中</p>}
    </div>
    <button type="button" onClick={onEdit} className={"p-1 rounded "+hov}><Pencil size={11} className={sub}/></button>
    <button type="button" onClick={onDel} className={"p-1 rounded "+hov}><Trash2 size={11} className="text-rose-500"/></button>
  </div>;
}
function ExpItemRow({e,expView,dispExpCur,dark,dv,hov,sub,onEdit,onDel}){
  const eU=e.amount_usd!=null?e.amount_usd:(e.amount_jpy/(e.usd_jpy_rate||150));
  return <div className={"flex items-center gap-2 px-3 py-2 border-t "+dv+" "+(dark?"bg-gray-800/40":"bg-gray-50/60")}>
    <span className={"text-xs w-11 shrink-0 "+sub}>{e.created_at.slice(5).replace("-","/")}</span>
    <span className={"text-xs px-1.5 py-0.5 rounded shrink-0 "+(dark?"bg-gray-700 text-gray-400":"bg-gray-200 text-gray-500")}>
      {expView==="month"?e.category:expView==="cat"?(e.project||"—"):e.category}
    </span>
    <span className="text-xs flex-1 truncate">{e.memo}</span>
    <div className="text-right shrink-0">
      <p className="text-orange-500 text-xs font-semibold">{dispExpCur==="USD"?fmtUSD(eU):fmtJPY(e.amount_jpy)}</p>
      {e.usd_jpy_rate&&<p className={"text-xs "+sub}>¥{e.usd_jpy_rate}</p>}
    </div>
    <button type="button" onClick={onEdit} className={"p-1 rounded "+hov}><Pencil size={11} className={sub}/></button>
    <button type="button" onClick={onDel} className={"p-1 rounded "+hov}><Trash2 size={11} className="text-rose-500"/></button>
  </div>;
}
function Modal({dark,title,onClose,onSave,saving,children}){
  return <div className="fixed inset-0 z-50 flex items-end justify-center">
    <div className="absolute inset-0 bg-black/70" onClick={onClose}/>
    <div className={"relative w-full max-w-md rounded-t-3xl p-6 space-y-4 max-h-[88vh] overflow-y-auto "+(dark?"bg-gray-900 text-white":"bg-white text-gray-900")}>
      <div className="flex justify-between items-center">
        <h3 className="font-bold text-lg">{title}</h3>
        <button type="button" onClick={onClose} className={"p-1.5 rounded-xl "+(dark?"hover:bg-gray-800":"hover:bg-gray-100")}><X size={18}/></button>
      </div>
      {children}
      <button type="button" onClick={onSave} disabled={saving} className={"w-full text-white rounded-2xl py-3 font-semibold flex items-center justify-center gap-2 "+(saving?"bg-gray-500":(dark?"bg-gray-700 hover:bg-gray-600":"bg-gray-800 hover:bg-gray-700"))}>
        {saving?<><RefreshCw size={14} className="animate-spin"/>レート取得中...</>:"保存する"}
      </button>
    </div>
  </div>;
}
function YearSwitcher({dark,year,onChange}){
  const sub=dark?"text-gray-400":"text-gray-500";
  return <div className="flex items-center gap-1 px-3 pb-2">
    <button type="button" onClick={()=>onChange(year-1)} className={"p-1.5 rounded-full "+(dark?"hover:bg-gray-800":"hover:bg-gray-200")}><ChevronLeft size={16} className={sub}/></button>
    <span className={"font-bold text-sm min-w-[4rem] text-center "+(dark?"text-white":"text-gray-900")}>{year}年</span>
    <button type="button" onClick={()=>onChange(year+1)} className={"p-1.5 rounded-full "+(dark?"hover:bg-gray-800":"hover:bg-gray-200")}><ChevronRight size={16} className={sub}/></button>
  </div>;
}
function RateStatus({dark,rateCache,date,fetching,currency_type,manualRate,onManualRate}){
  if(currency_type==="JPY")return null;
  if(fetching)return <p className="text-xs flex items-center gap-1 text-blue-400"><RefreshCw size={9} className="animate-spin"/>ドル円レート取得中...</p>;
  const r=rateCache[date];
  if(r)return <p className="text-xs text-emerald-400 flex items-center gap-1"><Check size={9}/>レート取得済: ¥{r.rate}（{r.fetchedAt}）</p>;
  return <div className="space-y-1.5">
    <p className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle size={9}/>保存時にドル円レートを自動取得します。失敗時は手入力</p>
    {onManualRate&&<div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 shrink-0">手動レート ¥</span>
      <NumInp dark={dark} placeholder="150.00" value={manualRate||""} onChange={e=>onManualRate(e.target.value)} className="flex-1 py-1.5 text-xs"/>
    </div>}
  </div>;
}

function InlineInputPanel({dark,sub,dv,txCats,setTxCats,expCats,setExpCats,expProjs,setExpProjs,onSaveTx,onSaveExp,onSaveConv,rateCache,setRateCache}){
  const [active,setActive]=useState("exp");
  const [txF,setTxF]=useState(initTx());
  const [expF,setExpF]=useState(initExp());
  const [convF,setConvF]=useState(initConv());
  const [fetching,setFetching]=useState(false);
  const [saved,setSaved]=useState(false);
  const [showErr,setShowErr]=useState(false);
  const [manualRate,setManualRate]=useState("");
  const pTx=p=>setTxF(f=>({...f,...p}));
  const pExp=p=>setExpF(f=>({...f,...p}));
  const pConv=p=>setConvF(f=>({...f,...p}));

  async function doFetch(date){
    if(rateCache[date])return rateCache[date].rate;
    const rate=await getRate();
    if(rate){setRateCache(prev=>({...prev,[date]:{rate,fetchedAt:nowJST()}}));return rate;}
    return null;
  }
  function validate(){
    if(active==="tx"){const isU=txF.currency_type==="USD";return{amount:isU?(!txF.profit_usd&&!txF.loss_usd):(!txF.profit_jpy&&!txF.loss_jpy),category:!txF.category};}
    if(active==="exp"){const isU=expF.currency_type==="USD";return{amount:isU?!expF.amount_usd:!expF.amount_jpy,category:!expF.category};}
    return{amount:!convF.amount_usdc};
  }
  async function handleSave(){
    setShowErr(true);
    if(Object.values(validate()).some(Boolean))return;
    setShowErr(false);setFetching(true);
    if(active==="tx"){
      const isU=txF.currency_type==="USD";
      let r=null,rSrc=null,rStatus="na";
      if(isU){r=await doFetch(txF.created_at);if(!r&&manualRate){r=parseFloat(manualRate)||null;}if(r){rSrc=RATE_SOURCE_NAME;rStatus="ok";}else rStatus="pending";}
      const pu=parseFloat(txF.profit_usd)||0,lu=parseFloat(txF.loss_usd)||0;
      onSaveTx({id:Date.now().toString(),currency_type:txF.currency_type,profit_usd:isU?pu:0,loss_usd:isU?lu:0,profit_jpy:isU&&r?Math.round(pu*r):(isU?0:parseFloat(txF.profit_jpy)||0),loss_jpy:isU&&r?Math.round(lu*r):(isU?0:parseFloat(txF.loss_jpy)||0),usd_jpy_rate:r,rate_source:rSrc,rate_status:rStatus,category:txF.category,memo:txF.memo,created_at:txF.created_at||todayStr()});
      setTxF(initTx());setManualRate("");
    }else if(active==="exp"){
      const isU=expF.currency_type==="USD";
      let r=null,rSrc=null,rStatus="na";
      if(isU){r=await doFetch(expF.created_at);if(!r&&manualRate){r=parseFloat(manualRate)||null;}if(r){rSrc=RATE_SOURCE_NAME;rStatus="ok";}else rStatus="pending";}
      const amt=parseFloat(expF.amount_usd)||0;
      onSaveExp({id:Date.now().toString(),currency_type:expF.currency_type,amount_usd:isU?amt:null,amount_jpy:isU&&r?Math.round(amt*r):(isU?0:parseFloat(expF.amount_jpy)||0),usd_jpy_rate:r,rate_source:rSrc,rate_status:rStatus,category:expF.category||"その他",project:expF.project||"",memo:expF.memo,created_at:expF.created_at||todayStr()});
      setExpF(initExp());setManualRate("");
    }else{
      const r=await doFetch(convF.created_at);
      onSaveConv({id:Date.now().toString(),amount_usdc:parseFloat(convF.amount_usdc)||0,usd_jpy_rate:r||(parseFloat(manualRate)||150),memo:convF.memo,created_at:convF.created_at||todayStr()});
      setConvF(initConv());setManualRate("");
    }
    setFetching(false);setSaved(true);setTimeout(()=>{setSaved(false);setShowErr(false);},1500);
  }
  const errs=showErr?validate():{};
  const card=dark?"bg-gray-900 border-gray-800":"bg-white border-gray-200";
  return <div className={card+" border rounded-2xl overflow-hidden"}>
    <div className={"flex border-b "+(dark?"border-gray-800":"border-gray-100")}>
      {[["exp","経費","orange"],["tx","損益","gray"],["conv","USDC円転","gray"]].map(([id,label,col])=>(
        <button key={id} type="button" onClick={()=>{setActive(id);setShowErr(false);setManualRate("");}} className={"flex-1 py-2.5 text-xs font-bold "+(active===id?(col==="orange"?"bg-orange-500 text-white":(dark?"bg-gray-700 text-white":"bg-gray-800 text-white")):(dark?"text-gray-500":"text-gray-400"))}>{label}</button>
      ))}
    </div>
    <div className="p-4 space-y-3">
      {active==="exp"&&<>
        <div className="grid grid-cols-2 gap-2">
          <div><Lbl cls={sub}>通貨</Lbl><CurrencyToggle dark={dark} value={expF.currency_type} onChange={v=>pExp({currency_type:v})}/></div>
          <div><Lbl cls={sub}>日付</Lbl><DateInp dark={dark} value={expF.created_at} onChange={e=>pExp({created_at:e.target.value})}/></div>
        </div>
        {expF.currency_type==="USD"
          ?<div><Lbl cls={sub} required>金額（USD）</Lbl><NumInp dark={dark} placeholder="0.00" value={expF.amount_usd} onChange={e=>pExp({amount_usd:e.target.value})} error={errs.amount}/></div>
          :<div><Lbl cls={sub} required>金額（JPY）</Lbl><NumInp dark={dark} placeholder="0" value={expF.amount_jpy} onChange={e=>pExp({amount_jpy:e.target.value})} error={errs.amount}/></div>}
        <RateStatus dark={dark} rateCache={rateCache} date={expF.created_at} fetching={fetching} currency_type={expF.currency_type} manualRate={manualRate} onManualRate={setManualRate}/>
        <div><Lbl cls={sub} required>カテゴリ</Lbl><CatChips dark={dark} cats={expCats} setCats={setExpCats} selected={expF.category} onSelect={v=>pExp({category:v})} placeholder="新しいカテゴリ"/>{errs.category&&<p className="text-red-500 text-xs mt-1">カテゴリを選択してください</p>}</div>
        <div><Lbl cls={sub}>プロジェクト</Lbl><CatChips dark={dark} cats={expProjs} setCats={setExpProjs} selected={expF.project} onSelect={v=>pExp({project:v})} placeholder="新しいプロジェクト"/></div>
        <div><Lbl cls={sub}>メモ</Lbl><Inp dark={dark} placeholder="例：ガス代..." value={expF.memo} onChange={e=>pExp({memo:e.target.value})}/></div>
      </>}
      {active==="tx"&&<>
        <div className="grid grid-cols-2 gap-2">
          <div><Lbl cls={sub}>通貨</Lbl><CurrencyToggle dark={dark} value={txF.currency_type} onChange={v=>pTx({currency_type:v})}/></div>
          <div><Lbl cls={sub}>日付</Lbl><DateInp dark={dark} value={txF.created_at} onChange={e=>pTx({created_at:e.target.value})}/></div>
        </div>
        {txF.currency_type==="USD"
          ?<div className="grid grid-cols-2 gap-2">
            <div><Lbl color="green" required>📈 利益（USD）</Lbl><NumInp dark={dark} placeholder="0.00" value={txF.profit_usd} onChange={e=>pTx({profit_usd:e.target.value})} error={errs.amount} color="green"/></div>
            <div><Lbl color="red" required>📉 損失（USD）</Lbl><NumInp dark={dark} placeholder="0.00" value={txF.loss_usd} onChange={e=>pTx({loss_usd:e.target.value})} error={errs.amount} color="red"/></div>
          </div>
          :<div className="grid grid-cols-2 gap-2">
            <div><Lbl color="green" required>📈 利益（JPY）</Lbl><NumInp dark={dark} placeholder="0" value={txF.profit_jpy} onChange={e=>pTx({profit_jpy:e.target.value})} error={errs.amount} color="green"/></div>
            <div><Lbl color="red" required>📉 損失（JPY）</Lbl><NumInp dark={dark} placeholder="0" value={txF.loss_jpy} onChange={e=>pTx({loss_jpy:e.target.value})} error={errs.amount} color="red"/></div>
          </div>}
        <RateStatus dark={dark} rateCache={rateCache} date={txF.created_at} fetching={fetching} currency_type={txF.currency_type} manualRate={manualRate} onManualRate={setManualRate}/>
        <div><Lbl cls={sub} required>カテゴリ</Lbl><CatChips dark={dark} cats={txCats} setCats={setTxCats} selected={txF.category} onSelect={v=>pTx({category:v})} placeholder="新しいカテゴリ"/>{errs.category&&<p className="text-red-500 text-xs mt-1">カテゴリを選択してください</p>}</div>
        <div><Lbl cls={sub}>メモ</Lbl><Inp dark={dark} placeholder="任意" value={txF.memo} onChange={e=>pTx({memo:e.target.value})}/></div>
      </>}
      {active==="conv"&&<>
        <div className="grid grid-cols-2 gap-2">
          <div><Lbl cls={sub} required>円転量（USDC）</Lbl><NumInp dark={dark} placeholder="0" value={convF.amount_usdc} onChange={e=>pConv({amount_usdc:e.target.value})} error={errs.amount}/></div>
          <div><Lbl cls={sub}>日付</Lbl><DateInp dark={dark} value={convF.created_at} onChange={e=>pConv({created_at:e.target.value})}/></div>
        </div>
        <RateStatus dark={dark} rateCache={rateCache} date={convF.created_at} fetching={fetching} currency_type="USD" manualRate={manualRate} onManualRate={setManualRate}/>
        <div><Lbl cls={sub}>メモ</Lbl><Inp dark={dark} placeholder="例：円転" value={convF.memo} onChange={e=>pConv({memo:e.target.value})}/></div>
      </>}
      {showErr&&Object.values(errs).some(Boolean)&&<p className="text-red-500 text-xs">* の付いた必須項目を入力してください</p>}
      <button type="button" onClick={handleSave} disabled={fetching} className={"w-full py-2.5 rounded-2xl font-semibold text-sm text-white flex items-center justify-center gap-2 "+(saved?"bg-emerald-500":fetching?"bg-gray-500":(active==="exp"?"bg-orange-500 hover:bg-orange-600":(dark?"bg-gray-700 hover:bg-gray-600":"bg-gray-800 hover:bg-gray-700")))}>
        {saved?<><Check size={15}/>保存しました</>:fetching?<><RefreshCw size={15} className="animate-spin"/>レート取得中...</>:"保存する"}
      </button>
    </div>
  </div>;
}

export default function App(){
  const [dark,setDark]=useLS("cl_dark",true);
  const [tab,setTab]=useState("home");
  const [year,setYear]=useState(CY);
  const [dispCur,setDispCur]=useState("JPY");
  const [dispExpCur,setDispExpCur]=useState("JPY");
  const [expView,setExpView]=useState("month");
  const [catBkOpen,setCatBkOpen]=useState(false);
  const [expandedMonths,setExpandedMonths]=useState({});
  const [expandedExpMonths,setExpandedExpMonths]=useState({});
  const [expandedCats,setExpandedCats]=useState({});
  const [expandedProjs,setExpandedProjs]=useState({});
  const [expSection,setExpSection]=useState(false);
  const [taxRateOvr,setTaxRateOvr]=useLS("cl_taxrate",30);
  const [editingRate,setEditingRate]=useState(false);
  const [rateInput,setRateInput]=useState("30");
  // IndexedDB でデータ保存
  const [txs, setTxs, txsReady]   = useIDB("txs",   "cl_txs",   []);
  const [exps, setExps, expsReady] = useIDB("exps",  "cl_exps",  []);
  const [convs, setConvs, convsReady] = useIDB("convs", "cl_convs", []);
  const dbReady = txsReady && expsReady && convsReady;
  const [txCats,setTxCats]=useLS("cl_txcats",DEF_TX_CATS);
  const [expCats,setExpCats]=useLS("cl_expcats",DEF_EXP_CATS);
  const [expProjs,setExpProjs]=useLS("cl_expprojs",DEF_EXP_PROJS);
  const [rateCache,setRateCache]=useState({});
  const [showTxM,setShowTxM]=useState(false);
  const [showExpM,setShowExpM]=useState(false);
  const [showConvM,setShowConvM]=useState(false);
  const [eTx,setETx]=useState(null);
  const [eExp,setEExp]=useState(null);
  const [eConv,setEConv]=useState(null);
  const [modalSaving,setModalSaving]=useState(false);
  const [txF,setTxF]=useState(initTx());
  const [expF,setExpF]=useState(initExp());
  const [convF,setConvF]=useState(initConv());
  const [importMsg,setImportMsg]=useState(null);
  const importRef=useRef();
  const pTx=p=>setTxF(f=>({...f,...p}));
  const pExp=p=>setExpF(f=>({...f,...p}));
  const pConv=p=>setConvF(f=>({...f,...p}));

  const yTxs=txs.filter(t=>new Date(t.created_at).getFullYear()===year);
  const yExps=exps.filter(e=>new Date(e.created_at).getFullYear()===year);
  const yConvs=convs.filter(c=>new Date(c.created_at).getFullYear()===year);
  const tProfJPY=yTxs.reduce((s,t)=>s+(t.profit_jpy||0),0);
  const tLossJPY=yTxs.reduce((s,t)=>s+(t.loss_jpy||0),0);
  const tProfUSD=yTxs.reduce((s,t)=>s+(t.profit_usd||0),0);
  const netJPY=tProfJPY-tLossJPY;
  const netUSD=tProfUSD-yTxs.reduce((s,t)=>s+(t.loss_usd||0),0);
  const totalExp=yExps.reduce((s,e)=>s+e.amount_jpy,0);
  const usdc=calcUsdc(txs,exps,convs);
  const avgRate=usdc.avgRate;
  const yForex=yConvs.reduce((s,c)=>s+(c.usd_jpy_rate-avgRate)*c.amount_usdc,0);
  const totalNet=netJPY+yForex;
  const taxable=Math.max(0,totalNet-totalExp);
  const bTax=calcTax(taxable);
  const effRate=taxable>0?(bTax.total/taxable*100):0;
  const taxEst=Math.round(taxable*taxRateOvr/100);
  const isUSD=dispCur==="USD";
  const pendingTxs=yTxs.filter(t=>t.rate_status==="pending");

  const monthlyData=MONTHS.map((m,i)=>({month:m,損益:yTxs.filter(t=>new Date(t.created_at).getMonth()===i).reduce((s,t)=>s+(t.profit_jpy||0)-(t.loss_jpy||0),0)}));
  const txsByMonth=yTxs.reduce((a,t)=>{const k=t.created_at.slice(0,7);if(!a[k])a[k]=[];a[k].push(t);return a;},{});
  const sortedMK=Object.keys(txsByMonth).sort((a,b)=>b.localeCompare(a));
  const allCatSet=new Set([...txCats,...yTxs.map(t=>t.category)]);
  const catPnl=[...allCatSet].map(cat=>{const items=yTxs.filter(t=>t.category===cat);if(!items.length)return null;return{cat,net:items.reduce((s,t)=>s+(t.profit_jpy||0)-(t.loss_jpy||0),0),count:items.length};}).filter(Boolean).sort((a,b)=>Math.abs(b.net)-Math.abs(a.net));
  const expByCat=yExps.reduce((a,e)=>{if(!a[e.category])a[e.category]=[];a[e.category].push(e);return a;},{});
  const catTotals=Object.keys(expByCat).map(cat=>{const it=expByCat[cat];return{cat,total:it.reduce((s,e)=>s+e.amount_jpy,0),items:it};}).sort((a,b)=>b.total-a.total);
  const expByProj=yExps.reduce((a,e)=>{const k=e.project||"（未設定）";if(!a[k])a[k]=[];a[k].push(e);return a;},{});
  const projTotals=Object.keys(expByProj).map(proj=>{const it=expByProj[proj];return{proj,total:it.reduce((s,e)=>s+e.amount_jpy,0),items:it};}).sort((a,b)=>b.total-a.total);
  const expByMonth=yExps.reduce((a,e)=>{const k=e.created_at.slice(0,7);if(!a[k])a[k]=[];a[k].push(e);return a;},{});
  const sortedExpMK=Object.keys(expByMonth).sort((a,b)=>b.localeCompare(a));

  async function doFetchForModal(date){
    if(rateCache[date])return rateCache[date].rate;
    const rate=await getRate();
    if(rate)setRateCache(prev=>({...prev,[date]:{rate,fetchedAt:nowJST()}}));
    return rate;
  }
  function openETx(t){setETx(t);setTxF({currency_type:t.currency_type,profit_usd:t.profit_usd||"",loss_usd:t.loss_usd||"",profit_jpy:t.profit_jpy||"",loss_jpy:t.loss_jpy||"",category:t.category,memo:t.memo||"",created_at:t.created_at});setShowTxM(true);}
  async function saveTxE(){
    setModalSaving(true);
    const isU=txF.currency_type==="USD";
    let r=eTx.usd_jpy_rate,rSrc=eTx.rate_source,rStatus=eTx.rate_status;
    if(isU&&!r){r=await doFetchForModal(txF.created_at);if(r){rSrc=RATE_SOURCE_NAME;rStatus="ok";}}
    const e={id:eTx.id,currency_type:txF.currency_type,profit_usd:isU?parseFloat(txF.profit_usd)||0:0,loss_usd:isU?parseFloat(txF.loss_usd)||0:0,profit_jpy:isU&&r?Math.round((parseFloat(txF.profit_usd)||0)*r):parseFloat(txF.profit_jpy)||0,loss_jpy:isU&&r?Math.round((parseFloat(txF.loss_usd)||0)*r):parseFloat(txF.loss_jpy)||0,usd_jpy_rate:r,rate_source:rSrc,rate_status:rStatus,category:txF.category,memo:txF.memo,created_at:txF.created_at||todayStr()};
    setTxs(ts=>ts.map(t=>t.id===eTx.id?e:t));setModalSaving(false);setShowTxM(false);
  }
  function delTx(id){setTxs(ts=>ts.filter(t=>t.id!==id));}
  function openEExp(e){setEExp(e);setExpF({currency_type:e.currency_type||"JPY",amount_jpy:e.amount_jpy,amount_usd:e.amount_usd||"",category:e.category,project:e.project||"",memo:e.memo||"",created_at:e.created_at});setShowExpM(true);}
  async function saveExpE(){
    setModalSaving(true);
    const isU=expF.currency_type==="USD";
    let r=eExp.usd_jpy_rate,rSrc=eExp.rate_source,rStatus=eExp.rate_status;
    if(isU&&!r){r=await doFetchForModal(expF.created_at);if(r){rSrc=RATE_SOURCE_NAME;rStatus="ok";}}
    const amt=parseFloat(expF.amount_usd)||0;
    const e={id:eExp.id,currency_type:expF.currency_type,amount_usd:isU?amt:null,amount_jpy:isU&&r?Math.round(amt*r):parseFloat(expF.amount_jpy)||0,usd_jpy_rate:r,rate_source:rSrc,rate_status:rStatus,category:expF.category||"その他",project:expF.project||"",memo:expF.memo,created_at:expF.created_at||todayStr()};
    setExps(es=>es.map(x=>x.id===eExp.id?e:x));setModalSaving(false);setShowExpM(false);
  }
  function delExp(id){setExps(es=>es.filter(e=>e.id!==id));}
  function openEConv(c){setEConv(c);setConvF({amount_usdc:c.amount_usdc,memo:c.memo||"",created_at:c.created_at});setShowConvM(true);}
  async function saveConvE(){
    setModalSaving(true);
    let r=eConv.usd_jpy_rate;
    if(!r){r=await doFetchForModal(convF.created_at)||150;}
    const e={id:eConv.id,amount_usdc:parseFloat(convF.amount_usdc)||0,usd_jpy_rate:r,memo:convF.memo,created_at:convF.created_at||todayStr()};
    setConvs(cs=>cs.map(c=>c.id===eConv.id?e:c));setModalSaving(false);setShowConvM(false);
  }
  function delConv(id){setConvs(cs=>cs.filter(c=>c.id!==id));}

  function exportCSV(){
    try{
      const sum=[["# クリプト損益台帳 エクスポート"],["年度",year+"年"],["出力日時",nowJST()],["為替レート根拠","ExchangeRate-API 市場中間値（所得税基本通達 法第57条の3関係 3-2）"],[""],["## サマリー"],["項目","金額（JPY）"],["課税所得",taxable],["推定税額（"+taxRateOvr+"% 固定）",taxEst],[""]];
      const h=["date","category","profit_usd","loss_usd","profit_jpy","loss_jpy","usd_jpy_rate","rate_source","memo"];
      const rows=yTxs.map(t=>[t.created_at,t.category,t.profit_usd||0,t.loss_usd||0,t.profit_jpy||0,t.loss_jpy||0,t.usd_jpy_rate||"",t.rate_source||"",'"'+(t.memo||"")+'"']);
      const hE=["date","category","project","amount_jpy","amount_usd","usd_jpy_rate","rate_source","memo"];
      const rowsE=yExps.map(e=>[e.created_at,e.category,e.project||"",e.amount_jpy,e.amount_usd||"",e.usd_jpy_rate||"",e.rate_source||"",'"'+(e.memo||"")+'"']);
      const csv=sum.map(r=>r.join(",")).join("\n")+"## 損益明細\n"+[h,...rows].map(r=>r.join(",")).join("\n")+"\n\n## 経費明細\n"+[hE,...rowsE].map(r=>r.join(",")).join("\n");
      const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download="crypto_"+year+".csv";
      document.body.appendChild(a);a.click();
      setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},500);
    }catch(err){alert("CSV出力エラー: "+err.message);}
  }
  function handleImport(e){
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const {txs:newTxs,exps:newExps}=parseCSVImport(ev.target.result);
        if(!newTxs.length&&!newExps.length){setImportMsg({ok:false,msg:"インポートできるデータが見つかりませんでした"});return;}
        setTxs(prev=>[...prev,...newTxs]);setExps(prev=>[...prev,...newExps]);
        setImportMsg({ok:true,msg:`✓ 損益${newTxs.length}件・経費${newExps.length}件をインポートしました`});
        setTimeout(()=>setImportMsg(null),4000);
      }catch(err){setImportMsg({ok:false,msg:"エラー: "+err.message});}
    };
    reader.readAsText(file,"utf-8");e.target.value="";
  }

  const bg=dark?"bg-gray-950 text-white":"bg-gray-100 text-gray-900";
  const card=dark?"bg-gray-900 border-gray-800":"bg-white border-gray-200";
  const sub=dark?"text-gray-500":"text-gray-400";
  const tabBg=dark?"bg-gray-900 border-gray-800":"bg-white border-gray-200";
  const dv=dark?"border-gray-800":"border-gray-100";
  const hov=dark?"hover:bg-gray-800":"hover:bg-gray-50";
  const TABS=[{id:"home",icon:LayoutDashboard,label:"ホーム"},{id:"tax",icon:Calculator,label:"税金"},{id:"settings",icon:Settings,label:"設定"}];

  // IDB読み込み中ローディング
  if (!dbReady) return (
    <div className={bg + " min-h-screen flex items-center justify-center"}>
      <div className="text-center space-y-3">
        <p className="text-2xl">📒</p>
        <RefreshCw size={20} className={"animate-spin mx-auto " + sub} />
        <p className={"text-sm " + sub}>データを読み込み中...</p>
      </div>
    </div>
  );

  return <div className={bg+" min-h-screen"} style={{fontFamily:"'Hiragino Sans','Noto Sans JP',sans-serif"}}>
    <style>{`*{touch-action:manipulation;-webkit-tap-highlight-color:transparent;}input[type=number]{-moz-appearance:textfield;}input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}`}</style>
    <div className="max-w-md mx-auto pb-24">
      <div className={(dark?"bg-gray-950":"bg-white")+" sticky top-0 z-10 border-b "+dv}>
        <div className="px-4 pt-3 pb-1 flex items-center gap-2">
          <span className="text-xl">📒</span>
          <div><h1 className="text-sm font-bold leading-tight">クリプト損益台帳</h1><p className={"text-xs "+sub}>確定申告サポーター</p></div>
        </div>
        <YearSwitcher dark={dark} year={year} onChange={setYear}/>
      </div>

      <div className="p-4 space-y-4">
      {tab==="home"&&<div className="space-y-4">
        <InlineInputPanel dark={dark} sub={sub} dv={dv} txCats={txCats} setTxCats={setTxCats} expCats={expCats} setExpCats={setExpCats} expProjs={expProjs} setExpProjs={setExpProjs} rateCache={rateCache} setRateCache={setRateCache} onSaveTx={e=>setTxs(ts=>[e,...ts])} onSaveExp={e=>setExps(es=>[e,...es])} onSaveConv={e=>setConvs(cs=>[e,...cs])}/>

        {pendingTxs.length>0&&<div className={"border rounded-2xl p-3 "+(dark?"bg-amber-950/30 border-amber-500/40":"bg-amber-50 border-amber-200")}>
          <p className="text-xs font-semibold text-amber-400 flex items-center gap-1 mb-1"><Clock size={11}/>レート未取得の取引: {pendingTxs.length}件</p>
          <p className={"text-xs "+(dark?"text-amber-400/70":"text-amber-700")}>取引を編集→再保存するとレートを再取得します</p>
        </div>}

        <div className={"flex rounded-2xl overflow-hidden border w-fit mx-auto "+(dark?"border-gray-800":"border-gray-200")}>
          {["JPY","USD"].map(c=><button key={c} type="button" onClick={()=>setDispCur(c)} className={"px-8 py-2 text-sm font-bold "+(dispCur===c?(dark?"bg-gray-700 text-white":"bg-gray-800 text-white"):sub)}>{c}</button>)}
        </div>

        {txs.length===0&&exps.length===0
          ?<div className={"border rounded-2xl p-8 text-center "+(dark?"border-gray-800":"border-gray-200")}>
            <p className="text-3xl mb-3">📝</p>
            <p className={"text-sm font-semibold mb-1 "+(dark?"text-gray-300":"text-gray-700")}>まだデータがありません</p>
            <p className={"text-xs "+sub}>上のフォームから損益・経費を入力してください</p>
          </div>
          :<div className="space-y-3">
            <div className={card+" border rounded-2xl p-4"}>
              <div className="flex justify-between items-start">
                <div><p className={"text-xs mb-1 "+sub}>年間純利益（取引損益）</p><p className={"text-2xl font-bold "+((isUSD?netUSD:netJPY)>=0?"text-emerald-500":"text-rose-500")}>{isUSD?fmtUSD(netUSD):fmtJPY(netJPY)}</p></div>
                <div className="text-right"><p className={"text-xs mb-0.5 "+sub}>推定税額 ({taxRateOvr}%)</p><p className="text-lg font-bold text-rose-500">{fmtJPY(taxEst)}</p></div>
              </div>
            </div>
            <div className={card+" border rounded-2xl p-4"}><p className={"text-xs mb-1 "+sub}>経費合計</p><p className="text-lg font-bold text-orange-500">{fmtJPY(totalExp)}</p></div>
            <div className={card+" border rounded-2xl p-4 border-l-2 border-l-violet-500"}><p className={"text-xs mb-1 "+sub}>課税所得</p><p className="text-lg font-bold text-violet-400">{fmtJPY(taxable)}</p><p className={"text-xs "+sub}>純利益 − 経費</p></div>
          </div>}

        {catPnl.length>0&&<div className={card+" border rounded-2xl overflow-hidden"}>
          <button type="button" onClick={()=>setCatBkOpen(v=>!v)} className={"w-full flex items-center justify-between px-4 py-3 "+hov}><p className="text-sm font-semibold">カテゴリ別損益</p>{catBkOpen?<ChevronUp size={14} className={sub}/>:<ChevronDown size={14} className={sub}/>}</button>
          {catBkOpen&&<div className={"border-t "+dv}>{catPnl.map(({cat,net,count})=>(
            <div key={cat} className={"flex items-center justify-between px-4 py-2.5 border-b "+dv+" last:border-0"}>
              <div className="flex items-center gap-2"><span className={"text-xs px-2 py-0.5 rounded font-medium "+(dark?"bg-gray-700 text-gray-300":"bg-gray-100 text-gray-600")}>{cat}</span><span className={"text-xs "+sub}>{count}件</span></div>
              <span className={"text-sm font-bold "+(net>=0?"text-emerald-500":"text-rose-500")}>{fmtJPY(net)}</span>
            </div>
          ))}<div className={"px-4 py-2 flex justify-between text-xs font-semibold "+(dark?"bg-gray-900":"bg-gray-50")}><span className={sub}>合計</span><span className={netJPY>=0?"text-emerald-500":"text-rose-500"}>{fmtJPY(netJPY)}</span></div></div>}
        </div>}

        {yTxs.length>0&&<div className={card+" border rounded-2xl p-4"}>
          <p className="text-sm font-semibold mb-3">月別損益（JPY · 取引）</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={monthlyData} margin={{top:0,right:0,left:-20,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke={dark?"#1f2937":"#e5e7eb"}/>
              <XAxis dataKey="month" tick={{fontSize:9,fill:dark?"#6b7280":"#9ca3af"}}/>
              <YAxis tick={{fontSize:9,fill:dark?"#6b7280":"#9ca3af"}} tickFormatter={v=>v>=1000?Math.round(v/1000)+"k":v}/>
              <Tooltip content={<CTip dark={dark}/>}/>
              <Bar dataKey="損益" radius={[4,4,0,0]}>{monthlyData.map((e,i)=><Cell key={i} fill={e.損益>=0?"#10b981":"#f43f5e"}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>}

        {sortedMK.length>0&&<div className={card+" border rounded-2xl overflow-hidden"}>
          <div className={"px-4 py-3 border-b "+dv}><p className="text-sm font-semibold">月別取引履歴</p></div>
          {sortedMK.map(key=>{
            const items=txsByMonth[key],open=expandedMonths[key];
            const mNet=items.reduce((s,t)=>s+(isUSD?(t.profit_usd||0)-(t.loss_usd||0):(t.profit_jpy||0)-(t.loss_jpy||0)),0);
            return <div key={key} className={"border-b "+dv+" last:border-0"}>
              <button type="button" onClick={()=>setExpandedMonths(m=>({...m,[key]:!m[key]}))} className={"w-full flex items-center justify-between px-4 py-2.5 "+hov}>
                <div className="flex items-center gap-2"><span className="font-semibold text-sm">{parseInt(key.split("-")[1])}月</span><span className={"text-xs "+sub}>{items.length}件</span></div>
                <div className="flex items-center gap-2"><span className={"text-sm font-bold "+(mNet>=0?"text-emerald-500":"text-rose-500")}>{isUSD?fmtUSD(mNet):fmtJPY(mNet)}</span>{open?<ChevronUp size={12} className={sub}/>:<ChevronDown size={12} className={sub}/>}</div>
              </button>
              {open&&<div className={"border-t "+dv}>{items.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(t=><TxRow key={t.id} t={t} cur={dispCur} dark={dark} dv={dv} hov={hov} sub={sub} onEdit={()=>openETx(t)} onDel={()=>delTx(t.id)}/>)}<div className={"px-4 py-1.5 flex justify-between text-xs font-semibold "+(dark?"bg-gray-900":"bg-gray-50")}><span className={sub}>合計</span><span className={mNet>=0?"text-emerald-500":"text-rose-500"}>{isUSD?fmtUSD(mNet):fmtJPY(mNet)}</span></div></div>}
            </div>;
          })}
        </div>}

        {yExps.length>0&&<div className={card+" border rounded-2xl overflow-hidden"}>
          <button type="button" onClick={()=>setExpSection(v=>!v)} className={"w-full flex items-center justify-between px-4 py-3 "+hov}>
            <div className="flex items-center gap-2"><p className="text-sm font-semibold">経費履歴</p><span className={"text-xs "+sub}>{yExps.length}件</span></div>
            <div className="flex items-center gap-3"><span className="text-orange-500 font-bold text-sm">{fmtJPY(totalExp)}</span>{expSection?<ChevronUp size={14} className={sub}/>:<ChevronDown size={14} className={sub}/>}</div>
          </button>
          {expSection&&<div className={"border-t "+dv}>
            <div className={"flex border-b "+dv}>{[["month","月別"],["cat","カテゴリ別"],["proj","プロジェクト別"]].map(([v,l])=><button key={v} type="button" onClick={()=>setExpView(v)} className={"flex-1 py-2 text-xs font-bold "+(expView===v?"bg-orange-500 text-white":sub)}>{l}</button>)}</div>
            <div className={"flex border-b "+dv}>{["JPY","USD"].map(c=><button key={c} type="button" onClick={()=>setDispExpCur(c)} className={"flex-1 py-1.5 text-xs font-bold "+(dispExpCur===c?(dark?"bg-gray-700 text-white":"bg-gray-200 text-gray-900"):sub)}>{c}</button>)}</div>
            {expView==="month"&&sortedExpMK.map(key=>{
              const items=expByMonth[key],open=expandedExpMonths[key];
              const mTotal=items.reduce((s,e)=>s+e.amount_jpy,0);
              const mTotalU=items.reduce((s,e)=>s+(e.amount_usd||(e.amount_jpy/(e.usd_jpy_rate||150))),0);
              const pct=totalExp>0?Math.round(mTotal/totalExp*100):0;
              return <div key={key} className={"border-b "+dv+" last:border-0"}>
                <button type="button" onClick={()=>setExpandedExpMonths(m=>({...m,[key]:!m[key]}))} className={"w-full flex items-center gap-3 px-4 py-3 "+hov}>
                  <div className="flex-1 text-left"><p className="text-sm font-semibold">{parseInt(key.split("-")[1])}月</p><p className={"text-xs "+sub}>{items.length}件 · {pct}%</p></div>
                  <p className="text-orange-500 font-bold text-sm">{dispExpCur==="USD"?fmtUSD(mTotalU):fmtJPY(mTotal)}</p>
                  {open?<ChevronUp size={14} className={sub}/>:<ChevronDown size={14} className={sub}/>}
                </button>
                <div className={"mx-4 mb-1.5 h-1 rounded-full "+(dark?"bg-gray-800":"bg-gray-100")}><div className="h-1 rounded-full bg-orange-500" style={{width:pct+"%"}}/></div>
                {open&&items.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(e=><ExpItemRow key={e.id} e={e} expView={expView} dispExpCur={dispExpCur} dark={dark} dv={dv} hov={hov} sub={sub} onEdit={()=>openEExp(e)} onDel={()=>delExp(e.id)}/>)}
              </div>;
            })}
            {expView==="cat"&&catTotals.map(({cat,total,items})=>{
              const open=expandedCats[cat],pct=totalExp>0?Math.round(total/totalExp*100):0;
              const catU=items.reduce((s,e)=>s+(e.amount_usd||(e.amount_jpy/(e.usd_jpy_rate||150))),0);
              return <div key={cat} className={"border-b "+dv+" last:border-0"}>
                <button type="button" onClick={()=>setExpandedCats(c=>({...c,[cat]:!c[cat]}))} className={"w-full flex items-center gap-3 px-4 py-3 "+hov}>
                  <div className="flex-1 text-left"><p className="text-sm font-semibold">{cat}</p><p className={"text-xs "+sub}>{items.length}件 · {pct}%</p></div>
                  <p className="text-orange-500 font-bold text-sm">{dispExpCur==="USD"?fmtUSD(catU):fmtJPY(total)}</p>
                  {open?<ChevronUp size={14} className={sub}/>:<ChevronDown size={14} className={sub}/>}
                </button>
                <div className={"mx-4 mb-1.5 h-1 rounded-full "+(dark?"bg-gray-800":"bg-gray-100")}><div className="h-1 rounded-full bg-orange-500" style={{width:pct+"%"}}/></div>
                {open&&items.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(e=><ExpItemRow key={e.id} e={e} expView={expView} dispExpCur={dispExpCur} dark={dark} dv={dv} hov={hov} sub={sub} onEdit={()=>openEExp(e)} onDel={()=>delExp(e.id)}/>)}
              </div>;
            })}
            {expView==="proj"&&projTotals.map(({proj,total,items})=>{
              const open=expandedProjs[proj],pct=totalExp>0?Math.round(total/totalExp*100):0;
              const projU=items.reduce((s,e)=>s+(e.amount_usd||(e.amount_jpy/(e.usd_jpy_rate||150))),0);
              return <div key={proj} className={"border-b "+dv+" last:border-0"}>
                <button type="button" onClick={()=>setExpandedProjs(p=>({...p,[proj]:!p[proj]}))} className={"w-full flex items-center gap-3 px-4 py-3 "+hov}>
                  <div className="flex-1 text-left"><p className="text-sm font-semibold">{proj}</p><p className={"text-xs "+sub}>{items.length}件 · {pct}%</p></div>
                  <p className="text-orange-500 font-bold text-sm">{dispExpCur==="USD"?fmtUSD(projU):fmtJPY(total)}</p>
                  {open?<ChevronUp size={14} className={sub}/>:<ChevronDown size={14} className={sub}/>}
                </button>
                <div className={"mx-4 mb-1.5 h-1 rounded-full "+(dark?"bg-gray-800":"bg-gray-100")}><div className="h-1 rounded-full bg-orange-500" style={{width:pct+"%"}}/></div>
                {open&&items.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(e=><ExpItemRow key={e.id} e={e} expView={expView} dispExpCur={dispExpCur} dark={dark} dv={dv} hov={hov} sub={sub} onEdit={()=>openEExp(e)} onDel={()=>delExp(e.id)}/>)}
              </div>;
            })}
          </div>}
        </div>}
      </div>}

      {tab==="tax"&&<div className="space-y-4">
        <div className={card+" border rounded-2xl p-4 space-y-2"}>
          <p className="text-sm font-semibold mb-1">USDC残高（自動集計）</p>
          {[["USD建て利益（取得）",usdc.totalAcquired.toFixed(2)+" USDC"],["USD建て経費（消費）","-"+usdc.totalExpUsd.toFixed(2)+" USDC"],["円転済み","-"+usdc.totalConverted.toFixed(2)+" USDC"],["現在保有（推定）",usdc.holdings.toFixed(2)+" USDC"],["平均取得レート","¥"+avgRate.toFixed(2)+"/$"]].map(([k,v])=>(
            <div key={k} className="flex justify-between text-sm"><span className={sub}>{k}</span><span className={"font-semibold "+(k==="現在保有（推定）"?"text-emerald-400":"")}>{v}</span></div>
          ))}
          <div className={"border-t pt-2 flex justify-between font-bold "+dv}><span className="text-sm">{year}年 為替損益</span><span className={yForex>=0?"text-emerald-500":"text-rose-500"}>{fmtJPY(yForex)}</span></div>
        </div>

        <div><p className="text-sm font-semibold mb-2">USDC円転履歴</p>
          <div className={card+" border rounded-2xl overflow-hidden"}>
            {convs.length===0&&<p className={"text-center py-4 text-sm "+sub}>データなし</p>}
            {convs.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(c=>{
              const pnl=(c.usd_jpy_rate-avgRate)*c.amount_usdc;
              return <div key={c.id} className={"flex items-center gap-2 px-3 py-2.5 border-b "+dv+" last:border-0"}>
                <span className={"text-xs w-11 shrink-0 "+sub}>{c.created_at.slice(5).replace("-","/")}</span>
                <span className={"text-xs flex-1 truncate "+sub}>{c.memo}</span>
                <div className="text-right shrink-0"><p className={"text-xs font-bold "+(pnl>=0?"text-emerald-500":"text-rose-500")}>{c.amount_usdc.toLocaleString()} USDC · {fmtJPY(pnl)}</p><p className={"text-xs "+sub}>¥{c.usd_jpy_rate}/$</p></div>
                <button type="button" onClick={()=>openEConv(c)} className={"p-1 rounded "+hov}><Pencil size={11} className={sub}/></button>
                <button type="button" onClick={()=>delConv(c.id)} className={"p-1 rounded "+hov}><Trash2 size={11} className="text-rose-500"/></button>
              </div>;
            })}
          </div>
        </div>

        <div className={card+" border rounded-2xl p-4 space-y-2"}>
          <p className="font-semibold text-sm mb-1">{year}年 損益計算</p>
          {[["取引総利益",fmtJPY(tProfJPY),"text-emerald-500"],["取引総損失","−"+fmtJPY(tLossJPY),"text-rose-500"],["USDC為替損益",fmtJPY(yForex),yForex>=0?"text-emerald-500":"text-rose-500"],["経費合計","−"+fmtJPY(totalExp),"text-orange-500"]].map(([k,v,c])=>(
            <div key={k} className="flex justify-between text-sm"><span className={sub}>{k}</span><span className={"font-medium "+c}>{v}</span></div>
          ))}
          <div className={"border-t pt-2 flex justify-between font-bold "+dv}><span>課税所得</span><span className="text-violet-400">{fmtJPY(taxable)}</span></div>
        </div>

        <div className={card+" border rounded-2xl p-4 space-y-3"}>
          <p className="font-semibold text-sm">推定税額</p>
          <div className={"rounded-xl p-3 text-xs space-y-1 "+(dark?"bg-gray-800":"bg-gray-50")}>
            <p className={"font-semibold mb-1 "+(dark?"text-gray-300":"text-gray-600")}>📐 計算方法</p>
            <p className={sub}>推定税額 ＝ 課税所得 × <span className="text-amber-400 font-bold">{taxRateOvr}%</span>（固定税率）</p>
            <p className={sub}>暗号資産取引では所得税＋住民税を合わせると概ね30%前後になることが多いため、デフォルトを30%に設定しています。</p>
          </div>
          <div className="flex justify-between text-sm"><span className={sub}>適用税率</span><span className="font-bold text-amber-400">{taxRateOvr}%</span></div>
          <div className={"border-t pt-3 "+dv}>
            <div className="flex justify-between items-center"><span className="font-bold text-base">推定税額</span><span className="font-bold text-xl text-rose-500">{fmtJPY(taxEst)}</span></div>
            {taxable>0&&<div className="flex justify-between items-center mt-1"><span className={"text-xs "+sub}>参考：累進課税ベース実効税率</span><span className={"text-sm font-semibold text-gray-400"}>{effRate.toFixed(1)}%</span></div>}
          </div>
          <div className={"rounded-xl p-3 border "+(dark?"border-gray-700":"border-gray-200")}>
            <p className={"text-xs font-semibold mb-2 "+(dark?"text-gray-300":"text-gray-600")}>税率を手動変更</p>
            {!editingRate
              ?<button type="button" onClick={()=>{setRateInput(String(taxRateOvr));setEditingRate(true);}} className={"flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg "+(dark?"bg-gray-700 text-gray-300":"bg-gray-100 text-gray-600")}><Edit2 size={11}/>現在 {taxRateOvr}% → 変更する</button>
              :<div className="flex items-center gap-2">
                <NumInp dark={dark} value={rateInput} onChange={e=>setRateInput(e.target.value)} className="w-20 text-center py-1.5"/>
                <span className="text-sm font-bold">%</span>
                <button type="button" onClick={()=>{const v=parseFloat(rateInput);if(!isNaN(v)&&v>0&&v<=100){setTaxRateOvr(v);}setEditingRate(false);}} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500 text-white font-semibold">確定</button>
                <button type="button" onClick={()=>setEditingRate(false)} className={"text-xs px-2 py-1.5 rounded-lg "+(dark?"bg-gray-700 text-gray-300":"bg-gray-200 text-gray-600")}>✕</button>
              </div>}
          </div>
          <p className={"text-xs "+sub}>※ 簡易計算。復興特別所得税・各種控除等は含みません。実際は税理士にご確認ください。</p>
        </div>

        <div className={card+" border rounded-2xl p-4 space-y-2"}>
          <p className="text-xs font-semibold mb-1">参考：所得税 累進税率テーブル</p>
          {[[0,1950000,"5%","15%"],[1950000,3300000,"10%","20%"],[3300000,6950000,"20%","30%"],[6950000,9000000,"23%","33%"],[9000000,18000000,"33%","43%"],[18000000,40000000,"40%","50%"],[40000000,Infinity,"45%","55%"]].map(([lo,hi,it,total])=>{
            const active=taxable>lo&&taxable<=(hi===Infinity?1e15:hi);
            return <div key={lo} className={"flex justify-between items-center text-xs px-2 py-1 rounded "+(active?(dark?"bg-violet-900/50 border border-violet-500/50":"bg-violet-50 border border-violet-200"):"")}>
              <span className={sub}>{fmtJPY(lo)} 〜 {hi===Infinity?"∞":fmtJPY(hi)}</span>
              <div className="flex gap-3 items-center"><span className={sub}>所得税 {it}</span><span className={"font-bold "+(active?"text-violet-400":"")}> 合計 {total}</span></div>
            </div>;
          })}
          <p className={"text-xs "+sub}>※ 合計＝所得税＋住民税10%</p>
        </div>
      </div>}

      {tab==="settings"&&<div className="space-y-4">
        <div className={"border rounded-2xl p-4 space-y-3 "+(dark?"bg-emerald-950/30 border-emerald-500/40":"bg-emerald-50 border-emerald-200")}>
          <div className="flex items-center gap-2"><Shield size={16} className="text-emerald-400"/><p className={"text-sm font-semibold "+(dark?"text-emerald-300":"text-emerald-700")}>🔒 データは完全にあなたの端末に保存</p></div>
          <p className={"text-xs leading-relaxed "+(dark?"text-emerald-400/80":"text-emerald-800")}>すべてのデータはお使いの端末（ブラウザのlocalStorage）にのみ保存されます。外部サーバーへのデータ送信は一切ありません。</p>
        </div>

        <div className={"border rounded-2xl p-4 space-y-3 "+(dark?"bg-blue-950/30 border-blue-500/40":"bg-blue-50 border-blue-200")}>
          <div className="flex items-center gap-2"><Globe size={16} className="text-blue-400"/><p className={"text-sm font-semibold "+(dark?"text-blue-300":"text-blue-700")}>🏢 信頼性の高いインフラで運用</p></div>
          <p className={"text-xs leading-relaxed "+(dark?"text-blue-400/80":"text-blue-800")}>このアプリは <span className="font-bold">GitHub</span>（コード管理）と <span className="font-bold">Vercel</span>（ホスティング）を利用して公開・運用されています。いずれも世界中の企業・開発者が採用する大手プラットフォームであり、セキュリティ・可用性の面でも安心してご利用いただけます。</p>
          <div className="grid grid-cols-2 gap-2">
            <div className={"p-2.5 rounded-xl text-center "+(dark?"bg-gray-800/60":"bg-white/70")}><p className="text-xs font-bold mb-0.5">GitHub</p><p className={"text-xs "+(dark?"text-gray-400":"text-gray-600")}>ソースコードを公開。誰でもコードを確認できるため、不正な処理がないことを透明性をもって確認できます。</p></div>
            <div className={"p-2.5 rounded-xl text-center "+(dark?"bg-gray-800/60":"bg-white/70")}><p className="text-xs font-bold mb-0.5">Vercel</p><p className={"text-xs "+(dark?"text-gray-400":"text-gray-600")}>CDN配信・HTTPS常時接続。エンタープライズ級インフラ。</p></div>
          </div>
        </div>

        <div className={"border rounded-2xl p-4 space-y-3 "+(dark?"bg-violet-950/30 border-violet-500/40":"bg-violet-50 border-violet-200")}>
          <div className="flex items-center gap-2"><Lock size={16} className="text-violet-400"/><p className={"text-sm font-semibold "+(dark?"text-violet-300":"text-violet-700")}>📜 為替レートの法的根拠</p></div>
          <div className={"p-3 rounded-xl "+(dark?"bg-gray-800/60":"bg-white/70")}>
            <p className={"text-xs italic leading-relaxed "+(dark?"text-gray-300":"text-gray-700")}>「電信売相場、電信買相場及び電信売買相場の仲値については、原則として、その者の主たる取引金融機関のものによることとするが、<span className="font-bold">合理的なものを継続して使用している場合には、これを認める。</span>」</p>
            <p className={"text-xs mt-2 "+(dark?"text-gray-500":"text-gray-500")}>— 所得税基本通達 法第57条の3《外貨建取引の換算》関係 3-2</p>
          </div>
          <div className={"p-3 rounded-xl space-y-1 "+(dark?"bg-gray-800/60":"bg-white/70")}>
            <p className="text-xs font-semibold">📡 使用API：ExchangeRate-API</p>
            <p className={"text-xs break-all font-mono "+(dark?"text-gray-400":"text-gray-600")}>https://open.er-api.com/v6/latest/USD</p>
            <p className={"text-xs mt-1 "+(dark?"text-gray-500":"text-gray-600")}>Reuters・主要金融機関など複数ソースから集約した市場中間値（数時間ごと更新）。APIキー不要・HTTPS・世界180カ国以上の企業が採用する信頼性の高いサービスです。銀行TTMと非常に近い値を提供します。</p>
          </div>
        </div>

        <div className={"border rounded-2xl p-4 space-y-3 "+(dark?"bg-amber-950/30 border-amber-500/40":"bg-amber-50 border-amber-200")}>
          <div className="flex items-center gap-2"><AlertTriangle size={16} className="text-amber-400"/><p className={"text-sm font-semibold "+(dark?"text-amber-300":"text-amber-700")}>⚠️ バックアップ推奨</p></div>
          <p className={"text-xs "+(dark?"text-amber-400/80":"text-amber-800")}>ブラウザのキャッシュ削除・機種変更でデータが消えます。定期的にCSV出力してください。</p>
          <button type="button" onClick={exportCSV} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600"><Download size={14}/>{year}年 CSVをエクスポート</button>
        </div>

        <div className={card+" border rounded-2xl overflow-hidden"}>
          <div className={"px-4 py-3 border-b "+dv}><p className="text-sm font-semibold">CSVインポート</p><p className={"text-xs mt-0.5 "+sub}>エクスポートしたCSVから復元</p></div>
          <div className="p-4 space-y-3">
            <input type="file" accept=".csv" ref={importRef} onChange={handleImport} className="hidden"/>
            <button type="button" onClick={()=>importRef.current?.click()} className={"w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border "+(dark?"border-gray-700 text-gray-300 hover:bg-gray-800":"border-gray-300 text-gray-700 hover:bg-gray-50")}><Upload size={14}/>CSVファイルをインポート</button>
            {importMsg&&<p className={"text-xs text-center "+(importMsg.ok?"text-emerald-400":"text-rose-400")}>{importMsg.msg}</p>}
          </div>
        </div>

        <div className={card+" border rounded-2xl overflow-hidden"}>
          <div className="flex items-center justify-between px-4 py-3.5">
            <span className="text-sm font-medium">ダークモード</span>
            <button type="button" onClick={()=>setDark(d=>!d)} className={"w-12 h-6 rounded-full relative "+(dark?"bg-gray-600":"bg-gray-300")}>
              <span className={"absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform "+(dark?"translate-x-6":"")}/>
            </button>
          </div>
        </div>

        <div className={"text-center py-3 space-y-1 "+(dark?"text-gray-600":"text-gray-400")}>
          <p className="text-xs">📒 クリプト損益台帳 Ver 1.10</p>
          <p className="text-xs">開発: <a href="https://x.com/babucrypter" target="_blank" rel="noopener noreferrer" className="text-blue-400">𝕏 @babucrypter</a></p>
        </div>
      </div>}
      </div>

      <div className={"fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md border-t z-20 flex "+tabBg}>
        {TABS.map(item=>{const Icon=item.icon;return(
          <button key={item.id} type="button" onClick={()=>setTab(item.id)} className={"flex-1 flex flex-col items-center py-3 gap-0.5 "+(tab===item.id?(dark?"text-white":"text-gray-900"):"text-gray-500")}>
            <Icon size={20}/><span className="text-xs">{item.label}</span>
          </button>
        );})}
      </div>

      {showTxM&&<Modal dark={dark} title="取引を編集" onClose={()=>setShowTxM(false)} onSave={saveTxE} saving={modalSaving}>
        <div className="space-y-3">
          <div><Lbl cls={sub}>通貨タイプ</Lbl><CurrencyToggle dark={dark} value={txF.currency_type} onChange={v=>pTx({currency_type:v})}/></div>
          {txF.currency_type==="USD"?<div className="grid grid-cols-2 gap-2"><div><Lbl color="green">📈 利益（USD）</Lbl><NumInp dark={dark} placeholder="0.00" value={txF.profit_usd} onChange={e=>pTx({profit_usd:e.target.value})} color="green"/></div><div><Lbl color="red">📉 損失（USD）</Lbl><NumInp dark={dark} placeholder="0.00" value={txF.loss_usd} onChange={e=>pTx({loss_usd:e.target.value})} color="red"/></div></div>:<div className="grid grid-cols-2 gap-2"><div><Lbl color="green">📈 利益（JPY）</Lbl><NumInp dark={dark} placeholder="0" value={txF.profit_jpy} onChange={e=>pTx({profit_jpy:e.target.value})} color="green"/></div><div><Lbl color="red">📉 損失（JPY）</Lbl><NumInp dark={dark} placeholder="0" value={txF.loss_jpy} onChange={e=>pTx({loss_jpy:e.target.value})} color="red"/></div></div>}
          <RateStatus dark={dark} rateCache={rateCache} date={txF.created_at} fetching={modalSaving} currency_type={txF.currency_type}/>
          <div><Lbl cls={sub}>カテゴリ</Lbl><CatChips dark={dark} cats={txCats} setCats={setTxCats} selected={txF.category} onSelect={v=>pTx({category:v})}/></div>
          <div><Lbl cls={sub}>メモ</Lbl><Inp dark={dark} value={txF.memo} onChange={e=>pTx({memo:e.target.value})}/></div>
          <div><Lbl cls={sub}>日付</Lbl><DateInp dark={dark} value={txF.created_at} onChange={e=>pTx({created_at:e.target.value})}/></div>
        </div>
      </Modal>}
      {showExpM&&<Modal dark={dark} title="経費を編集" onClose={()=>setShowExpM(false)} onSave={saveExpE} saving={modalSaving}>
        <div className="space-y-3">
          <div><Lbl cls={sub}>通貨タイプ</Lbl><CurrencyToggle dark={dark} value={expF.currency_type} onChange={v=>pExp({currency_type:v})}/></div>
          {expF.currency_type==="USD"?<><div><Lbl cls={sub}>金額（USD）</Lbl><NumInp dark={dark} placeholder="0.00" value={expF.amount_usd} onChange={e=>pExp({amount_usd:e.target.value})}/></div><RateStatus dark={dark} rateCache={rateCache} date={expF.created_at} fetching={modalSaving} currency_type="USD"/></>:<div><Lbl cls={sub}>金額（JPY）</Lbl><NumInp dark={dark} placeholder="0" value={expF.amount_jpy} onChange={e=>pExp({amount_jpy:e.target.value})}/></div>}
          <div><Lbl cls={sub}>カテゴリ</Lbl><CatChips dark={dark} cats={expCats} setCats={setExpCats} selected={expF.category} onSelect={v=>pExp({category:v})}/></div>
          <div><Lbl cls={sub}>プロジェクト</Lbl><CatChips dark={dark} cats={expProjs} setCats={setExpProjs} selected={expF.project} onSelect={v=>pExp({project:v})}/></div>
          <div><Lbl cls={sub}>メモ</Lbl><Inp dark={dark} value={expF.memo} onChange={e=>pExp({memo:e.target.value})}/></div>
          <div><Lbl cls={sub}>日付</Lbl><DateInp dark={dark} value={expF.created_at} onChange={e=>pExp({created_at:e.target.value})}/></div>
        </div>
      </Modal>}
      {showConvM&&<Modal dark={dark} title="円転を編集" onClose={()=>setShowConvM(false)} onSave={saveConvE} saving={modalSaving}>
        <div className="space-y-3">
          <div><Lbl cls={sub}>円転量（USDC）</Lbl><NumInp dark={dark} placeholder="0" value={convF.amount_usdc} onChange={e=>pConv({amount_usdc:e.target.value})}/></div>
          <RateStatus dark={dark} rateCache={rateCache} date={convF.created_at} fetching={modalSaving} currency_type="USD"/>
          <div><Lbl cls={sub}>メモ</Lbl><Inp dark={dark} placeholder="例：円転" value={convF.memo} onChange={e=>pConv({memo:e.target.value})}/></div>
          <div><Lbl cls={sub}>日付</Lbl><DateInp dark={dark} value={convF.created_at} onChange={e=>pConv({created_at:e.target.value})}/></div>
        </div>
      </Modal>}
    </div>
  </div>;
}
