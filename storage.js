import {VERSION,MODEL_ID,newDraft,now,normalizeDoi,validDoi,assertSchema,schemas,validateOptions} from './core.js';
const PREFIX = 'ruang-riset-sd:v1:';
export const DEFAULT_SETTINGS = {model:MODEL_ID,maxTokens:10000,timeout:240,email:''};
const get = (storage,key) => {try{return storage.getItem(PREFIX+key);}catch{return null;}};
function set(storage,key,value) { try{storage.setItem(PREFIX+key,value);}catch{throw Error('Penyimpanan browser penuh atau diblokir. Cadangkan draf JSON sebelum menutup halaman.');} }
const remove=(storage,key)=>{try{storage.removeItem(PREFIX+key);}catch{/* unavailable storage */}};
export function settings() {try{return {...DEFAULT_SETTINGS,...JSON.parse(get(localStorage,'settings') || '{}'),model:MODEL_ID};}catch{return {...DEFAULT_SETTINGS};}}
export function saveSettings(value) {
  const clean={model:MODEL_ID,maxTokens:Number(value.maxTokens),timeout:Number(value.timeout),email:String(value.email||'').trim()};
  if (clean.maxTokens<2000 || clean.maxTokens>32000 || clean.timeout<30 || clean.timeout>600 || !Number.isFinite(clean.maxTokens+clean.timeout)) throw Error('Batas penggunaan tidak valid.');
  set(localStorage,'settings',JSON.stringify(clean));return clean;
}
export const apiKey=()=>get(sessionStorage,'key')||get(localStorage,'key')||'';
export const remembered=()=>Boolean(get(localStorage,'key'));
export function saveKey(value,remember=false) {
  if (!/^sk-[^\s]{10,}$/.test(value)) throw Error('Periksa kembali format API key OpenAI.');
  const target=remember?localStorage:sessionStorage, other=remember?sessionStorage:localStorage;
  set(target,'key',value);remove(other,'key');
}
export function deleteKey() {remove(localStorage,'key');remove(sessionStorage,'key');}
const DB='ruang-riset-sd',STORE='drafts';
let database;
function db() {
  if (!database) database=new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('IndexedDB diblokir. Aktifkan penyimpanan situs untuk menyimpan draf.'));});
  return database;
}
async function transact(mode,fn) {
  const database=await db();
  return new Promise((resolve,reject)=>{const tx=database.transaction(STORE,mode);const req=fn(tx.objectStore(STORE));tx.oncomplete=()=>resolve(req.result);tx.onerror=tx.onabort=()=>reject(Error('Draf belum tersimpan. Cadangkan JSON dan periksa ruang penyimpanan browser.'));});
}
export async function saveDraft(draft) {draft.updatedAt=now();await transact('readwrite',s=>s.put(draft));try{set(localStorage,'last-draft',draft.id);}catch{/* draft is safely saved in IndexedDB */}return draft;}
export const listDrafts=async()=>((await transact('readonly',s=>s.getAll()))||[]).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
export const loadDraft=id=>transact('readonly',s=>s.get(id));
export const lastDraftId=()=>get(localStorage,'last-draft');
export const deleteDraft=id=>transact('readwrite',s=>s.delete(id));
// Whitelisting keeps settings, credentials and unrelated imported fields out of backups.
export function exportDraft(draft) {
  const copy={...draft};delete copy.apiKey;delete copy.api_key;delete copy.settings;
  return JSON.stringify({format:'ruang-riset-sd/v1',exportedAt:now(),draft:copy},null,2);
}
export function parseImport(text) {
  if(text.length>5_000_000) throw Error('Cadangan terlalu besar (maksimum 5 MB).');
  let file;try{file=JSON.parse(text);}catch{throw Error('Berkas bukan JSON yang valid.');}
  const item=file?.draft;
  if(file?.format!=='ruang-riset-sd/v1'||item?.version!==VERSION||!item.input||typeof item.title!=='string'||!Array.isArray(item.references)||item.references.length>100) throw Error('Gunakan cadangan JSON dari Ruang Riset SD versi ini.');
  const draft=newDraft();
  const textField=value=>{if(typeof value!=='string'||value.length>16000)throw Error('Isi cadangan tidak valid.');return value;};
  for(const key of Object.keys(draft.input))draft.input[key]=textField(item.input[key]);
  for(const key of Object.keys(draft.methodInput))draft.methodInput[key]=textField(item.methodInput?.[key]||'');
  draft.title=textField(item.title);draft.methodChoice=textField(item.methodChoice||'');
  if(item.titleOptions?.length)draft.titleOptions=validateOptions('titles',{options:item.titleOptions});
  if(item.methodOptions?.length)draft.methodOptions=validateOptions('methods',{options:item.methodOptions});
  for(const kind of ['introduction','methodology'])if(item[kind]){assertSchema(item[kind],schemas[kind]);draft[kind]=item[kind];}
  draft.pendingAudit=['introduction','methodology'].filter(kind=>draft[kind]);
  if(draft.introduction&&!draft.title.trim()||draft.methodology&&!draft.introduction)throw Error('Urutan bagian dalam draf impor tidak lengkap.');
  const seen=new Set();let selectedCount=0;
  draft.references=item.references.map(ref=>{const doi=normalizeDoi(ref?.doi);if(!validDoi(doi)||seen.has(doi))throw Error('Ada DOI tidak valid atau duplikat dalam cadangan.');seen.add(doi);const selected=Boolean(ref.selected)&&selectedCount++<8;return {id:doi,doi,title:textField(ref.title||doi),authors:[],year:'',abstract:'',selected,origin:'Impor',provider:'',verifiedAt:''};});
  return draft;
}
