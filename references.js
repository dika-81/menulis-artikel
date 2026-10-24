import {plain,normalizeDoi,validDoi,now,eligible,isVerified,normalized,sourceIdentity} from './core.js';
const BASE='https://api.crossref.org/works';
const cache=new Map();
let nextRequest=0, localPromise;
const stop=new Set('dan atau yang untuk dengan dari pada dalam penelitian pengaruh penggunaan penerapan pengembangan meningkatkan kemampuan siswa peserta didik sekolah dasar kelas model metode media pembelajaran pendidikan the and for with from study effect using primary elementary school education learning research terhadap'.split(' '));
const words=text=>new Set(normalized(text).match(/[\p{L}\p{N}]{3,}/gu)?.filter(w=>!stop.has(w))||[]);
const topicOverlap=(ref,query)=>{const terms=words(query),content=words(`${ref.title} ${ref.abstract||''}`);return [...terms].filter(word=>content.has(word)).length;};
const translations=[[/literasi/g,'literacy'],[/membaca/g,'reading'],[/menulis/g,'writing'],[/numerasi/g,'numeracy'],[/matematika|berhitung/g,'mathematics'],[/pecahan/g,'fractions'],[/geometri/g,'geometry'],[/karakter/g,'character education'],[/inklusi|inklusif/g,'inclusive education'],[/disabilitas/g,'disability'],[/asesmen|penilaian/g,'assessment'],[/formatif/g,'formative'],[/teknologi/g,'technology'],[/digital/g,'digital'],[/perundungan|bullying/g,'bullying'],[/kecerdasan buatan|\bai\b/g,'artificial intelligence'],[/ipas|sains/g,'science'],[/lingkungan/g,'environmental'],[/etnomatematika/g,'ethnomathematics'],[/kritis/g,'critical thinking'],[/motivasi/g,'motivation'],[/diferensiasi/g,'differentiated instruction'],[/tindakan kelas|\bptk\b/g,'classroom action research'],[/eksperimen/g,'experimental design'],[/kualitatif|studi kasus/g,'qualitative case study'],[/survei/g,'survey questionnaire'],[/ras ch|rasch/g,'Rasch'],[/likert/g,'Likert'],[/addie/g,'ADDIE instructional design']];
export function translatedQuery(text,method=false) {
  const input=normalized(text),terms=translations.filter(([regex])=>{regex.lastIndex=0;return regex.test(input);}).map(([,value])=>value);
  return [...new Set(terms)].join(' ') + (method?'':' primary elementary school');
}
export function relevance(ref,query) {
  const terms=words(query), content=words(`${ref.title} ${ref.abstract||''}`);
  let score=[...terms].filter(w=>content.has(w)).length;
  if(/primary|elementary|sekolah dasar|sekolah rendah|\bsd\b/i.test(`${ref.title} ${ref.abstract||''}`))score+=2;
  return score;
}
async function request(url,signal) {
  const wait=Math.max(0,nextRequest-Date.now());
  if(wait)await new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,wait);const abort=()=>{clearTimeout(timer);reject(new DOMException('Dibatalkan','AbortError'));};if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
  signal?.throwIfAborted();nextRequest=Date.now()+1100;
  const response=await fetch(url,{signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(25000)]),referrerPolicy:'no-referrer'});
  if(!response.ok)throw Error(response.status===429?'Crossref membatasi permintaan. Tunggu sebentar lalu coba lagi.':`Crossref tidak tersedia (HTTP ${response.status}).`);
  const result=await response.json();if(result.status!=='ok')throw Error('Respons Crossref tidak valid.');return result.message;
}
export function fromCrossref(item,origin='Daring') {
  const doi=normalizeDoi(item.DOI);
  const year=(item.published?.['date-parts']||item['published-print']?.['date-parts']||item['published-online']?.['date-parts'])?.[0]?.[0];
  if(!validDoi(doi)||!item.title?.[0]||!item.author?.length||!year||year>new Date().getFullYear())return null;
  const authors=item.author.map(author=>({family:plain(author.family||author.name||''),given:plain(author.given||'')})).filter(a=>a.family);
  if(!authors.length)return null;
  const ref={id:doi,doi,title:plain(item.title[0]),authors,year:String(year),journal:plain(item['container-title']?.[0]||item.publisher||''),volume:plain(item.volume),issue:plain(item.issue),pages:plain(item.page||item['article-number']),abstract:plain(item.abstract).slice(0,14000),provider:'Crossref',origin,verifiedAt:now(),selected:false};
  cache.set(doi,ref);return ref;
}
export async function verifyDoi(value,{signal,email='',origin='DOI',force=false}={}) {
  const doi=normalizeDoi(value);if(!validDoi(doi))throw Error('Format DOI tidak valid.');
  if(!force&&cache.has(doi)&&isVerified(cache.get(doi)))return {...cache.get(doi),origin};
  const url=new URL(`${BASE}/${encodeURIComponent(doi)}`);if(email)url.searchParams.set('mailto',email);
  const ref=fromCrossref(await request(url,signal),origin);
  if(!ref)throw Error('Metadata DOI belum lengkap: judul, penulis, atau tahun tidak tersedia.');return ref;
}
async function localReferences(){if(!localPromise)localPromise=fetch(new URL('./local-references.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('Koleksi lokal gagal dimuat.');return r.json();}).catch(error=>{localPromise=null;throw error;});return localPromise;}
export async function searchReferences(query,{signal,email='',method=false,progress=()=>{}}={}) {
  const found=[],warnings=[];
  if(validDoi(normalizeDoi(query)))return {references:[await verifyDoi(query,{signal,email})],warnings};
  progress('Menelusuri koleksi lokal dan metadata Crossref…');
  try {
    const candidates=(await localReferences()).map(ref=>({...ref,score:relevance(ref,query)})).filter(ref=>topicOverlap(ref,query)>0).sort((a,b)=>b.score-a.score).slice(0,4);
    for(const candidate of candidates){
      try {
        const ref=await verifyDoi(candidate.doi,{signal,email,origin:'Lokal + Crossref'});
        const old=words(candidate.title),actual=words(ref.title),matches=[...old].filter(word=>actual.has(word));
        if(old.size&&matches.length/old.size<.5){warnings.push(`Entri lokal “${candidate.title}” dikeluarkan karena judul DOI berbeda.`);continue;}
        found.push(ref);
      }catch(error){if(signal?.aborted)throw error;warnings.push(`Satu kandidat lokal tidak dapat diverifikasi (${candidate.doi}).`);}
    }
  }catch(error){if(signal?.aborted)throw error;warnings.push('Koleksi lokal belum tersedia; pencarian daring tetap dijalankan.');}
  const translated=translatedQuery(query,method).trim();
  const queries=[query,...(translated&&normalized(query)!==normalized(translated)?[translated]:[])];
  for(const term of queries){
    progress(`Mencari literatur: ${term.slice(0,90)}…`);
    const url=new URL(BASE);url.searchParams.set('query.bibliographic',term.slice(0,400));url.searchParams.set('rows','18');
    url.searchParams.set('filter',`type:journal-article,until-pub-date:${now().slice(0,10)}${method?'':`,from-pub-date:${new Date().getFullYear()-10}-01-01`}`);
    url.searchParams.set('select','DOI,title,author,published,container-title,abstract,volume,issue,page,URL');if(email)url.searchParams.set('mailto',email);
    try {
      const message=await request(url,signal);for(const item of message.items||[]){const ref=fromCrossref(item);if(ref&&relevance(ref,`${query} ${translated}`)>=(method?1:3))found.push(ref);}
    }catch(error){if(signal?.aborted)throw error;warnings.push(error.name==='TimeoutError'?'Pencarian Crossref melewati batas waktu.':error.message);}
  }
  const unique=[...new Map([...new Map(found.map(ref=>[ref.id,ref])).values()].map(ref=>[sourceIdentity(ref),ref])).values()].sort((a,b)=>Number(eligible(b))-Number(eligible(a))||relevance(b,`${query} ${translated}`)-relevance(a,`${query} ${translated}`)||Number(b.year)-Number(a.year)).slice(0,18);
  return {references:unique,warnings};
}
export function mergeReferences(existing,incoming) {
  const map=new Map(existing.map(ref=>[ref.id,ref]));
  let count=existing.filter(ref=>ref.selected&&eligible(ref)).length;
  for(const ref of incoming){const previous=map.get(ref.id);if(!previous&&[...map.values()].some(item=>sourceIdentity(item)===sourceIdentity(ref)))continue;const selected=previous?.selected??(eligible(ref)&&count<6);if(!previous?.selected&&selected&&eligible(ref))count++;map.set(ref.id,{...ref,selected});}
  return [...map.values()].slice(0,80);
}
