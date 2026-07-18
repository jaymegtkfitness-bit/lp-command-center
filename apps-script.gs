/**
 * LEGACY PERFORMANCE — Command Center "write doorway"
 * ---------------------------------------------------
 * This tiny Google Apps Script is what lets the dashboard SAVE data (check-ins + coach
 * notes) into your Google Sheet, so it syncs to every device instead of living on one phone.
 *
 * ONE-TIME SETUP (~5 min):
 *  1. Open the Google Sheet you want the data to land in (your Master Dashboard is fine).
 *  2. Extensions ▸ Apps Script.  Delete the sample code, paste ALL of this in.
 *  3. Put your Sheet's ID in SHEET_ID below (it's the long code in the sheet URL:
 *     docs.google.com/spreadsheets/d/THIS_LONG_PART/edit ).
 *  4. Click Deploy ▸ New deployment ▸ gear icon ▸ Web app.
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Deploy ▸ Authorize ▸ copy the Web app URL it gives you (ends in /exec).
 *  5. Send Jayme/Claude that /exec URL. It goes into CONFIG.writeUrl in index.html.
 *
 * The script auto-creates two tabs the first time data arrives:
 *   "Dashboard Check-Ins"  and  "Coach Notes".
 * Publish the "Dashboard Check-Ins" tab to the web as CSV and use that link as the
 * dashboard's checkinsCsvUrl, and the loop is closed: write here, read there, see everywhere.
 */

var SHEET_ID = '1iJMjvQYV5B5GfAb30qBf-CpbVJFk9iygPVi8x1OoLgo';  // your Master Dashboard sheet

function doPost(e){
  try{
    var d  = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    if(d.type === 'checkin')      appendCheckin(ss, d);
    else if(d.type === 'note')    appendNote(ss, d);
    else if(d.type === 'pr')      appendPR(ss, d);
    else if(d.type === 'state') saveState(ss, d);
    return json({ ok:true });
  }catch(err){
    return json({ ok:false, error:String(err) });
  }
}

/* App state (tasks + weekly scoreboard + workshop log) stored as one JSON blob. */
function saveState(ss, d){
  var sh = tab(ss, 'App State', ['JSON — managed by the Command Center app, do not edit by hand']);
  sh.getRange(2,1).setValue(JSON.stringify({ tasks:d.tasks||[], score:d.score||{}, workshops:d.workshops||[] }));
}
/* GET returns the app state {tasks,score,workshops}. Supports JSONP (?callback=fn) so the
   dashboard can read it cross-origin from any device. */
function doGet(e){
  var out = '{}';
  try{
    var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('App State');
    var raw = sh ? sh.getRange(2,1).getValue() : '';
    if(raw) out = String(raw);
  }catch(err){ out = '{}'; }
  var cb = (e && e.parameter && e.parameter.callback) || '';
  if(cb) return ContentService.createTextOutput(cb + '(' + out + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

function appendCheckin(ss, d){
  var sh = tab(ss, 'Dashboard Check-Ins', [
    'Timestamp','Email','Weight','Energy','Sleep quality','Mental acuity & focus',
    'Strength & performance','Digestion','Hunger & cravings','Libido','Inflammation',
    'Mood & resilience','Training recovery','Food quality','Consistency',
    'Non-scale victory','Focus next week','Anything else'
  ]);
  sh.appendRow([ d.ts||new Date(), d.email||'', d.weight||'', d.energy||'', d.sleep||'',
    d.acuity||'', d.strength||'', d.digestion||'', d.hunger||'', d.libido||'',
    d.inflammation||'', d.mood||'', d.recovery||'', d.food||'', d.consistency||'',
    d.victory||'', d.focus||'', d.notes||'' ]);
}

function appendNote(ss, d){
  var sh = tab(ss, 'Coach Notes', ['Timestamp','Email','Note']);
  sh.appendRow([ d.ts||new Date(), d.email||'', d.text||'' ]);
}

function appendPR(ss, d){
  var sh = tab(ss, 'PRs', ['Timestamp','Email','Exercise','Weight','Reps']);
  sh.appendRow([ d.ts||new Date(), d.email||'', d.exercise||'', d.weight||'', d.reps||'' ]);
}

function tab(ss, name, headers){
  var sh = ss.getSheetByName(name);
  if(!sh){ sh = ss.insertSheet(name); sh.appendRow(headers); }
  return sh;
}

function json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * RUN THIS ONCE to build the Roster tab with dropdown menus.
 * In the Apps Script editor: choose "setupRoster" in the function dropdown (top bar), click Run.
 * Safe to re-run — it won't erase client rows you've already typed.
 * To change a dropdown's choices later, edit the lists below and Run again (or use
 * Data > Data validation right in the sheet).
 */
function setupRoster(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName('Roster') || ss.insertSheet('Roster');

  var headers = ['Name','Email','Status','Program','Goal','Tier','Start date','Notes'];
  sh.getRange(1,1,1,headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1C1C1C').setFontColor('#F2EDE4');
  sh.setFrozenRows(1);

  var rows = 500;
  rosterDropdown(sh, 3, ['Lead','Prospect','Active','Paused','Cancelled'], rows);  // Status
  rosterDropdown(sh, 4, ['Lean','Strong','Long'], rows);                            // Program
  rosterDropdown(sh, 5, ['Lose','Maintain','Gain'], rows);                          // Goal
  rosterDropdown(sh, 6, ['Community','Wellness','Mastery','Accelerator'], rows);    // Tier

  sh.getRange(2,7,rows,1).setNumberFormat('m/d/yyyy');
  sh.setColumnWidth(1,150); sh.setColumnWidth(2,230); sh.setColumnWidth(8,260);
  Logger.log('Roster tab is ready — go fill it in.');
}

function rosterDropdown(sh, col, values, rows){
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true)
    .setAllowInvalid(false).build();
  sh.getRange(2, col, rows, 1).setDataValidation(rule);
}
