#!/usr/bin/env node
/* ============================================================================
   FIT BODY BOOTCAMP IMPORTER
   Parses a week's TFW / Fit Body programming Google Doc into a window.FB_WEEKS[n]
   entry for fb-workouts.js, so nobody hand-transcribes the week. Feed it the
   PLAIN-TEXT export of the doc (Drive "download as text/plain") — the cleanest
   source: each Overview field and each "A - move" sits on its own line.

   Tracking model (LOCKED 2026-10-04):
     Strength          -> list each station's tracked "A" lift (weight log; band flag); laps omitted
     MetCon / Classic  -> no per-exercise tracking: laps + finisher only
   Finisher is read from the day's Overview "Finisher: Yes/No".

   Usage:
     node tools/fb-import.js <doc.json>        # {title, content(base64) | text | fileContent}
     node tools/fb-import.js <doc.txt> "<TITLE>"
   Output: the pasteable JS block for that week -> stdout.
   The parser is plain JS so it can be lifted into the Apps Script doorway later
   for fully-automatic serverless serving.
   ========================================================================== */
'use strict';
const fs = require('fs');

const MONTHS = {january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
const DAYS = [['Monday','Mon'],['Tuesday','Tue'],['Wednesday','Wed'],['Thursday','Thu'],['Friday','Fri'],['Saturday','Sat']];

function iso(y,m,d){ return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'); }
function addDays(isoStr,n){ const dt=new Date(isoStr+'T12:00:00'); dt.setDate(dt.getDate()+n); return dt.toISOString().slice(0,10); }
function titleCase(s){ return s.toLowerCase().replace(/\b([a-z])/g,(m,c)=>c.toUpperCase()); }

/* 4-week cycle anchored on the Oct 5 2026 Strength week (matches fb-workouts.js FB_weekType). */
function weekType(startISO){
  const cycle=['Strength','Classic','Classic','MetCon'];
  const anchor=new Date('2026-10-05T12:00:00'), d=new Date(startISO+'T12:00:00');
  const wks=Math.round((d-anchor)/(7*864e5)); return cycle[((wks%4)+4)%4];
}

/* One station's "A -" text -> {m, reps, band?}. null if it isn't a trackable move. */
function parseLift(raw){
  let s = String(raw).trim();
  s = s.split('>')[0];                      // drop any superset continuation ("...High Pulls> 1 Carry")
  s = s.replace(/\*+\s*$/,'').trim();        // drop footnote asterisks
  let reps = '';
  const m = s.match(/^\(?\s*(\d+\s*[x×]\s*\d+|\d+)\s*\)?\s*-?\s*(.*)$/);  // leading reps: 14 / 8x8 / (7x7) / 12-
  if(m){ reps = m[1]; s = m[2]; }
  reps = reps.replace(/\s+/g,'').replace(/x/g,'×');
  const name = s.replace(/\s+/g,' ').replace(/^-\s*/,'').trim();
  if(!name) return null;
  const lift = { m:name, reps:reps };
  if(/band/i.test(name)) lift.band = true;
  return lift;
}

/* value on the line AFTER a "Label:" line (plain-text export shape). */
function field(block, label){
  const re = new RegExp(label+'\\s*:\\s*\\n\\s*([^\\n]+)','i');
  const m = block.match(re); return m ? m[1].trim() : '';
}

function parseDoc(title, text){
  const nM = title.match(/WEEK\s+(\d+)/i);
  const dM = title.match(/([A-Za-z]+)\s+(\d+),\s*(\d{4})\s*-\s*([A-Za-z]+)\s+(\d+),\s*(\d{4})/);
  if(!nM || !dM) throw new Error('could not read week number / dates from title: '+title);
  const n = +nM[1];
  const start = iso(+dM[3], MONTHS[dM[1].toLowerCase()], +dM[2]);
  const end   = iso(+dM[6], MONTHS[dM[4].toLowerCase()], +dM[5]);

  const themeM = text.match(/Quarterly Theme\s*\n\s*([^\n]+)/i);
  const theme = themeM ? titleCase(themeM[1].trim()) : '';

  const days = {};
  for(let i=0;i<DAYS.length;i++){
    const [full, short] = DAYS[i];
    const next = DAYS[i+1] ? DAYS[i+1][0] : null;
    const secRe = new RegExp(full+'\\s+Overview([\\s\\S]*?)(?='+(next?next+'\\s+Overview':'$')+')','i');
    const sec = text.match(secRe); if(!sec) continue;
    const body = sec[1];
    const style = (field(body,'Style')||'').split(/\s/)[0];
    const focus = field(body,'Focus');
    const finisher = /^yes/i.test(field(body,'Finisher'));
    const day = { date:addDays(start,i), style:style, focus:focus, finisher:finisher };
    if(/strength/i.test(style)){
      const w = body.match(/Workout\s*\n([\s\S]*?)(?=_{3,}|Notes|$)/i);
      const wk = w ? w[1] : body;
      const lifts = [];
      const lines = wk.split('\n');
      for(const ln of lines){
        const a = ln.match(/^\s*A\s*-\s*(.+?)\s*$/);   // each station's tracked A move
        if(!a) continue;
        const lift = parseLift(a[1]);
        if(lift) lifts.push(lift);
      }
      day.lifts = lifts;
    } else {
      const laps = field(body,'Laps');
      day.laps = /^\d+$/.test(laps) ? +laps : (laps || 1);
    }
    days[short] = day;
  }
  return { n, start, end, type:weekType(start), theme, days };
}

/* ---- render as a pasteable JS block matching fb-workouts.js ---- */
function q(s){ return "'"+String(s).replace(/'/g,"\\'")+"'"; }
function renderDay(short,d){
  let head = short+":{date:"+q(d.date)+", style:"+q(d.style)+", focus:"+q(d.focus)+", finisher:"+(d.finisher?'true':'false');
  if(d.lifts){
    const ls = d.lifts.map(l=>{ let s="{m:"+q(l.m)+", reps:"+q(l.reps)+""; if(l.band) s+=", band:true"; return s+"}"; }).join(',\n        ');
    return head+", lifts:[\n        "+ls+" ]}";
  }
  return head+", laps:"+(typeof d.laps==='number'?d.laps:q(d.laps))+"}";
}
function render(w){
  const order=['Mon','Tue','Wed','Thu','Fri','Sat'];
  const lines = order.filter(k=>w.days[k]).map(k=>'      '+renderDay(k,w.days[k])).join(',\n');
  return '  '+w.n+': {\n'
    + "    n:"+w.n+", start:"+q(w.start)+", end:"+q(w.end)+", type:"+q(w.type)+",\n"
    + "    theme:"+q(w.theme)+",\n"
    + "    days:{\n"+lines+"\n    }\n  }";
}

// ---- main ----
const arg = process.argv[2];
if(!arg){ console.error('usage: node fb-import.js <doc.json>|<doc.txt "TITLE">'); process.exit(1); }
let title, text;
if(arg.endsWith('.json')){
  const j = JSON.parse(fs.readFileSync(arg,'utf8'));
  title = j.title;
  text = j.content ? Buffer.from(j.content,'base64').toString('utf8') : (j.text || j.fileContent);
} else { text = fs.readFileSync(arg,'utf8'); title = process.argv[3]; }
text = text.replace(/\r\n/g,'\n');
process.stdout.write(render(parseDoc(title, text))+'\n');
