// Data contracts and evidence checks shared by the interface, AI, and exports.
export const VERSION = 1;
export const MODEL_ID = 'gpt-6.1-sol';
export const now = () => new Date().toISOString();
export const plain = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
  const named = {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
  if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
  const number = entity.startsWith('&#x') ? parseInt(entity.slice(3),16) : parseInt(entity.slice(2),10);
  return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
}).replace(/\s+/g,' ').trim();
export const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const normalizeDoi = text => String(text ?? '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').toLowerCase().replace(/[.,;]+$/,'');
export const validDoi = doi => /^10\.\d{4,9}\/[^\s<>"?#]+$/i.test(doi);
export const normalized = text => plain(text).normalize('NFKC').toLowerCase();
export const sourceIdentity = ref => normalized(ref.title).replace(/[^\p{L}\p{N}]/gu,'');
export function newDraft() {
  return {version:VERSION,id:crypto.randomUUID(),createdAt:now(),updatedAt:now(),input:{theme:'',problem:'',grade:'Belum ditentukan',context:'',goal:''},titleOptions:[],title:'',introduction:null,methodOptions:[],methodChoice:'',methodInput:{design:'',subjects:'',instruments:'',analysis:'',procedure:''},methodology:null,references:[],pendingAudit:[]};
}
export function resetAfter(draft, stage) {
  if (stage === 'input') { draft.titleOptions=[]; draft.title=''; }
  if (['input','title'].includes(stage)) { draft.introduction=null; draft.methodOptions=[]; draft.methodChoice=''; }
  if (['input','title','introduction','method'].includes(stage)) draft.methodology=null;
  draft.pendingAudit=(draft.pendingAudit||[]).filter(kind=>draft[kind]);
}
export function isVerified(ref) {
  const checked = Date.parse(ref.verifiedAt);
  return validDoi(ref.doi) && ref.id === ref.doi && ref.title && ref.authors?.length > 0 && ref.year && Number.isFinite(checked) && checked <= Date.now() + 60000 && Date.now() - checked < 7*86400000 && ref.provider === 'Crossref';
}
export const eligible = ref => Boolean(isVerified(ref) && ref.abstract?.length >= 80);
export const selectedSources = draft => draft.references.filter(ref => ref.selected && eligible(ref));

const str = {type:'string'};
const array = items => ({type:'array',items});
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const evidence = object({source_id:str,quote:str});
const sentence = object({text:str,kind:{type:'string',enum:['literature','plan']},evidence:array(evidence)});
const paragraph = object({sentences:array(sentence)});
export const schemas = {
  titles: object({options:array(object({title:str,reason:str,method_hint:str,limitations:str}))}),
  introduction: object({paragraphs:array(paragraph),objective:str,question:str}),
  methods: object({options:array(object({name:str,reason:str,data_needed:str,analysis:str,limitations:str}))}),
  methodology: object({sections:array(object({heading:str,paragraphs:array(paragraph)})),missing_info:array(str)}),
  audit: object({checks:array(object({id:str,supported:{type:'boolean'},reason:str}))}),
};
export function assertSchema(data, schema, path='hasil') {
  if (schema.type === 'object') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(`${path} harus berupa objek.`);
    for (const key of schema.required) if (!(key in data)) throw Error(`${path}.${key} belum tersedia.`);
    for (const key of Object.keys(data)) {
      if (!schema.properties[key]) throw Error(`Field tidak dikenal: ${path}.${key}.`);
      assertSchema(data[key],schema.properties[key],`${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(data) || data.length > 120) throw Error(`${path} bukan daftar yang valid.`);
    data.forEach((item,i) => assertSchema(item,schema.items,`${path}[${i}]`));
  } else if (typeof data !== schema.type || (schema.enum && !schema.enum.includes(data))) throw Error(`Format ${path} tidak valid.`);
  if (typeof data === 'string' && data.length > 16000) throw Error(`${path} terlalu panjang.`);
}
export function sentencesOf(data) {
  const paragraphs = data?.paragraphs || data?.sections?.flatMap(section=>section.paragraphs) || [];
  return paragraphs.flatMap(paragraph=>paragraph.sentences);
}
const rawCitation = /https?:\/\/|\b10\.\d{4,9}\/|\([^()\n]*\b(?:19|20)\d{2}[a-z]?\)|\[(?:R\d|ref|doi)[^\]]*\]/i;
export function validatePassages(kind, data, references) {
  assertSchema(data,schemas[kind]);
  const refs = new Map(references.filter(eligible).map(ref=>[ref.id,ref]));
  if (kind === 'introduction' && (data.paragraphs.length < 3 || data.paragraphs.length > 5 || !data.objective.trim() || !data.question.trim())) throw Error('Pendahuluan harus terdiri atas 3–5 paragraf, tujuan, dan rumusan masalah.');
  if (kind === 'methodology' && (data.sections.length < 5 || data.sections.length > 10)) throw Error('Metodologi harus mencakup 5–10 komponen penelitian.');
  const paragraphs = data.paragraphs || data.sections.flatMap(s=>s.paragraphs);
  if (paragraphs.some(p=>!p.sentences.length)) throw Error('Ada paragraf kosong dalam keluaran AI.');
  const sentences = sentencesOf(data);
  const used = new Set();
  for (const item of sentences) {
    if (!item.text.trim() || rawCitation.test(item.text)) throw Error('Teks memuat sitasi/tautan bebas atau kalimat kosong. Jalankan ulang tahap ini.');
    if (item.kind === 'plan' && item.evidence.length) throw Error('Rencana penelitian harus dipisahkan dari klaim literatur.');
    if (item.kind === 'literature' && !item.evidence.length) throw Error('Ada klaim literatur tanpa bukti sumber.');
    for (const proof of item.evidence) {
      const ref = refs.get(proof.source_id);
      if (!ref) throw Error('AI menggunakan sumber yang belum dipilih atau belum terverifikasi.');
      const quote = normalized(proof.quote);
      if (quote.length < 25 || !normalized(ref.abstract).includes(quote)) throw Error('Potongan bukti tidak ditemukan dalam abstrak sumber. Keluaran ditolak.');
      used.add(ref.id);
    }
  }
  if (new Set([...used].map(id=>sourceIdentity(refs.get(id)))).size < (kind === 'introduction' ? 2 : 1)) throw Error('Bukti literatur belum cukup: gunakan minimal dua sumber berbeda untuk pendahuluan dan satu untuk metodologi.');
  if (kind === 'introduction' && [data.objective,data.question].some(text=>!text.trim() || rawCitation.test(text))) throw Error('Tujuan atau rumusan masalah tidak valid.');
  return data;
}
export function validateOptions(kind,data) {
  assertSchema(data,schemas[kind]);
  if (data.options.length < 2 || data.options.length > 5 || data.options.some(o=>Object.values(o).some(v=>!v.trim()))) throw Error('AI belum memberikan pilihan dan alasan yang lengkap.');
  if (kind === 'titles' && data.options.some(o=>rawCitation.test(o.title))) throw Error('Judul memuat sitasi yang tidak diperlukan.');
  return data.options;
}
export function usedReferences(draft) {
  const ids = new Set([draft.introduction,draft.methodology].flatMap(data=>sentencesOf(data)).flatMap(s=>s.evidence.map(e=>e.source_id)));
  return draft.references.filter(ref=>ids.has(ref.id)).sort((a,b)=>a.authors[0]?.family.localeCompare(b.authors[0]?.family) || a.title.localeCompare(b.title));
}
export function citationMap(references) {
  const groups = new Map();
  const label = ref => {
    const names = ref.authors.map(a=>a.family || a.name || '').filter(Boolean);
    return names.length > 2 ? `${names[0]} et al.` : names.join(' & ');
  };
  for (const ref of references) {
    const key = `${label(ref)}, ${ref.year}`;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(ref);
  }
  const map = new Map();
  for (const [key,group] of groups) group.sort((a,b)=>a.title.localeCompare(b.title)).forEach((ref,i)=>map.set(ref.id,`${key}${group.length>1 ? String.fromCharCode(97+i) : ''}`));
  return map;
}
export function bibliography(ref, labels) {
  const authors = ref.authors.map(a => {
    if (!a.given) return a.family || a.name;
    return `${a.family}, ${a.given.split(/[\s-]+/).filter(Boolean).map(n=>n[0]+'.').join(' ')}`;
  });
  let authorText;
  if (authors.length > 20) authorText = authors.slice(0,19).join(', ') + ', … ' + authors.at(-1);
  else authorText = authors.length > 1 ? authors.slice(0,-1).join(', ') + ', & ' + authors.at(-1) : authors[0];
  const suffix = labels?.get(ref.id)?.match(/\d{4}([a-z])$/)?.[1] || '';
  const publication = [ref.journal, ref.volume && `${ref.volume}${ref.issue ? `(${ref.issue})` : ''}`,ref.pages].filter(Boolean).join(', ');
  return `${authorText}. (${ref.year}${suffix}). ${ref.title.replace(/\.$/,'')}. ${publication ? publication+'. ' : ''}https://doi.org/${ref.doi}`;
}
export function sentenceText(sentence,labels) {
  const ids = [...new Set(sentence.evidence.map(e=>e.source_id))];
  return ids.length ? sentence.text.replace(/[.!?]\s*$/,'') + ` (${ids.map(id=>labels.get(id)).join('; ')}).` : sentence.text;
}
export function articleBlocks(draft) {
  const refs = usedReferences(draft), labels = citationMap(refs);
  const blocks = [{type:'title',text:draft.title},{type:'note',text:'Rancangan penelitian sampai metodologi. Detail bertanda [perlu diisi] harus dilengkapi penulis; kesesuaian makna kutipan perlu diperiksa pada sumber asli.'},{type:'heading',text:'Pendahuluan'}];
  const add = paragraphs=>paragraphs.forEach(p=>blocks.push({type:'paragraph',text:p.sentences.map(s=>sentenceText(s,labels)).join(' ')}));
  if (draft.introduction) {add(draft.introduction.paragraphs);blocks.push({type:'subheading',text:'Tujuan penelitian'},{type:'paragraph',text:draft.introduction.objective},{type:'subheading',text:'Rumusan masalah'},{type:'paragraph',text:draft.introduction.question});}
  blocks.push({type:'heading',text:'Metodologi'});
  for (const section of draft.methodology?.sections || []) {blocks.push({type:'subheading',text:section.heading});add(section.paragraphs);}
  if (draft.methodology?.missing_info.length) blocks.push({type:'subheading',text:'Informasi yang perlu dilengkapi'},...draft.methodology.missing_info.map(text=>({type:'paragraph',text})));
  blocks.push({type:'heading',text:'Daftar pustaka'},...refs.map(ref=>({type:'reference',text:bibliography(ref,labels)})));
  return blocks;
}
export function assertExportable(draft) {
  if (!draft.title || !draft.introduction || !draft.methodology) throw Error('Selesaikan judul, pendahuluan, dan metodologi terlebih dahulu.');
  if (draft.pendingAudit?.length) throw Error('Draf impor memerlukan pemeriksaan ulang DOI dan audit bukti sebelum diekspor.');
  const refs = selectedSources(draft);
  validatePassages('introduction',draft.introduction,refs);
  validatePassages('methodology',draft.methodology,refs);
}
