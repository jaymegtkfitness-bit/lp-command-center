# Legacy Performance — Command Center Dashboard

A single hosted web page that reads your Google Sheets and shows, in one place:
- **Business snapshot** — Founding 25 filled, active clients, MRR, new leads, calls booked
- **Client board** — every client's health signal (On track / Watch / Stalling / Gone quiet), last check-in, consistency %, weight, trend
- **Follow-ups** — who's gone quiet, who's stalling, whose review is due (the ADD-brain safety net)
- **Community intelligence** — check-in rate, consistency spread, average biofeedback markers

It ships in **Demo mode** so it works the moment you open it. Wire your sheets to go **Live**.

---

## The architecture (why it's low-maintenance)

```
Google Forms (check-ins) ─┐
GoHighLevel (leads/CRM) ──┼──►  ONE Google Sheet  ──►  This dashboard
Everfit (exports) ────────┘      (the "hub")            (reads live, renders)
```

Everything funnels INTO Google Sheets. The dashboard only READS. So when you add GoHighLevel
or Everfit later, you wire them into a Sheet tab and the dashboard picks it up with zero code changes.

---

## Logo (already installed)

Your logo is in this folder as **`logo.png`** (the horizontal shield lockup, copied from your
Google Drive logo set — `Legacy-Performance-5.png`). It shows in the parchment header band, which is
kept light on purpose so the black LEGACY + gold PERFORMANCE read clean.

To swap it later, just replace `logo.png` in this folder with a new file of the same name (a
transparent-background PNG looks best). If the file is ever missing, an on-brand text wordmark shows
in its place so the header never looks broken.

---

## Go live in 3 steps (~10 minutes)

### Step 1 — Add two tabs to your data

You already have the **Weekly Check-In responses** sheet (the raw Google Form responses).
Add two more tabs — easiest place is your **Master Dashboard** sheet
(`1iJMjvQYV5B5GfAb30qBf-CpbVJFk9iygPVi8x1OoLgo`) or any sheet you like:

**Tab `Roster`** — one row per client:

| Name | Email | Program | Goal | Start | Status |
|------|-------|---------|------|-------|--------|
| Marcus Bell | marcus@… | Live Lean | Lose | 2026-05-20 | Active |

- **Goal** must be `Lose`, `Maintain`, or `Gain` — this tells the dashboard whether a weight
  drop is good news or bad news for that client.
- This roster is also what lets it flag **who's missing** a check-in.

**Tab `Business`** — two columns, one metric per row:

| Metric | Value |
|--------|-------|
| Founding 25 filled | 12 / 25 |
| Active clients | 18 |
| MRR | $4,820 |
| New leads this week | 7 |
| Assessment calls booked | 3 |

(Only the first 5 rows show as tiles. Fill these by hand for now; later GHL/Zapier can write them.)

### Step 2 — Publish each tab as CSV

For **each** of the 3 tabs (Weekly Check-In responses, Roster, Business):

1. In Google Sheets: **File → Share → Publish to web**
2. In the dropdown, pick the **specific tab** (not "Entire document")
3. Choose **Comma-separated values (.csv)**
4. Click **Publish** → copy the link it gives you (looks like
   `https://docs.google.com/spreadsheets/d/e/2PACX-…/pub?gid=0&single=true&output=csv`)

Do this 3 times — you'll have 3 links.

> Published-to-web CSV is read-only and only exposes that one tab. It does not make your whole
> Sheet public or editable.

### Step 3 — Paste the links into the dashboard

Open `index.html`, find the **CONFIG block** near the top, and paste each link:

```js
const CONFIG = {
  checkinsCsvUrl: "https://docs.google.com/…checkins…output=csv",
  rosterCsvUrl:   "https://docs.google.com/…roster…output=csv",
  businessCsvUrl: "https://docs.google.com/…business…output=csv",
  ...
};
```

Save. The banner disappears and the chip flips from **Demo** to **Live**. Done.

---

## Host it on a web address (free)

**Netlify (drag-and-drop, easiest):**
1. Go to app.netlify.com → **Add new site → Deploy manually**
2. Drag the whole `dashboard` folder onto the page
3. You get a URL like `legacy-command-center.netlify.app` instantly
4. To update later: re-drag the folder, or connect it to a GitHub repo for auto-deploys

**Vercel:** same idea — `vercel` CLI in this folder, or import from GitHub.

**Keep it private:** on Netlify, add site **Password protection** (Site settings → Access control)
so only you can open it. Recommended, since it shows client data.

---

## Adding GoHighLevel and Everfit later

- **GoHighLevel:** use a GHL workflow (or Zapier/Make) to append new leads/opportunities into a
  Google Sheet tab whenever they come in. Point a new CSV publish link at it, or fold the numbers
  into the `Business` tab. No dashboard change needed.
- **Everfit:** export the data you want (weights, adherence) to CSV, paste/import into a Google
  Sheet tab on a cadence. Same pattern.

The rule: **if it lands in a Google Sheet tab, this dashboard can show it.**

---

## Tuning the health signals

In the CONFIG block:

| Setting | Default | Meaning |
|---------|---------|---------|
| `goneQuietDays` | 10 | No check-in in this many days → "Gone quiet" |
| `reviewDueDays` | 7 | This long since last check-in → "Review due" |
| `onTrackConsistency` | 85 | Consistency % at/above this → "On track" |
| `watchConsistency` | 60 | Below on-track but at/above this → "Watch"; under → "Stalling" |
| `refreshMinutes` | 30 | How often the page auto-refreshes from Sheets |

---

## Brand theme (masculine dark / female-facing light)

This dashboard ships in the **masculine dark** mode — Charcoal Authority background, Parchment
headlines, Quiet Ember Gold emphasis, a touch of Living Olive — because it's an internal system.

The same file also holds the **female-facing light** inverse (Parchment background, Charcoal
headlines, Olive emphasis, a touch of Gold). To flip a copy of this page to light mode, change the
opening tag from `<html lang="en">` to:

```html
<html lang="en" data-theme="light">
```

Everything re-colors from the token block at the top of the `<style>` section — no other edits.

---

## Notes

- The dashboard matches your live **Weekly Check-In** form columns by header name (weight,
  consistency, energy, sleep, mood, digestion, food quality), so light edits to the form won't
  break it.
- If a live link fails to load, that one section falls back to demo data and logs a warning in the
  browser console — the page never goes blank.
- Nothing is stored on a server. It's a static page that reads your Sheets in the browser each load.
