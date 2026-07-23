import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { escapeHtml } from '../util.js';
import type { Synthesis, Feature, FeatureBadge } from '../synthesize/types.js';
import type { ExtractionRecord, Grounding } from '../extract/schema.js';
import type { CodeFacts } from '../codefacts/verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface RenderData {
  projectName: string;
  grounding: Grounding;
  synthesis: Synthesis;
  extractions: ExtractionRecord[];
  codeFacts: CodeFacts;
  runStamp: string;
  stats: {
    files: number;
    failed: number;
    features: number;
    metrics: number;
    events: number;
  };
}

const BADGE_LABEL: Record<FeatureBadge, string> = {
  confirmed_shipped: 'Confirmed shipped',
  doc_drift: 'Doc drift',
  implemented_undocumented: 'Implemented, undocumented',
  planned_no_impl: 'Planned, no code',
  contradiction: 'Contradiction',
  unverified: 'Unverified',
};

const BADGE_CLASS: Record<FeatureBadge, string> = {
  confirmed_shipped: 'b-ok',
  doc_drift: 'b-warn',
  implemented_undocumented: 'b-info',
  planned_no_impl: 'b-plan',
  contradiction: 'b-warn',
  unverified: 'b-muted',
};

function loadAsset(name: string): string {
  return readFileSync(join(__dirname, 'assets', name), 'utf8');
}

export function renderDashboard(data: RenderData): string {
  const mermaid = loadAsset('mermaid.min.js');
  const payload = buildPayload(data);
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(data.projectName)} · mdpulse</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <div class="brand">
    <span class="logo">◐</span>
    <div>
      <h1>${escapeHtml(data.projectName)}</h1>
      <p class="sub">${escapeHtml(data.grounding.project_purpose || 'Project intelligence from your markdown corpus')}</p>
    </div>
  </div>
  <div class="topright">
    <button id="themeToggle" title="Toggle theme">☾</button>
    <span class="stamp">mdpulse · ${escapeHtml(data.runStamp)}</span>
  </div>
</header>

<nav id="tabs">
  <button data-tab="overview" class="active">Overview</button>
  <button data-tab="timeline">Timeline</button>
  <button data-tab="features">Feature Map</button>
  <button data-tab="results">Results</button>
  <button data-tab="architecture">Architecture</button>
  <button data-tab="loops">Open Loops</button>
  <button data-tab="files">Files</button>
</nav>

<main>
  <section id="overview" class="tab active"></section>
  <section id="timeline" class="tab"></section>
  <section id="features" class="tab"></section>
  <section id="results" class="tab"></section>
  <section id="architecture" class="tab"></section>
  <section id="loops" class="tab"></section>
  <section id="files" class="tab"></section>
</main>

