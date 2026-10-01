#!/usr/bin/env node
/* MORNING CHECK (Jayme 2026-10-01): what sold, what is fulfilled, what is waiting on whom.
   Reads GHL purchases and bookings directly (the Private Integration token already in apps-script.gs,
   which is gitignored), the Legacy doorway for intake state, and the local Drive mount for kits.
   Read-only. It never emails, never charges, never writes. Usage: node tools/morning-check.js [days]
*/
const fs = require('fs'), path = require('path'), os = require('os');

const DASH = path.resolve(__dirname, '..');
const gs = fs.readFileSync(path.join(DASH, 'apps-script.gs'), 'utf8');
const TOKEN = (gs.match(/pit-[A-Za-z0-9-]+/) || [])[0];
const LOC = (gs.match(/GHL_LOCATION\s*=\s*'([^']+)'/) || [])[1];
const DOOR = (gs.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/) || [])[0]
  || 'https://script.google.com/macros/s/AKfycbzawUtTobA9Jfne8Hot7K7AIgnMp4izfYUo773nSKOZN4Z5xFNf3d9hDY6B-FMGdgV-/exec';
const KITS = path.join(os.homedir(), 'Library/CloudStorage/GoogleDrive-jayme.gtkfitness@gmail.com/My Drive/Legacy Performance/Client Kits');
const DAYS = +(process.argv[2] || 30);

const ghl = async (p, version = '2021-07-28') => {
  const r = await fetch('https://services.leadconnectorhq.com/' + p,
    { headers: { Authorization: 'Bearer ' + TOKEN, Version: version, Accept: 'application/json' } });
  if (!r.ok) return { error: r.status };
  return r.json();
};
/* The doorway is JSONP and fails roughly one call in four, so every read retries. */
async function door(qs) {
  for (let i = 0; i < 4; i++) {
    try {
      const t = await (await fetch(DOOR + '?' + qs + '&callback=cb')).text();
      if (t.startsWith('cb(')) return JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')')));
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

(async () => {
  const since = new Date(Date.now() - DAYS * 864e5);
  const orders = ((await ghl(`payments/orders?altId=${LOC}&altType=location&limit=50`)).data || [])
    .filter(o => new Date(o.createdAt) >= since);
  const roster = ((await door('action=roster')) || {}).rows || [];
  const rosterBy = {};
  roster.forEach(r => { if (r.Email) rosterBy[String(r.Email).trim().toLowerCase()] = r; });

  const rows = [];
  for (const o of orders) {
    const email = String(o.contactEmail || '').trim().toLowerCase();
    const name = o.contactName || '(no name)';
    const cd = email ? await door('action=clientData&email=' + encodeURIComponent(email)) : null;
    const cns = (cd && cd.cnsintake || []);
    const last = cns[cns.length - 1] || {};
    const dash = (cd && cd.intake || [])[0] || {};
    const hasFoods = !!String(last.Proteins || '').trim();
    const hasNumbers = !!(String(last.Weight || '').trim() && String(last['Goal weight'] || '').trim())
      || !!(dash['Current wt'] && dash['Goal wt']);
    const kit = fs.existsSync(path.join(KITS, name)) ? fs.readdirSync(path.join(KITS, name)).filter(f => f.endsWith('.pdf')).length : 0;
    const appts = o.contactId ? ((await ghl(`contacts/${o.contactId}/appointments`, '2021-04-15')).events || []) : [];
    const upcoming = appts.filter(a => new Date(a.startTime) >= new Date(Date.now() - 864e5));
    rows.push({
      date: String(o.createdAt).slice(0, 10), name, email,
      amount: '$' + o.amount, status: o.status,
      roster: !!rosterBy[email], complete: (rosterBy[email] || {}).Complete || '',
      foods: hasFoods, numbers: hasNumbers, kit,
      booked: upcoming.length ? (upcoming[0].title || '').slice(0, 28) + ' ' + String(upcoming[0].startTime).slice(0, 16) : '',
      pastCall: appts.length && !upcoming.length
    });
  }

  const pad = (s, n) => String(s == null ? '' : s).padEnd(n).slice(0, n);
  console.log('\nPURCHASES, last ' + DAYS + ' days\n' + '='.repeat(118));
  console.log(pad('DATE', 11) + pad('WHO', 20) + pad('PAID', 8) + pad('INTAKE', 9) + pad('NUMBERS', 9) + pad('KIT', 6) + pad('DASH', 6) + 'NEXT STEP');
  console.log('-'.repeat(118));
  for (const r of rows) {
    let next;
    if (!r.foods) next = 'send her the intake: dashboard.legacyperformance.co/build';
    else if (!r.numbers) next = 'intake has no body numbers, ask her to re-run it';
    else if (!r.kit) next = 'BUILD THE KIT (bash tools/build-kit.sh <json> "' + r.name + '")';
    else if (!r.complete) next = 'switch on her dashboard (rosterset Complete=Yes)';
    else if (!r.booked) next = r.pastCall ? 'call already happened, confirm she is running' : 'send the delivery email, she has not booked the install call';
    else next = 'booked: ' + r.booked;
    console.log(pad(r.date, 11) + pad(r.name, 20) + pad(r.amount + ' ' + (r.status === 'completed' ? '' : r.status), 8)
      + pad(r.foods ? 'yes' : 'NO', 9) + pad(r.numbers ? 'yes' : 'NO', 9) + pad(r.kit ? r.kit + ' pdf' : 'NO', 6)
      + pad(r.complete ? 'on' : 'off', 6) + next);
  }
  console.log('');
})();
