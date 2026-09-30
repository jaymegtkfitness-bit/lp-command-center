/* Print many pages to PDF with ONE Chrome (starting a browser per file took 100s each).
   Usage: node tools/print-pdfs.mjs jobs.json     where jobs.json = [{url, out}, ...] */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const port = 9400 + Math.floor(Math.random() * 400);
const prof = fs.mkdtempSync('/private/tmp/claude-501/print-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`,
   `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250);
  try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = l.find(t => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const waiters = {}; let loaded = null;
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && waiters[m.id]) { waiters[m.id](m); delete waiters[m.id]; }
  if (m.method === 'Page.loadEventFired' && loaded) loaded();
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; waiters[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');

const done = [];
for (const job of jobs) {
  const wait = new Promise(r => (loaded = r));
  await send('Page.navigate', { url: job.url });
  await Promise.race([wait, sleep(20000)]);
  await sleep(job.settle || 2500);                    // fonts, engine render
  const r = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
  if (!r.result || !r.result.data) { console.error('FAILED', job.out); continue; }
  fs.mkdirSync(path.dirname(job.out), { recursive: true });
  fs.writeFileSync(job.out, Buffer.from(r.result.data, 'base64'));
  done.push({ out: job.out, bytes: fs.statSync(job.out).size });
}
console.log(JSON.stringify(done));
ws.close(); chrome.kill('SIGKILL'); process.exit(0);
