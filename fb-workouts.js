/* ============================================================================
   FIT BODY BOOTCAMP WORKOUTS — week data (gitignored; the gym's programming,
   kept out of the public repo like the LP program). Production will serve the
   current week from the Drive folder via the doorway; this local file is the
   preview source. Tracking model (locked 2026-10-04):
     Strength  -> log WEIGHT on each listed lift (band -> band input); +finisher RPE if finisher
     MetCon    -> RPE per lap (laps) + pacing; +finisher RPE if finisher
     Classic   -> session RPE (+laps completed if AMLAP); +finisher RPE if finisher
   Only the red/tracked strength moves are listed; bodyweight/conditioning omitted.
   ========================================================================== */
window.FB_WEEKS = {
  184: {
    n:184, start:'2026-10-05', end:'2026-10-10', type:'Strength',
    theme:'Low Back Health + Cognitive Stimulus',
    days:{
      Mon:{date:'2026-10-05', style:'Strength', focus:'Upper Push / Lower Pull', finisher:true, lifts:[
        {m:'KB Deficit Deadlift', reps:'8'},
        {m:'Slam Ball SS Rainbow Push Press', reps:'8'},
        {m:'2 YB/DB 1.5 RDL', reps:'8'},
        {m:'2 DB Chest Press', reps:'8'} ]},
      Tue:{date:'2026-10-06', style:'Strength', focus:'Upper Pull / Lower Push', finisher:false, lifts:[
        {m:'ECC KB Sumo Squat', reps:'8', note:'3–5s negative'},
        {m:'2 DB Quadruped Row', reps:'8'},
        {m:'Slam Ball Atlas Ipsilateral Reverse Lunge', reps:'8'},
        {m:'YB/DB Pullovers', reps:'8'} ]},
      Wed:{date:'2026-10-07', style:'MetCon', focus:'Total Body', laps:2, finisher:true},
      Thu:{date:'2026-10-08', style:'Strength', focus:'Upper Push / Lower Pull', finisher:true, lifts:[
        {m:'KB RDL', reps:'8'},
        {m:'2 YB/DB Skullcrushers', reps:'8'},
        {m:'ECC Slam Ball Glute Bridge Raise on Box', reps:'8', note:'3–5s negative'},
        {m:'2 YB/DB HK Alt-from-Bottom OH Press', reps:'8'} ]},
      Fri:{date:'2026-10-09', style:'Strength', focus:'Upper Pull / Lower Push', finisher:false, lifts:[
        {m:'2 YB/DB 21s', reps:'21'},
        {m:'Slam Ball Slider Lateral Lunge', reps:'8'},
        {m:'DB SS Bent-Over Row on Box', reps:'8'},
        {m:'2 KB Suitcase Squat', reps:'8'},
        {m:'Banded HK Lat Pulldown', reps:'8', band:true} ]},
      Sat:{date:'2026-10-10', style:'Classic', focus:'Total Body', laps:1, finisher:true}
    }
  },
  185: {
    n:185, start:'2026-10-12', end:'2026-10-17', type:'Classic',
    theme:'Low Back Health + Cognitive Stimulus',
    days:{
      Mon:{date:'2026-10-12', style:'MetCon', focus:'Total Body', laps:1, finisher:false},
      Tue:{date:'2026-10-13', style:'Strength', focus:'Upper Push / Lower Pull', finisher:false, lifts:[
        {m:'2 DB Chest Press', reps:'14'},
        {m:'KB SA Deadlift', reps:'14'},
        {m:'2 DB Iso-Hold Shoulder Raises', reps:'7×7'},
        {m:'Banded SS OH Tricep Extension', reps:'14', band:true} ]},
      Wed:{date:'2026-10-14', style:'Classic', focus:'Upper Pull / Lower Push', laps:1, finisher:false},
      Thu:{date:'2026-10-15', style:'Classic', focus:'Upper Push / Lower Pull', laps:'AMLAP', finisher:true},
      Fri:{date:'2026-10-16', style:'Strength', focus:'Upper Pull / Lower Push', finisher:false, lifts:[
        {m:'Banded TK Lat Pulldowns', reps:'14', band:true},
        {m:'KB Lateral Lunge to High Pull', reps:'14'},
        {m:'Banded Seated Pronated Rows', reps:'14', band:true},
        {m:'YB SA Front-Rack Uneven Squat', reps:'14'} ]},
      Sat:{date:'2026-10-17', style:'MetCon', focus:'Total Body', laps:1, finisher:true}
    }
  },
  186: {
    n:186, start:'2026-10-19', end:'2026-10-24', type:'Classic',
    theme:'Low Back Health + Cognitive Stimulus',
    days:{
      Mon:{date:'2026-10-19', style:'Strength', focus:'Upper Push / Lower Pull', finisher:true, lifts:[
        {m:'Sandbag Clean', reps:'10'},
        {m:'2 DB 1-1-2 Chest Press', reps:'12'},
        {m:'YB/DB 1.5 RDL', reps:'12'},
        {m:'Slamball HK Rainbow Press', reps:'12'},
        {m:'KB Sumo Deadlift', reps:'12'} ]},
      Tue:{date:'2026-10-20', style:'Classic', focus:'Upper Pull / Lower Push', finisher:false, laps:2},
      Wed:{date:'2026-10-21', style:'MetCon', focus:'Total Body', finisher:false, laps:1},
      Thu:{date:'2026-10-22', style:'Strength', focus:'Upper Pull / Lower Push', finisher:false, lifts:[
        {m:'2DB Supinated Grip Bicep Curl', reps:'12'},
        {m:'Slamball Atlas Slider Lateral Squat', reps:'12'},
        {m:'DB SS SA Neutral Grip Bent Row on Box', reps:'12'},
        {m:'2 KB Heels Elevated Suitcase Squat', reps:'12'},
        {m:'Banded Squat to Neutral Grip Row', reps:'12', band:true} ]},
      Fri:{date:'2026-10-23', style:'Classic', focus:'Upper Push / Lower Pull', finisher:false, laps:1},
      Sat:{date:'2026-10-24', style:'MetCon', focus:'Total Body', finisher:true, laps:2}
    }
  },
  187: {
    n:187, start:'2026-10-26', end:'2026-10-31', type:'MetCon',
    theme:'Low Back Health + Cognitive Stimulus',
    days:{
      Mon:{date:'2026-10-26', style:'MetCon', focus:'Total Body', finisher:false, laps:1},
      Tue:{date:'2026-10-27', style:'Strength', focus:'Upper Pull / Lower Pull', finisher:true, lifts:[
        {m:'2 DB Quadruped Row', reps:'10'},
        {m:'2KB Sumo Deadlift', reps:'10'},
        {m:'YB/KB Pullovers with Glute Bridge Hold', reps:'10'},
        {m:'Sandbag Hip Thrust', reps:'10'} ]},
      Wed:{date:'2026-10-28', style:'MetCon', focus:'Total Body', finisher:false, laps:1},
      Thu:{date:'2026-10-29', style:'Classic', focus:'Upper Pull / Lower Push', finisher:true, laps:1},
      Fri:{date:'2026-10-30', style:'Strength', focus:'Upper Push / Lower Pull', finisher:false, lifts:[
        {m:'2DB Chest on Bosu', reps:'10'},
        {m:'2YB/KB Suitcase RDL', reps:'10'},
        {m:'DB HK OH Tricep Extension', reps:''},
        {m:'Slam Ball SL Glute Bridge Raise on Box', reps:'10'} ]},
      Sat:{date:'2026-10-31', style:'MetCon', focus:'Total Body', finisher:false, laps:'AMLAP'}
    }
  }
};
/* Pick the week whose date range contains `d` (Date); else the nearest upcoming/most-recent. */
window.FB_currentWeek = function(d){
  d = d || new Date(); var iso = d.toISOString().slice(0,10);
  var weeks = Object.values(window.FB_WEEKS).sort(function(a,b){ return a.start<b.start?-1:1; });
  for(var i=0;i<weeks.length;i++){ if(iso>=weeks[i].start && iso<=weeks[i].end) return weeks[i]; }
  for(var j=0;j<weeks.length;j++){ if(weeks[j].start>=iso) return weeks[j]; }   // next upcoming
  return weeks[weeks.length-1];                                                  // else latest
};
/* 4-week cycle anchored on the Oct 5 2026 Strength week: Strength, Classic, Classic, MetCon, repeat.
   Used when a week's `type` isn't set in the data. */
window.FB_weekType = function(startISO){
  var cycle=['Strength','Classic','Classic','MetCon'];
  var anchor=new Date('2026-10-05T12:00:00'), d=new Date(startISO+'T12:00:00');
  var wks=Math.round((d-anchor)/(7*864e5)); var i=((wks%4)+4)%4;
  return cycle[i];
};