<script id="pulse-data" type="application/json">${json}</script>
<script>${mermaid}</script>
<script>${APP_JS}</script>
</body>
</html>`;
}

function buildPayload(data: RenderData) {
  // Trim extractions to what the Files index needs (keep the page lean).
  const files = data.extractions
    .map((e) => ({
      file: e.file,
      doc_type: e.doc_type,
      title: e.title,
      summary: e.summary,
      failed: !!e.extraction_failed,
      failure_reason: e.failure_reason ?? '',
      metrics: e.metrics.length,
      features: e.features.length,
      dates: e.dates.length,
    }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return {
    project: data.projectName,
    grounding: data.grounding,
    synthesis: data.synthesis,
    files,
    codeFacts: {
      head: data.codeFacts.head,
      paths: data.codeFacts.inventoryPaths,
      identifiers: data.codeFacts.inventoryIdentifiers,
    },
    stats: data.stats,
    badgeLabels: BADGE_LABEL,
    badgeClasses: BADGE_CLASS,
    runStamp: data.runStamp,
  };
}

const CSS = `
:root{--bg:#0d1117;--panel:#161b22;--panel2:#1c2230;--border:#2a3240;--text:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--ok:#3fb950;--warn:#f0883e;--info:#a371f7;--plan:#d29922;--danger:#f85149}
:root[data-theme=light]{--bg:#f6f8fa;--panel:#fff;--panel2:#f0f3f6;--border:#d0d7de;--text:#1f2328;--muted:#636c76;--accent:#0969da;--ok:#1a7f37;--warn:#bc4c00;--info:#8250df;--plan:#9a6700;--danger:#cf222e}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
header{display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:12px}
.brand{display:flex;gap:14px;align-items:center}
.logo{font-size:34px;color:var(--accent);line-height:1}
h1{font-size:20px;margin:0}
.sub{margin:2px 0 0;color:var(--muted);font-size:13px;max-width:60ch}
.topright{display:flex;align-items:center;gap:12px}
.stamp{color:var(--muted);font-size:12px}
#themeToggle{background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 10px;cursor:pointer}
nav{display:flex;gap:4px;padding:0 16px;border-bottom:1px solid var(--border);overflow-x:auto}
nav button{background:none;border:none;color:var(--muted);padding:12px 14px;cursor:pointer;font-size:14px;border-bottom:2px solid transparent;white-space:nowrap}
nav button:hover{color:var(--text)}
nav button.active{color:var(--text);border-bottom-color:var(--accent)}
main{padding:24px;max-width:1100px;margin:0 auto}
.tab{display:none}
.tab.active{display:block}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px}
.card .n{font-size:28px;font-weight:600}
.card .l{color:var(--muted);font-size:13px;margin-top:2px}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:16px}
h2{font-size:16px;margin:0 0 14px;display:flex;align-items:center;gap:8px}
h3{font-size:14px;margin:18px 0 8px;color:var(--muted)}
.badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:12px;font-weight:600;border:1px solid transparent}
.b-ok{background:rgba(63,185,80,.15);color:var(--ok);border-color:rgba(63,185,80,.35)}
.b-warn{background:rgba(240,136,62,.15);color:var(--warn);border-color:rgba(240,136,62,.35)}
.b-info{background:rgba(163,113,247,.15);color:var(--info);border-color:rgba(163,113,247,.35)}
.b-plan{background:rgba(210,153,34,.15);color:var(--plan);border-color:rgba(210,153,34,.35)}
.b-muted{background:var(--panel2);color:var(--muted);border-color:var(--border)}
.feat{border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:var(--panel2)}
.feat .top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.feat .name{font-weight:600}
.feat .meta{color:var(--muted);font-size:12px;margin-top:6px}
.src{color:var(--accent);text-decoration:none;font-size:11px;border:1px solid var(--border);border-radius:4px;padding:1px 6px;margin:2px 4px 2px 0;display:inline-block}
.src:hover{background:var(--panel2)}
.q{color:var(--muted);font-size:12px;font-style:italic;border-left:2px solid var(--border);padding-left:8px;margin-top:6px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.month{border-left:2px solid var(--border);padding:0 0 14px 16px;margin-left:6px;position:relative}
.month:before{content:'';position:absolute;left:-5px;top:4px;width:8px;height:8px;border-radius:50%;background:var(--accent)}
.month .mlabel{font-weight:600;font-size:14px}
.month .narr{color:var(--muted);font-size:13px;margin:2px 0 8px}
.ev{font-size:13px;margin:4px 0;display:flex;gap:8px;align-items:baseline}
.ev .k{font-size:10px;text-transform:uppercase;color:var(--muted);border:1px solid var(--border);border-radius:3px;padding:0 4px}
.filterbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.filterbar button{background:var(--panel2);border:1px solid var(--border);color:var(--muted);border-radius:20px;padding:4px 12px;cursor:pointer;font-size:12px}
.filterbar button.active{color:var(--text);border-color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:12px}
canvas{max-width:100%}
.chartwrap{overflow-x:auto}
.empty{color:var(--muted);font-style:italic;padding:20px 0}
.mermaid{background:var(--panel2);border-radius:8px;padding:12px;margin:10px 0;overflow-x:auto}
.pill{font-size:11px;color:var(--muted)}
details summary{cursor:pointer;color:var(--accent);font-size:12px}
a.filelink{color:var(--accent);text-decoration:none}
a.filelink:hover{text-decoration:underline}
`;

const APP_JS = String.raw`
const DATA = JSON.parse(document.getElementById('pulse-data').textContent);
const el = (t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

function srcLink(s){
  const label = s.file + (s.date? ' · '+s.date : '');
  return '<a class="src" href="#file-'+encodeURIComponent(s.file)+'" onclick="gotoFile(\''+esc(s.file).replace(/'/g,"\\'")+'\')">'+esc(label)+'</a>';
}
function gotoFile(f){ document.querySelector('[data-tab=files]').click(); const anchor=document.getElementById('file-'+f); if(anchor){anchor.scrollIntoView({behavior:'smooth',block:'center'});anchor.style.outline='2px solid var(--accent)';setTimeout(()=>anchor.style.outline='',1600);} }

// ---- Overview ----
function renderOverview(){
  const s=DATA.stats, syn=DATA.synthesis;
  const drift=syn.features.filter(f=>f.badge==='doc_drift').length;
  const shipped=syn.features.filter(f=>f.badge==='confirmed_shipped').length;
  const cards=[
    ['Files indexed',s.files],['Features',s.features],['Confirmed shipped',shipped],
    ['Doc drift',drift],['Metric series',s.metrics],['Open loops',syn.open_loops.length]
  ].map(([l,n])=>'<div class="card"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>').join('');
  let html='<div class="cards">'+cards+'</div>';
  html+='<div class="panel"><h2>Latest digest</h2>'+(syn.digest.length?('<ul>'+syn.digest.map(d=>'<li>'+esc(d.text)+'</li>').join('')+'</ul>'):'<div class="empty">No digest yet.</div>')+'</div>';
  if(DATA.grounding.domain_glossary && DATA.grounding.domain_glossary.length){
    html+='<div class="panel"><h2>Domain glossary</h2><table><tbody>'+DATA.grounding.domain_glossary.slice(0,40).map(g=>'<tr><td class="mono">'+esc(g.term)+'</td><td>'+esc(g.meaning)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  if(s.failed>0){ html+='<div class="panel"><h2>⚠ '+s.failed+' file(s) failed extraction</h2><div class="pill">See the Files tab; failures are surfaced, never silently dropped.</div></div>'; }
  document.getElementById('overview').innerHTML=html;
}

// ---- Timeline ----
function renderTimeline(){
  const tl=DATA.synthesis.timeline;
  let html='';
  if(tl.activity && tl.activity.length){
    html+='<div class="panel"><h2>Activity</h2><div class="chartwrap"><canvas id="actchart" width="1000" height="90"></canvas></div></div>';
  }
  if(!tl.months.length){ html+='<div class="empty">No dated events found in the corpus.</div>'; document.getElementById('timeline').innerHTML=html; return; }
  html+='<div class="panel">';
  for(const m of tl.months){
    html+='<div class="month"><div class="mlabel">'+esc(m.month)+'</div>';
    if(m.narrative) html+='<div class="narr">'+esc(m.narrative)+'</div>';
    for(const e of m.events){
      html+='<div class="ev"><span class="k">'+esc(e.kind)+'</span><span>'+esc(e.event)+' '+e.sources.map(srcLink).join('')+'</span></div>';
    }
    html+='</div>';
  }
  html+='</div>';
  document.getElementById('timeline').innerHTML=html;
  if(tl.activity && tl.activity.length) drawActivity(tl.activity);
}
function drawActivity(act){
  const c=document.getElementById('actchart'); if(!c)return; const ctx=c.getContext('2d');
  const max=Math.max.apply(null,act.map(a=>a.commits))||1; const bw=Math.max(6,Math.min(30,(c.width-20)/act.length-4));
  const css=getComputedStyle(document.documentElement); const accent=css.getPropertyValue('--accent').trim();
  act.forEach((a,i)=>{const h=(a.commits/max)*70; const x=10+i*(bw+4); ctx.fillStyle=accent; ctx.globalAlpha=.3+.7*(a.commits/max); ctx.fillRect(x,80-h,bw,h);});
  ctx.globalAlpha=1;
}

// ---- Features ----
let featFilter='all';
function renderFeatures(){
  const feats=DATA.synthesis.features;
  const counts={};
  feats.forEach(f=>counts[f.badge]=(counts[f.badge]||0)+1);
  const badges=['all','confirmed_shipped','doc_drift','planned_no_impl','implemented_undocumented','contradiction','unverified'];
  let bar='<div class="filterbar">'+badges.filter(b=>b==='all'||counts[b]).map(b=>'<button data-f="'+b+'" class="'+(b===featFilter?'active':'')+'">'+(b==='all'?'All ('+feats.length+')':esc(DATA.badgeLabels[b])+' ('+(counts[b]||0)+')')+'</button>').join('')+'</div>';
  const shown=feats.filter(f=>featFilter==='all'||f.badge===featFilter);
  let list=shown.length?shown.map(featCard).join(''):'<div class="empty">No features in this category.</div>';
  document.getElementById('features').innerHTML='<div class="panel"><h2>Feature map <span class="pill">documented status × current code</span></h2>'+bar+list+'</div>';
  document.querySelectorAll('#features .filterbar button').forEach(b=>b.onclick=()=>{featFilter=b.dataset.f;renderFeatures();});
}
function featCard(f){
  const cls=DATA.badgeClasses[f.badge]||'b-muted';
  let h='<div class="feat"><div class="top"><span class="name">'+esc(f.name)+'</span><span class="badge '+cls+'">'+esc(DATA.badgeLabels[f.badge])+'</span></div>';
  const bits=[];
  bits.push('doc: '+esc(f.documented_status));
  bits.push('code: '+esc(f.code_status));
  if(f.latest_evidence) bits.push('latest: '+esc(f.latest_evidence));
  if(f.code_entities.length) bits.push('entities: '+f.code_entities.map(esc).join(', '));
  h+='<div class="meta">'+bits.join(' · ')+'</div>';
  if(f.code_citations && f.code_citations.length) h+='<div class="meta">code: '+f.code_citations.map(c=>'<span class="mono">'+esc(c)+'</span>').join(', ')+'</div>';
  const q=f.sources.find(s=>s.quote);
  if(q) h+='<div class="q">"'+esc(q.quote)+'"</div>';
  h+='<div>'+f.sources.map(srcLink).join('')+'</div></div>';
  return h;
}

// ---- Results ----
function renderResults(){
  const series=DATA.synthesis.results;
  if(!series.length){ document.getElementById('results').innerHTML='<div class="empty">No quantitative metrics with units were found.</div>'; return; }
  let html='';
  series.forEach((s,i)=>{
    const flag=s.regression_flagged?' <span class="badge b-warn">regression</span>':'';
    html+='<div class="panel"><h2>'+esc(s.metric_name)+' <span class="pill">('+esc(s.unit)+')</span>'+flag+'</h2>';
    if(s.points.length>1){ html+='<div class="chartwrap"><canvas id="mc'+i+'" width="900" height="220"></canvas></div>'; }
    html+='<table><thead><tr><th>Date</th><th>Value</th><th>Context</th><th>Source</th></tr></thead><tbody>'+
      s.points.map(p=>'<tr><td>'+esc(p.date)+'</td><td class="mono">'+esc(p.value)+'</td><td>'+esc(p.context)+'</td><td>'+srcLink({file:p.file,date:p.date})+'</td></tr>').join('')+'</tbody></table></div>';
  });
  document.getElementById('results').innerHTML=html;
  series.forEach((s,i)=>{ if(s.points.length>1) drawLine('mc'+i,s.points); });
}
function drawLine(id,points){
  const c=document.getElementById(id); if(!c)return; const ctx=c.getContext('2d');
  const css=getComputedStyle(document.documentElement); const accent=css.getPropertyValue('--accent').trim(); const muted=css.getPropertyValue('--muted').trim();
  const W=c.width,H=c.height,pad=40;
  const vals=points.map(p=>p.value); let mn=Math.min.apply(null,vals),mx=Math.max.apply(null,vals); if(mn===mx){mn-=1;mx+=1;}
  const x=i=>pad+(i/(points.length-1))*(W-2*pad); const y=v=>H-pad-((v-mn)/(mx-mn))*(H-2*pad);
  ctx.strokeStyle=muted;ctx.globalAlpha=.4;ctx.beginPath();ctx.moveTo(pad,H-pad);ctx.lineTo(W-pad,H-pad);ctx.stroke();ctx.globalAlpha=1;
  ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.beginPath();points.forEach((p,i)=>{i?ctx.lineTo(x(i),y(p.value)):ctx.moveTo(x(i),y(p.value));});ctx.stroke();
  ctx.fillStyle=accent;points.forEach((p,i)=>{ctx.beginPath();ctx.arc(x(i),y(p.value),3,0,7);ctx.fill();});
  ctx.fillStyle=muted;ctx.font='11px monospace';ctx.fillText(mx.toFixed(2),4,y(mx)+4);ctx.fillText(mn.toFixed(2),4,y(mn)+4);
}

// ---- Architecture ----
let mermaidCount=0;
function renderArchitecture(){
  const snaps=DATA.synthesis.architecture;
  if(!snaps.length){ document.getElementById('architecture').innerHTML='<div class="empty">No mermaid diagrams found in the corpus.</div>'; return; }
  let html='';
  snaps.forEach(s=>{
    html+='<div class="panel"><h2>'+esc(s.title||s.file)+' <span class="pill">'+esc(s.date||'undated')+' · '+esc(s.kind)+'</span></h2>';
    if(s.change_note) html+='<div class="narr" style="color:var(--muted);font-size:13px;margin-bottom:8px">'+esc(s.change_note)+'</div>';
    html+='<div class="meta pill">'+s.nodes+' nodes · '+s.edges+' edges</div>';
    if(s.digest) html+='<div class="q">'+esc(s.digest)+'</div>';
    html+='<div>'+s.sources.map(srcLink).join('')+'</div></div>';
  });
  document.getElementById('architecture').innerHTML=html;
}

// ---- Open loops ----
function renderLoops(){
  const loops=DATA.synthesis.open_loops;
  if(!loops.length){ document.getElementById('loops').innerHTML='<div class="empty">No open loops detected. Everything planned appears resolved.</div>'; return; }
  document.getElementById('loops').innerHTML='<div class="panel"><h2>Open loops <span class="pill">planned but unresolved</span></h2>'+
    loops.map(l=>'<div class="feat"><div>'+esc(l.text)+'</div><div>'+l.sources.map(srcLink).join('')+'</div></div>').join('')+'</div>';
}

// ---- Files ----
function renderFiles(){
  const files=DATA.files;
  const failed=files.filter(f=>f.failed);
  let html='';
  if(failed.length){ html+='<div class="panel"><h2>⚠ Failed extractions ('+failed.length+')</h2>'+failed.map(f=>'<div class="feat"><span class="mono">'+esc(f.file)+'</span><div class="meta">'+esc(f.failure_reason)+'</div></div>').join('')+'</div>'; }
  html+='<div class="panel"><h2>All files ('+files.length+')</h2><table><thead><tr><th>File</th><th>Type</th><th>Summary</th></tr></thead><tbody>'+
    files.map(f=>'<tr id="file-'+esc(f.file)+'"><td class="mono"><a class="filelink" href="#file-'+encodeURIComponent(f.file)+'">'+esc(f.file)+'</a>'+(f.failed?' <span class="badge b-warn">failed</span>':'')+'</td><td>'+esc(f.doc_type)+'</td><td>'+esc(f.summary||f.title)+'</td></tr>').join('')+
    '</tbody></table></div>';
  document.getElementById('files').innerHTML=html;
}

// ---- Tabs ----
const renderers={overview:renderOverview,timeline:renderTimeline,features:renderFeatures,results:renderResults,architecture:renderArchitecture,loops:renderLoops,files:renderFiles};
const rendered={};
function activate(tab){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  document.querySelectorAll('.tab').forEach(s=>s.classList.toggle('active',s.id===tab));
  if(!rendered[tab]){ renderers[tab](); rendered[tab]=true; if(tab==='architecture') initMermaid(); }
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>activate(b.dataset.tab));

function initMermaid(){
  try{
    mermaid.initialize({startOnLoad:false,theme:document.documentElement.getAttribute('data-theme')==='light'?'default':'dark'});
  }catch(e){}
}

// ---- Theme ----
document.getElementById('themeToggle').onclick=()=>{
  const cur=document.documentElement.getAttribute('data-theme');
  const next=cur==='light'?'dark':'light';
  document.documentElement.setAttribute('data-theme',next);
  document.getElementById('themeToggle').textContent=next==='light'?'☀':'☾';
  rendered.timeline=false;rendered.results=false; // redraw canvases
  const active=document.querySelector('nav button.active').dataset.tab;
  if(active==='timeline'||active==='results'){renderers[active]();}
};

renderOverview(); rendered.overview=true;
`;
