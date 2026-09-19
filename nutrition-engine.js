/* Legacy Performance — shared nutrition engine (macro targets + meal-plan generation).
   ONE source of truth, loaded by BOTH the client dashboard (client.html) and the coach
   Command Center (index.html) so the math never drifts between them. Dependency-free:
   no DOM, no ID/M/WIZ globals — everything comes in as arguments. */

/* Derive the full macro set from a calorie + protein ANCHOR (protein holds, fat floors by sex,
   carbs take the remainder). This is the heart of the controllable system — hand it any calorie
   and protein number (formula default OR a coach/client override) and it fills in carbs + fat. */
function macrosFrom(cal, protein, sex){
  cal=Math.round(+cal); protein=Math.round(+protein);
  var rem=cal-protein*4;
  var floor=/^m/i.test(sex)?55:40;
  var fat=Math.max(floor, Math.round(rem*0.40/9));
  var carbs=Math.max(0, Math.round((rem-fat*9)/4));
  return {calories:cal, protein:protein, carbs:carbs, fat:fat};
}

/* Estimated maintenance (TDEE) from a client's numbers — the "use maintenance" option's source. */
/* THE CALORIE RANGE (Jayme 2026-09-18). Everyone, men and women:
   upper limit  = IDEAL body weight x 15 (theoretical maintenance, "who you are called to be")
   fat-loss     = IDEAL body weight x 13
   Real maintenance sits somewhere between ideal x 15 and current x 15, depending on activity, food
   quality and more. We do not chase it. We start in the range, check in weekly, and the data adjusts.
   Steps are layered on top only for the speed estimates (goalTimeline). */
function maintMult(){ return 15; }
function maintRange(){ return 'between your ideal weight × 15 and your current weight × 15'; }
function computeTDEE(w){
  var g=+w.goalweight;
  if(!(g>0) && typeof estimateGoalWeight==='function') g=estimateGoalWeight(w);
  if(!(g>0)) g=+w.weight;
  return (g>0) ? Math.round(g*15) : 0;
}

/* Daily macro targets from a client's numbers + track (the formula DEFAULT, before any override).
   w = {goalweight, sex, weight, height, age, activity}; track = Lean|Strong|Sustain|Reverse Diet. */
/* Estimate a goal body weight from height + sex (Hamwi ideal body weight) when the member didn't
   enter one — so the nutrition math always has a number to work from. Coach/client can override. */
function estimateGoalWeight(w){
  var h=+w.height;   // inches
  if(isFinite(h) && h>0){
    var isF=/^f/i.test(w.sex||'');
    var lbs = isF ? (100 + 5*(h-60)) : (106 + 6*(h-60));
    return Math.round(Math.max(90, lbs));
  }
  var cw=+w.weight; return (isFinite(cw) && cw>0) ? Math.round(cw) : null;   // last resort: current weight
}
/* ===== THE COEFFICIENT SCALE (calories = goal body weight x multiplier) =====
   LOCKED 2026-09-01. Max THREE phases per phase-name; you never need a fourth.
     15 = maintenance, the Sustain pivot. Up = build. Down = cut.
     10 = the UPPER threshold of needing a reverse diet. At or below it, you do not cut.
   Lean was 15/14/13/12 in CALCULATION_ENGINE.md; Jayme compressed it to 13/12/11 so the
   bottom of Lean lands one step above reverse territory. */
var PHASE_MULT={
  "Lean":         [13,12,11],
  "Strong":       [15,16,17],
  "Sustain":      [15,15,15],
  "Long":         [15,15,15],      // legacy alias for Sustain
  "Reverse Diet": [10,12,13]       // a reverse CLIMBS
};
var PROTEIN_PER_LB={"Lean":1.0,"Sustain":0.9,"Long":0.9,"Strong":0.8,"Reverse Diet":1.0};
var REVERSE_THRESHOLD=10;          // intake / goal weight at or under this = reverse territory

/* ===== TITRATION: the "no new low" rule (LOCKED 2026-09-01) =====
   You do NOT drop a phase on a schedule, and you do not drop it because one week looked flat.
   You drop it only when the scale has stopped setting new lows for long enough that it cannot
   be noise. The window depends on how often they actually weigh:
     weighing DAILY            -> 10 days with no new low
     weighing 3-4x PER WEEK    -> 14 days with no new low   (about the same number of data points)
   entries = [{date:'YYYY-MM-DD'|Date, weight:Number}], any order. */
var TITRATION_WINDOW={daily:10, weekly34:14};
function titrationRead(entries, cadence, asOf){
  var win=TITRATION_WINDOW[cadence]||TITRATION_WINDOW.weekly34;
  var pts=(entries||[]).map(function(e){
      return {t:new Date(e.date).getTime(), w:+e.weight};
    }).filter(function(p){ return isFinite(p.t)&&isFinite(p.w)&&p.w>0; })
      .sort(function(a,b){ return a.t-b.t; });
  if(pts.length<3) return {move:false, ready:false,
    note:"Not enough weigh-ins yet to read a trend. Keep logging."};
  var now=(asOf!=null)?new Date(asOf).getTime():pts[pts.length-1].t;
  var low=pts[0];
  pts.forEach(function(p){ if(p.w < low.w) low=p; });         // the lowest weight on record
  var days=Math.floor((now-low.t)/86400000);
  var expected=(cadence==='daily')?win:Math.ceil(win/7*3);     // rough weigh-ins the window should hold
  var inWindow=pts.filter(function(p){ return p.t>=now-win*86400000; }).length;
  if(inWindow < Math.max(3, Math.floor(expected*0.6)))
    return {move:false, ready:false, daysSinceLow:days,
      note:"Not enough weigh-ins inside the last "+win+" days to call it. Log a few more."};
  if(days>=win) return {move:true, ready:true, daysSinceLow:days, window:win, low:low.w,
    note:"No new low in "+days+" days. That is long enough that it is not noise. Time to titrate down one phase."};
  return {move:false, ready:true, daysSinceLow:days, window:win, low:low.w,
    note:"Your last new low was "+days+" day"+(days===1?"":"s")+" ago. We titrate at "+win+". Hold here."};
}
/* Step a phase number down (Lean/Sustain) or up (Strong/Reverse), capped at 3. */
function nextPhaseNum(track, phaseNum){
  return Math.min(3, Math.max(1, (Math.round(+phaseNum||1))+1));
}

/* Objective read on whether someone is already under-eating badly enough to need a reverse.
   Self-report ("the scale won't move") is a signal; this is the arithmetic version of it. */
function coefficientOf(calories, goalweight){
  var c=+calories, g=+goalweight;
  if(!isFinite(c)||!isFinite(g)||c<=0||g<=0) return null;
  return Math.round(c/g*10)/10;
}
function needsReverse(calories, goalweight){
  var k=coefficientOf(calories, goalweight);
  return (k!=null) && k<=REVERSE_THRESHOLD;
}

/* phaseNum is 1-3 and defaults to 1, so every existing caller keeps working. */
function computePFS(w, track, phaseNum){
  var gbw=+w.goalweight;
  if(!isFinite(gbw) || gbw<=0) gbw=estimateGoalWeight(w);   // auto-estimate from height/sex when not provided
  if(!isFinite(gbw) || gbw<=0) return null;                 // truly no data at all → caller shows the "build" prompt, never NaN
  var ladder=PHASE_MULT[track]||PHASE_MULT.Sustain;
  var n=Math.min(3, Math.max(1, Math.round(+phaseNum||1)));
  var mult=ladder[n-1];
  var ppl=PROTEIN_PER_LB[track]||1.0;
  var base=macrosFrom(Math.round(gbw*mult), Math.round(gbw*ppl), w.sex);
  var tdee=computeTDEE(w);
  base.tdee=tdee; base.delta=base.calories-tdee;
  base.phase=track; base.phaseNum=n; base.multiplier=mult; base.goalweight=gbw;
  return base;
}

/* ===== THE SEASON PLAN — the three variables of deficit planning (added 2026-09-18) =====
   Every deficit is built from three things: THE WORK (lb to lose), THE TIMELINE (how long it
   honestly takes) and THE INTENSITY (how deep the deficit runs). The work is fixed, so timeline and
   intensity trade against each other. LP's rule: the intensity has a ceiling (Lean x13, one step to
   x12), so when the math does not fit, the TIMELINE moves, never the deficit.
   Rate = the method in legacy-nutrition-system CALCULATION_ENGINE s14, per phase:
     weekly lb = (TDEE - that phase's target + extraKcal) x 7 / 3500,  weeks = work / weekly lb
   clamped to the weekly-review band (nutrition-system-manager ADJUSTMENT_TREE): under 0.3 lb/wk is a
   stall, over 1.5 lb/wk is too fast and gets eased. extraKcal = extra daily burn (e.g. added steps).
   No single diet runs past DIET_PHASE_CAP_WKS (brand_engine 6.4b: 12-16 wk), so a bigger goal is
   split into Lean seasons with Sustain between. The LENGTH of those Sustain stretches is not locked,
   so this deliberately does not quote one. Always an estimate. */
var DIET_PHASE_CAP_WKS=16, LEAN_RATE_MIN=0.3, LEAN_RATE_MAX=1.5;
function seasonPlan(w, extraKcal, capWks){
  var cw=+w.weight, gw=+w.goalweight;
  if(!(cw>0)||!(gw>0)||gw>=cw) return null;
  var p1=computePFS(w,'Lean',1), p2=computePFS(w,'Lean',2);
  if(!p1||!p2||!(p1.tdee>0)) return null;
  var ex=+extraKcal||0, cap=+capWks||DIET_PHASE_CAP_WKS, work=cw-gw;
  var rate=function(p){ var r=(p.tdee-p.calories+ex)*7/3500;
    return Math.round(Math.min(LEAN_RATE_MAX,Math.max(LEAN_RATE_MIN,r))*100)/100; };
  var r1=rate(p1), r2=Math.max(rate(p2),r1);
  var slow=Math.ceil(work/r1), fast=Math.ceil(work/r2);
  return {work:Math.round(work), rate1:r1, rate2:r2, weeksLo:fast, weeksHi:slow, capWks:cap,
          seasonsLo:Math.max(1,Math.ceil(fast/cap)), seasonsHi:Math.max(1,Math.ceil(slow/cap)),
          leanMult:[p1.multiplier,p2.multiplier], cal1:p1.calories, cal2:p2.calories};
}

/* ===== MEAL FREQUENCY (LOCKED 2026-09-01) =====
   The ladder, in order. "2 + shake" is the MINIMUM anyone runs. "4" is the upper threshold.
   The shake is a real slot with its own protein, reserved out of the day BEFORE the meals are
   split, so a member on 2 + shake gets two properly sized meals instead of three small ones. */
var MEAL_FREQUENCY={
  "2 + shake":{meals:2, shake:true,  label:"2 meals + a protein shake"},
  "3":        {meals:3, shake:false, label:"3 meals"},
  "3 + shake":{meals:3, shake:true,  label:"3 meals + a protein shake"},
  "4":        {meals:4, shake:false, label:"4 meals"}
};
var FREQUENCY_ORDER=["2 + shake","3","3 + shake","4"];
var SHAKE_PROTEIN_DEFAULT=30;                 // grams. Selectable 25/30/40/50; 30 = one heaping scoop.
function shakeCalories(grams){ return Math.round((+grams||SHAKE_PROTEIN_DEFAULT)*4.5); }
function freqOf(frequency){ return MEAL_FREQUENCY[frequency]||MEAL_FREQUENCY["3"]; }
/* Kept for callers that only need the meal count. Now frequency-aware; still defaults to 3. */
function mealsPerDay(frequency){ return freqOf(frequency).meals; }

/* Split a day's targets into per-meal numbers, reserving the shake FIRST.
   Returns {frequency, meals, shake:{protein,calories}|null, perMeal:{...}, names:[...]}.
   This is the ONE place per-meal math happens — Power Food System, the meal plan generator,
   the Complete Nutrition System and the light dashboard all call it. */
function mealSplit(targets, frequency, shakeGrams){
  var f=freqOf(frequency), t=targets||{};
  var sg=f.shake ? (+shakeGrams||SHAKE_PROTEIN_DEFAULT) : 0;
  var sc=f.shake ? shakeCalories(sg) : 0;
  var cal=Math.max(0,(+t.calories||0)-sc);
  var pro=Math.max(0,(+t.protein||0)-sg);
  var m=f.meals;
  var names=(m===2)?["Lunch","Dinner"]
           :(m===3)?["Breakfast","Lunch","Dinner"]
                   :["Breakfast","Lunch","Dinner","Meal 4"];
  return {
    frequency:(MEAL_FREQUENCY[frequency]?frequency:"3"), label:f.label, meals:m, names:names,
    shake: f.shake ? {protein:sg, calories:sc} : null,
    perMeal:{
      calories:Math.round(cal/m), protein:Math.round(pro/m),
      carbs:Math.round((+t.carbs||0)/m), fat:Math.round((+t.fat||0)/m)
    }
  };
}

/* ===== POWER FOOD SYSTEM deliverable: meal TEMPLATES =====
   The shape of each meal and its targets, with NO specific foods named. The member fills them
   from the tiered lists themselves. This is what the light dashboard shows.
   generateMealPlan() below — specific foods, portioned — is the Complete Nutrition System layer.
   Same engine, two deliverables. That difference IS the product ladder. */
var MEAL_BUILD_ORDER=[
  "Protein first. Start the plate with it.",
  "Add a smart carb, about a fist.",
  "Pile on vegetables, a mountain. Eat freely.",
  "Add fat with intention, about a thumb.",
  "Ask: does this give me something, or just fill space?"
];
function mealTemplates(targets, frequency, shakeGrams){
  var s=mealSplit(targets, frequency, shakeGrams);
  var out=s.names.map(function(n){
    return {name:n, calories:s.perMeal.calories, protein:s.perMeal.protein,
            carbs:s.perMeal.carbs, fat:s.perMeal.fat, build:MEAL_BUILD_ORDER};
  });
  if(s.shake) out.push({name:"Protein shake", calories:s.shake.calories, protein:s.shake.protein,
                        carbs:0, fat:0, build:["Whenever it fits your day. It is a tool, not a meal."]});
  return {frequency:s.frequency, label:s.label, meals:out, buildOrder:MEAL_BUILD_ORDER};
}

/* Fruit & veg target scales with calories, by phase: more volume on a cut, less needed on a bulk.
   grams per 1,000 kcal. Sustain @2,000 cal = 800g (the anchor). */
var PRODUCE_RATE = {"Lean":500, "Sustain":400, "Long":400, "Strong":300, "Reverse Diet":400};
function produceTarget(calories, track){
  var rate = PRODUCE_RATE[track] || 400;
  return Math.round((+calories/1000)*rate/50)*50;   // nearest 50g
}

/* 4-2-1 weekly cycling — same weekly total, redistributed: 4 moderate days, 2 low, 1 high.
   Protein holds every day; the flex lives in carbs & fat. Low = 80% of target, High = 140% (2 low + 1 high = balanced). */
function fourTwoOne(cal, protein, sex){
  return [
    {label:"Moderate", days:4, macros:macrosFrom(Math.round(cal), protein, sex)},
    {label:"Low",      days:2, macros:macrosFrom(Math.round(cal*0.8), protein, sex)},
    {label:"High",     days:1, macros:macrosFrom(Math.round(cal*1.4), protein, sex)}
  ];
}

/* Reverse Diet start — anchor on what they're ACTUALLY eating (recent avg calories), not the generic
   formula, then climb. avgCal = their recent weekly average calories (null if not logged yet). */
function reverseStart(avgCal, goalweight){
  if(avgCal!=null && +avgCal>0) return Math.round(+avgCal)+100;   // Phase 1 = current intake + a small step up
  return Math.round((+goalweight)*11);                            // no data yet → conservative reverse floor
}

/* Reverse Diet weekly read: given this week's + last week's calories and the 2-week weight change,
   decide whether to climb. Returns {move, note}. Protein-first until the protein target is met. */
function reverseRead(thisCal, lastCal, weightDelta, hitProtein){
  var ate_more = (lastCal!=null && thisCal!=null && thisCal > lastCal + 25);
  var held = (weightDelta==null) ? true : Math.abs(weightDelta) < 0.6;   // ~flat = held
  if(thisCal==null) return {move:false, note:"Log this week's average calories so we can read your reverse."};
  if(held){
    var src = hitProtein ? "Add the next ~100 from carbs & fat." : "Put the next ~100 into PROTEIN first — keep climbing protein until you consistently hit your target, then move extra into carbs & fat.";
    return {move:true, dir:"up", note:"Weight held"+(ate_more?" while you ate more":"")+" — your metabolism is absorbing it. Step up ~100 calories. "+src};
  }
  if(weightDelta!=null && weightDelta > 0.6) return {move:false, note:"Weight ticked up — hold here a week and let it settle before the next step."};
  return {move:false, note:"Hold this week — we step up only when the scale holds steady."};
}

/* n  = name
   g  = grams of the ANCHOR macro per unit (kept so every existing caller still works)
   p / c / f = grams of protein / carbs / fat per unit      kcal = calories per unit
   u  = the unit word
   max= most of this food that belongs in ONE meal (the cap that stops "5 cups Greek yogurt")
   slot= am (breakfast) | pm (lunch/dinner) | any
   t  = POWER FOOD SYSTEM TIER. 1 = leanest and most satiating -> 4 = fattiest.
        Plans are BUILT on tier 1. The free Power Food System is what teaches a member how to
        swap in tier 2 and 3 and adjust their own portions for it.
   k  = kind, for eating-style filters: meat | fish | shellfish | dairy | egg | plant
   sub= extra style tag: redmeat | pork
   a  = allergen keys this food carries

   FULL MACROS ADDED 2026-09-01. The engine used to know only a food's anchor macro, so a meal's
   calories were inferred as protein*4 + carbs*4 + fat*9 and undercounted every time (chicken
   carries fat, oats carry protein). Now calories are summed from real per-unit values.
   DISPLAY RULE (Jayme, locked): a member is shown the ANCHOR MACRO + CALORIES only. The other
   macros exist so the maths is honest, not so the client has to read them. */
var FOOD_DB={
  protein:[
    /* Tier 1 - the leanest, the ones every plan is built from */
    {n:"chicken breast",g:8.8,p:8.8,c:0,f:1,kcal:47,u:"oz",max:10,slot:"pm",t:1,k:"meat",src:"USDA FDC 171477 \u00b7 1 oz cooked"},
    {n:"turkey breast",g:8.5,p:8.5,c:0,f:0.6,kcal:42,u:"oz",max:10,slot:"any",t:1,k:"meat",src:"USDA FDC 171496 \u00b7 1 oz cooked"},
    {n:"93% ground turkey",g:7.7,p:7.7,c:0,f:3.3,kcal:60,u:"oz",max:8,slot:"pm",t:1,k:"meat",src:"USDA FDC 172851 \u00b7 1 oz cooked crumbles"},
    {n:"white fish (cod or tilapia)",g:6.9,p:6.9,c:0,f:0.5,kcal:33,u:"oz",max:10,slot:"pm",t:1,k:"fish",a:["fish"],src:"USDA FDC 171956+175177 \u00b7 1 oz cooked (avg cod/tilapia)"},
    {n:"canned tuna",g:5.4,p:5.4,c:0,f:0.3,kcal:26,u:"oz",max:8,slot:"pm",t:1,k:"fish",a:["fish"],src:"USDA FDC 334194 \u00b7 1 oz drained"},
    {n:"shrimp",g:6.8,p:6.8,c:0.1,f:0.1,kcal:28,u:"oz",max:10,slot:"pm",t:1,k:"shellfish",a:["shellfish"],src:"USDA FDC 175180 \u00b7 1 oz cooked"},
    {n:"egg whites",g:3.6,p:3.6,c:0.2,f:0.1,kcal:17,u:"",whole:true,max:8,slot:"any",t:1,k:"egg",a:["egg"],src:"USDA FDC 172183 \u00b7 1 large white"},
    {n:"nonfat Greek yogurt",g:23.4,p:23.4,c:8.3,f:0.8,kcal:138,u:"cup",frac:true,max:1.5,slot:"am",t:1,k:"dairy",a:["dairy"],src:"USDA FDC 330137 \u00b7 1 cup"},
    {n:"low-fat cottage cheese",g:28,p:28,c:6.1,f:2.3,kcal:163,u:"cup",frac:true,max:1.5,slot:"any",t:1,k:"dairy",a:["dairy"],src:"USDA FDC 173417 \u00b7 1 cup"},
    {n:"whey protein powder",g:24,p:24,c:3,f:1.5,kcal:120,u:"scoop",whole:true,max:2,slot:"am",t:1,k:"dairy",a:["dairy"],src:"Label: Optimum Nutrition Gold Standard 100% Whey, 1 scoop (30.4g), optimumnutrition.com"},
    {n:"plant protein powder",g:21,p:21,c:15,f:4,kcal:150,u:"serving",whole:true,max:2,slot:"am",t:1,k:"plant",src:"Label: Orgain Organic Protein, 1 serving = 2 scoops (46g), orgain.com; varies by brand"},
    {n:"96% ground beef",g:8.3,p:8.3,c:0.0,f:2.2,kcal:55,u:"oz",max:8,slot:"pm",t:1,k:"meat",sub:"redmeat",src:"USDA FDC 174028 \u00b7 1 oz cooked crumbles (USDA's leanest record is 95/5)"},
    {n:"eye of round steak",g:8.5,p:8.5,c:0.0,f:1.1,kcal:46,u:"oz",max:9,slot:"pm",t:1,k:"meat",sub:"redmeat",src:"USDA FDC 170633 \u00b7 1 oz cooked, lean only"},
    {n:"deli turkey",g:4.2,p:4.2,c:0.6,f:1.1,kcal:30,u:"oz",max:8,slot:"any",t:1,k:"meat",src:"USDA FDC 172941 \u00b7 1 oz sliced, prepackaged"},
    /* Tier 2 - good, watch the portion */
    {n:"salmon",g:6.3,p:6.3,c:0,f:3.5,kcal:58,u:"oz",max:8,slot:"pm",t:2,k:"fish",a:["fish"],src:"USDA FDC 175168 \u00b7 1 oz cooked, farmed Atlantic"},
    {n:"sirloin steak",g:8.7,p:8.7,c:0,f:1.6,kcal:52,u:"oz",max:9,slot:"pm",t:2,k:"meat",sub:"redmeat",src:"USDA FDC 168634 \u00b7 1 oz cooked, lean only"},
    {n:"93% ground beef",g:8.2,p:8.2,c:0,f:2.7,kcal:59,u:"oz",max:8,slot:"pm",t:2,k:"meat",sub:"redmeat",src:"USDA FDC 174755 \u00b7 1 oz cooked crumbles"},
    {n:"chicken thighs",g:7,p:7,c:0,f:2.3,kcal:51,u:"oz",max:8,slot:"pm",t:2,k:"meat",src:"USDA FDC 172388 \u00b7 1 oz cooked, meat only"},
    {n:"pork tenderloin",g:7.4,p:7.4,c:0,f:1,kcal:40,u:"oz",max:8,slot:"pm",t:2,k:"meat",sub:"pork",src:"USDA FDC 168250 \u00b7 1 oz cooked, lean only"},
    {n:"whole eggs",g:6.3,p:6.3,c:0.4,f:4.8,kcal:72,u:"",whole:true,max:4,slot:"any",t:2,k:"egg",a:["egg"],src:"USDA FDC 171287 \u00b7 1 large"},
    {n:"extra-firm tofu",g:4.9,p:4.9,c:0.8,f:2.5,kcal:41,u:"oz",max:8,slot:"any",t:2,k:"plant",a:["soy"],src:"USDA FDC 172475 \u00b7 1 oz"},
    {n:"tempeh",g:5.6,p:5.6,c:2.2,f:3.2,kcal:55,u:"oz",max:6,slot:"pm",t:2,k:"plant",a:["soy"],src:"USDA FDC 172467 \u00b7 1 oz cooked"},
    {n:"seitan",g:9,p:9,c:2.5,f:0.3,kcal:45,u:"oz",max:6,slot:"pm",t:2,k:"plant",a:["gluten"],src:"Label: Upton's Naturals Traditional Seitan, 2 oz (57g) = 90 kcal / 18g P, uptonsnaturals.com"},
    {n:"edamame",g:18.5,p:18.5,c:13.8,f:8.1,kcal:188,u:"cup",frac:true,max:1.5,slot:"pm",t:2,k:"plant",a:["soy"],src:"USDA FDC 168411 \u00b7 1 cup shelled, prepared"},
    {n:"90% ground beef",g:8.1,p:8.1,c:0.0,f:3.4,kcal:65,u:"oz",max:8,slot:"pm",t:2,k:"meat",sub:"redmeat",src:"USDA FDC 171794 \u00b7 1 oz cooked crumbles"},
    {n:"flank steak",g:7.9,p:7.9,c:0.0,f:2.1,kcal:53,u:"oz",max:9,slot:"pm",t:2,k:"meat",sub:"redmeat",src:"USDA FDC 174774 \u00b7 1 oz cooked, lean only"},
    {n:"filet mignon",g:8.2,p:8.2,c:0.0,f:2.2,kcal:55,u:"oz",max:9,slot:"pm",t:2,k:"meat",sub:"redmeat",src:"USDA FDC 174043 \u00b7 1 oz cooked tenderloin, lean only"},
    {n:"NY strip steak",g:8.3,p:8.3,c:0.0,f:2.0,kcal:54,u:"oz",max:9,slot:"pm",t:2,k:"meat",sub:"redmeat",src:"USDA FDC 171813 \u00b7 1 oz cooked top loin, lean only"},
    {n:"ground bison",g:7.2,p:7.2,c:0.0,f:2.4,kcal:51,u:"oz",max:8,slot:"pm",t:2,k:"meat",sub:"redmeat",src:"USDA FDC 173847 \u00b7 1 oz cooked"},
    {n:"ground chicken",g:6.6,p:6.6,c:0.0,f:3.1,kcal:54,u:"oz",max:8,slot:"pm",t:2,k:"meat",src:"USDA FDC 171117 \u00b7 1 oz cooked crumbles"},
    {n:"pork chop",g:8.5,p:8.5,c:0.0,f:1.3,kcal:46,u:"oz",max:8,slot:"pm",t:2,k:"meat",sub:"pork",src:"USDA FDC 168285 \u00b7 1 oz cooked boneless center loin, lean only"},
    {n:"canned chicken",g:6.2,p:6.2,c:0.0,f:2.3,kcal:47,u:"oz",max:8,slot:"pm",t:2,k:"meat",src:"USDA FDC 171099 \u00b7 1 oz drained"},
    {n:"2% Greek yogurt",g:22.5,p:22.5,c:8.9,f:4.3,kcal:166,u:"cup",frac:true,max:1.5,slot:"am",t:2,k:"dairy",a:["dairy"],src:"USDA FDC 170903 \u00b7 1 cup (227 g), plain lowfat"},
    /* Tier 3 - higher-fat cuts, offset with leaner carbs and fats */
    {n:"ribeye",g:6.8,p:6.8,c:0,f:6,kcal:81,u:"oz",max:8,slot:"pm",t:3,k:"meat",sub:"redmeat",src:"USDA FDC 172165 \u00b7 1 oz cooked, lean and fat"},
    {n:"80/20 ground beef",g:7.7,p:7.7,c:0,f:4.9,kcal:77,u:"oz",max:6,slot:"pm",t:3,k:"meat",sub:"redmeat",src:"USDA FDC 171799 \u00b7 1 oz cooked crumbles"},
    {n:"beef jerky",g:9.4,p:9.4,c:3.1,f:7.3,kcal:116,u:"oz",max:3,slot:"any",t:3,k:"meat",sub:"redmeat",src:"USDA FDC 167536 \u00b7 1 oz"}],
  carb:[
    /* Tier 1 */
    {n:"potatoes",g:31.2,p:2.7,c:31.2,f:0.2,kcal:134,u:"cup",frac:true,max:2,slot:"pm",t:1,k:"plant",src:"USDA FDC 170440 \u00b7 1 cup boiled"},
    {n:"sweet potato",g:41.4,p:4,c:41.4,f:0.3,kcal:180,u:"cup",frac:true,max:2,slot:"pm",t:1,k:"plant",src:"USDA FDC 168483 \u00b7 1 cup baked"},
    {n:"oats",g:54.8,p:10.7,c:54.8,f:5.3,kcal:307,u:"cup dry",frac:true,max:1,slot:"am",t:1,k:"plant",a:["gluten"],src:"USDA FDC 173904 \u00b7 1 cup dry rolled"},
    {n:"lentils",g:39.9,p:17.9,c:39.9,f:0.8,kcal:230,u:"cup",frac:true,max:1.5,slot:"pm",t:1,k:"plant",src:"USDA FDC 172421 \u00b7 1 cup cooked"},
    {n:"black beans",g:40.8,p:15.2,c:40.8,f:0.9,kcal:227,u:"cup",frac:true,max:1.5,slot:"pm",t:1,k:"plant",src:"USDA FDC 173735 \u00b7 1 cup cooked"},
    {n:"chickpeas",g:45,p:14.5,c:45,f:4.2,kcal:269,u:"cup",frac:true,max:1.5,slot:"pm",t:1,k:"plant",src:"USDA FDC 173757 \u00b7 1 cup cooked"},
    {n:"green peas",g:22.8,p:8.2,c:22.8,f:0.4,kcal:125,u:"cup",frac:true,max:2,slot:"pm",t:1,k:"plant",src:"USDA FDC 170017 \u00b7 1 cup cooked"},
    {n:"butternut squash",g:21.5,p:1.8,c:21.5,f:0.2,kcal:82,u:"cup",frac:true,max:2,slot:"pm",t:1,k:"plant",src:"USDA FDC 169296 \u00b7 1 cup cubes baked"},
    {n:"corn",g:31.3,p:5.1,c:31.3,f:2.2,kcal:143,u:"cup",frac:true,max:1.5,slot:"pm",t:1,k:"plant",a:["corn"],src:"USDA FDC 169999 \u00b7 1 cup cooked kernels"},
    {n:"pinto beans",g:44.8,p:15.4,c:44.8,f:1.2,kcal:245,u:"cup",frac:true,max:1.5,slot:"pm",t:1,k:"plant",src:"USDA FDC 175200 \u00b7 1 cup cooked"},
    {n:"kidney beans",g:40.4,p:15.4,c:40.4,f:0.9,kcal:225,u:"cup",frac:true,max:1.5,slot:"pm",t:1,k:"plant",src:"USDA FDC 175194 \u00b7 1 cup cooked"},
    {n:"barley",g:44.3,p:3.6,c:44.3,f:0.6,kcal:193,u:"cup",frac:true,max:2,slot:"pm",t:1,k:"plant",a:["gluten"],src:"USDA FDC 170285 \u00b7 1 cup cooked, pearled"},
    {n:"popcorn",g:6.2,p:1.0,c:6.2,f:0.4,kcal:31,u:"cup",frac:true,max:4,slot:"any",t:1,k:"plant",a:["corn"],src:"USDA FDC 167959 \u00b7 1 cup air-popped"},
    /* Tier 2 */
    {n:"white rice",g:44.5,p:4.3,c:44.5,f:0.4,kcal:205,u:"cup",frac:true,max:2,slot:"pm",t:2,k:"plant",src:"USDA FDC 168878 \u00b7 1 cup cooked"},
    {n:"brown rice",g:51.7,p:5.5,c:51.7,f:2,kcal:248,u:"cup",frac:true,max:2,slot:"pm",t:2,k:"plant",src:"USDA FDC 169704 \u00b7 1 cup cooked"},
    {n:"quinoa",g:39.4,p:8.1,c:39.4,f:3.6,kcal:222,u:"cup",frac:true,max:2,slot:"pm",t:2,k:"plant",src:"USDA FDC 168917 \u00b7 1 cup cooked"},
    {n:"sourdough",g:22.3,p:4.6,c:22.3,f:1,kcal:117,u:"slice",whole:true,max:3,slot:"any",t:2,k:"plant",a:["gluten"],src:"USDA FDC 172675 \u00b7 1 sandwich slice (43g)"},
    {n:"whole-wheat pasta",g:42.1,p:8.4,c:42.1,f:2.4,kcal:209,u:"cup",frac:true,max:2,slot:"pm",t:2,k:"plant",a:["gluten"],src:"USDA FDC 168910 \u00b7 1 cup cooked"},
    {n:"corn tortilla",g:10.7,p:1.4,c:10.7,f:0.7,kcal:52,u:"tortilla",whole:true,max:4,slot:"any",t:2,k:"plant",a:["corn"],src:"USDA FDC 175036 \u00b7 1 tortilla"},
    {n:"whole-wheat bread",g:13.7,p:4.0,c:13.7,f:1.1,kcal:81,u:"slice",whole:true,max:3,slot:"any",t:2,k:"plant",a:["gluten"],src:"USDA FDC 172688 \u00b7 1 slice"},
    {n:"English muffin",g:28.6,p:4.0,c:28.6,f:1.0,kcal:140,u:"",whole:true,max:2,slot:"am",t:2,k:"plant",a:["gluten"],src:"USDA FDC 174093 \u00b7 1 muffin, whole grain white"},
    {n:"rice cakes",g:7.3,p:0.7,c:7.3,f:0.3,kcal:35,u:"cake",whole:true,max:4,slot:"any",t:2,k:"plant",src:"USDA FDC 170250 \u00b7 1 cake, brown rice"},
    {n:"cream of rice",g:28.1,p:2.2,c:28.1,f:0.2,kcal:127,u:"cup",frac:true,max:2,slot:"am",t:2,k:"plant",src:"USDA FDC 173914 \u00b7 1 cup cooked"},
    {n:"couscous",g:36.4,p:6.0,c:36.4,f:0.3,kcal:176,u:"cup",frac:true,max:2,slot:"pm",t:2,k:"plant",a:["gluten"],src:"USDA FDC 169700 \u00b7 1 cup cooked"},
    /* Tier 3 */
    {n:"white pasta",g:43.2,p:8.1,c:43.2,f:1.3,kcal:221,u:"cup",frac:true,max:2,slot:"pm",t:3,k:"plant",a:["gluten"],src:"USDA FDC 169737 \u00b7 1 cup cooked"},
    {n:"bagel",g:55,p:11.1,c:55,f:1.4,kcal:277,u:"",whole:true,max:1,slot:"am",t:3,k:"plant",a:["gluten"],src:"USDA FDC 174899 \u00b7 1 medium"},
    {n:"flour tortilla",g:24.2,p:3.9,c:24.2,f:3.7,kcal:146,u:"tortilla",whole:true,max:2,slot:"any",t:3,k:"plant",a:["gluten"],src:"USDA FDC 167535 \u00b7 1 tortilla"},
    {n:"granola",g:65.8,p:16.7,c:65.8,f:29.6,kcal:597,u:"cup",frac:true,max:0.5,slot:"am",t:3,k:"plant",a:["gluten","nut"],src:"USDA FDC 171646 \u00b7 1 cup"}],
  fat:[
    /* Tier 1 */
    {n:"avocado",g:21,p:2.7,c:11.8,f:21,kcal:227,u:"",frac:true,max:1,slot:"any",t:1,k:"plant",src:"USDA FDC 171706 \u00b7 1 fruit"},
    {n:"chia seeds",g:3.7,p:2,c:5.1,f:3.7,kcal:58,u:"tbsp",frac:true,max:3,slot:"am",t:1,k:"plant",src:"USDA FDC 170554 \u00b7 1 tbsp"},
    {n:"ground flaxseed",g:3,p:1.3,c:2,f:3,kcal:37,u:"tbsp",frac:true,max:3,slot:"am",t:1,k:"plant",src:"USDA FDC 169414 \u00b7 1 tbsp ground"},
    {n:"hemp seeds",g:4.9,p:3.2,c:0.9,f:4.9,kcal:55,u:"tbsp",frac:true,max:3,slot:"am",t:1,k:"plant",src:"USDA FDC 170148 \u00b7 1 tbsp"},
    {n:"walnuts",g:4.8,p:1.1,c:1,f:4.8,kcal:48,u:"tbsp",frac:true,max:3,slot:"am",t:1,k:"plant",a:["nut"],src:"USDA FDC 170187 \u00b7 1 tbsp chopped"},
    {n:"olives",g:0.9,p:0.1,c:0.5,f:0.9,kcal:10,u:"tbsp",frac:true,max:4,slot:"pm",t:1,k:"plant",src:"USDA FDC 169094 \u00b7 1 tbsp"},
    /* Tier 2 */
    {n:"almonds",g:4.4,p:1.9,c:1.9,f:4.4,kcal:52,u:"tbsp",frac:true,max:3,slot:"am",t:2,k:"plant",a:["nut"],src:"USDA FDC 170567 \u00b7 1 tbsp"},
    {n:"almond butter",g:8.9,p:3.4,c:3,f:8.9,kcal:98,u:"tbsp",frac:true,max:3,slot:"am",t:2,k:"plant",a:["nut"],src:"USDA FDC 168588 \u00b7 1 tbsp"},
    {n:"peanut butter",g:8.2,p:3.6,c:3.6,f:8.2,kcal:96,u:"tbsp",frac:true,max:3,slot:"am",t:2,k:"plant",a:["peanut"],src:"USDA FDC 172470 \u00b7 1 tbsp"},
    {n:"tahini",g:8.1,p:2.5,c:3.2,f:8.1,kcal:89,u:"tbsp",frac:true,max:3,slot:"any",t:2,k:"plant",a:["sesame"],src:"USDA FDC 170189 \u00b7 1 tbsp"},
    {n:"pumpkin seeds",g:4,p:2.4,c:0.9,f:4,kcal:45,u:"tbsp",frac:true,max:3,slot:"any",t:2,k:"plant",src:"USDA FDC 170556 \u00b7 1 tbsp"},
    {n:"hummus",g:2.7,p:1.2,c:2.2,f:2.7,kcal:36,u:"tbsp",frac:true,max:6,slot:"pm",t:2,k:"plant",a:["sesame"],src:"USDA FDC 174289 \u00b7 1 tbsp"},
    {n:"cheese",g:9.6,p:6.6,c:0.7,f:9.6,kcal:116,u:"oz",frac:true,max:3,slot:"any",t:2,k:"dairy",a:["dairy"],src:"USDA FDC 328637 \u00b7 1 oz cheddar"},
    {n:"sunflower seeds",g:4.0,p:1.5,c:1.9,f:4.0,kcal:47,u:"tbsp",frac:true,max:3,slot:"any",t:2,k:"plant",src:"USDA FDC 170563 \u00b7 1 tbsp dry roasted"},
    {n:"cashews",g:4.0,p:1.3,c:2.8,f:4.0,kcal:49,u:"tbsp",frac:true,max:3,slot:"any",t:2,k:"plant",a:["nut"],src:"USDA FDC 170571 \u00b7 1 tbsp dry roasted"},
    {n:"pistachios",g:3.5,p:1.6,c:2.2,f:3.5,kcal:44,u:"tbsp",frac:true,max:3,slot:"any",t:2,k:"plant",a:["nut"],src:"USDA FDC 170185 \u00b7 1 tbsp dry roasted"},
    {n:"pecans",g:4.9,p:0.6,c:0.9,f:4.9,kcal:47,u:"tbsp",frac:true,max:3,slot:"am",t:2,k:"plant",a:["nut"],src:"USDA FDC 170182 \u00b7 1 tbsp chopped"},
    /* Tier 3 - cooking fats, deliberately last */
    {n:"olive oil",g:1,p:0,c:0,f:1,kcal:8.84,u:"g",max:27,slot:"pm",t:3,k:"plant",src:"USDA FDC 171413 \u00b7 1 tbsp"},
    {n:"butter",g:11.5,p:0.1,c:0,f:11.5,kcal:102,u:"tbsp",frac:true,max:2,slot:"any",t:3,k:"dairy",a:["dairy"],src:"USDA FDC 173410 \u00b7 1 tbsp"},
    {n:"avocado oil",g:1.0,p:0.0,c:0.0,f:1.0,kcal:8.84,u:"g",max:27,slot:"pm",t:3,k:"plant",src:"USDA FDC 173573 \u00b7 1 g"},
    {n:"coconut oil",g:1.0,p:0.0,c:0.0,f:1.0,kcal:8.92,u:"g",max:27,slot:"any",t:3,k:"plant",src:"USDA FDC 171412 \u00b7 1 g"},
    {n:"dark chocolate",g:12.1,p:2.2,c:13.0,f:12.1,kcal:170,u:"oz",frac:true,max:1,slot:"any",t:3,k:"plant",src:"USDA FDC 170273 \u00b7 1 oz, 70 to 85% cacao"}],
  /* Vegetables stay plain strings: client.html and index.html consume FOOD_DB.veg directly.
     They are eaten freely and not calorie-counted, per the Power Food System. */
  /* FRUIT (Jayme 2026-09-18): its own list to pick from. The engine still counts fruit as a carb when
     it builds meals. Tier 1 = most fiber and nutrients for the calories; tier 3 = lower fiber, more
     sugar and calories. */
  fruit:[
    /* Tier 1 - high fiber, nutrient dense */
    {n:"berries",g:16.6,p:1.1,c:16.6,f:0.5,kcal:67,u:"cup",frac:true,max:2,slot:"am",t:1,k:"plant",src:"USDA FDC 171711+167762 \u00b7 1 cup (avg blueberries/strawberries)"},
    {n:"apple",g:25.1,p:0.5,c:25.1,f:0.3,kcal:95,u:"",whole:true,max:2,slot:"am",t:1,k:"plant",src:"USDA FDC 171688 \u00b7 1 medium"},
    {n:"raspberries",g:14.6,p:1.5,c:14.6,f:0.9,kcal:64,u:"cup",frac:true,max:2,slot:"am",t:1,k:"plant",src:"USDA FDC 167755 \u00b7 1 cup"},
    {n:"blackberries",g:13.8,p:2.0,c:13.8,f:0.7,kcal:62,u:"cup",frac:true,max:2,slot:"am",t:1,k:"plant",src:"USDA FDC 173946 \u00b7 1 cup"},
    {n:"strawberries",g:11.1,p:1.0,c:11.1,f:0.4,kcal:46,u:"cup",frac:true,max:2,slot:"am",t:1,k:"plant",src:"USDA FDC 167762 \u00b7 1 cup whole"},
    {n:"blueberries",g:21.5,p:1.0,c:21.5,f:0.4,kcal:84,u:"cup",frac:true,max:2,slot:"am",t:1,k:"plant",src:"USDA FDC 171711 \u00b7 1 cup"},
    {n:"pear",g:27.1,p:0.7,c:27.1,f:0.2,kcal:101,u:"",whole:true,max:2,slot:"am",t:1,k:"plant",src:"USDA FDC 169118 \u00b7 1 medium"},
    {n:"orange",g:15.5,p:1.2,c:15.5,f:0.1,kcal:62,u:"",whole:true,max:2,slot:"am",t:1,k:"plant",src:"USDA FDC 169097 \u00b7 1 fruit"},
    {n:"kiwi",g:10.1,p:0.8,c:10.1,f:0.3,kcal:42,u:"",whole:true,max:3,slot:"am",t:1,k:"plant",src:"USDA FDC 168153 \u00b7 1 fruit"},
    {n:"grapefruit",g:13.2,p:1.0,c:13.2,f:0.1,kcal:52,u:"half",whole:true,max:2,slot:"am",t:1,k:"plant",src:"USDA FDC 174673 \u00b7 1/2 fruit"},
    /* Tier 2 */
    {n:"banana",g:27,p:1.3,c:27,f:0.4,kcal:105,u:"",whole:true,max:2,slot:"am",t:2,k:"plant",src:"USDA FDC 173944 \u00b7 1 medium"},
    {n:"peach",g:14.2,p:1.4,c:14.2,f:0.3,kcal:58,u:"",whole:true,max:2,slot:"am",t:2,k:"plant",src:"USDA FDC 169928 \u00b7 1 medium"},
    {n:"cherries",g:24.6,p:1.7,c:24.6,f:0.3,kcal:97,u:"cup",frac:true,max:1.5,slot:"am",t:2,k:"plant",src:"USDA FDC 171719 \u00b7 1 cup, pitted"},
    {n:"pineapple",g:21.6,p:0.8,c:21.6,f:0.2,kcal:82,u:"cup",frac:true,max:1.5,slot:"am",t:2,k:"plant",src:"USDA FDC 169124 \u00b7 1 cup chunks"},
    {n:"mango",g:24.8,p:1.3,c:24.8,f:0.7,kcal:99,u:"cup",frac:true,max:1.5,slot:"am",t:2,k:"plant",src:"USDA FDC 169910 \u00b7 1 cup pieces"},
    {n:"cantaloupe",g:13.1,p:1.3,c:13.1,f:0.3,kcal:54,u:"cup",frac:true,max:2,slot:"am",t:2,k:"plant",src:"USDA FDC 169092 \u00b7 1 cup cubes"},
    {n:"watermelon",g:11.4,p:0.9,c:11.4,f:0.2,kcal:46,u:"cup",frac:true,max:2,slot:"am",t:2,k:"plant",src:"USDA FDC 167765 \u00b7 1 cup diced"},
    /* Tier 3 - lower fiber, more sugar and calories */
    {n:"grapes",g:27.3,p:1.1,c:27.3,f:0.3,kcal:104,u:"cup",frac:true,max:1.5,slot:"am",t:3,k:"plant",src:"USDA FDC 174683 \u00b7 1 cup"},
    {n:"raisins",g:11.1,p:0.5,c:11.1,f:0.0,kcal:42,u:"box",whole:true,max:2,slot:"am",t:3,k:"plant",src:"USDA FDC 168165 \u00b7 1 mini box (14 g)"},
    {n:"dates",g:18.0,p:0.4,c:18.0,f:0.0,kcal:66,u:"",whole:true,max:3,slot:"am",t:3,k:"plant",src:"USDA FDC 168191 \u00b7 1 medjool date, pitted"}],
  veg:["broccoli","spinach","peppers","zucchini","green beans","asparagus","salad greens",
       "cauliflower","mushrooms","cucumber","tomatoes","cabbage","brussels sprouts","carrots"]
};
/* WEIGHED, NOT MEASURED (Jayme 2026-09-19): every portion prints in ounces (meat, fish, tofu) or grams
   (everything else), because weighing is what the tracking course teaches. Cups, tablespoons, scoops
   and slices are gone. Each food keeps its USDA-sourced macros: GRAMS_PER_UNIT is the gram weight of
   the old serving, derived from the same USDA record (kcal per serving / kcal per 100 g), or the label
   for protein powders. Whole eggs stay a count: a large egg is a standard weight. */
var COUNTABLE={'banana':'medium','apple':'medium','pear':'medium','orange':'medium','kiwi':'','peach':'medium','grapefruit':'',
  'avocado':'','bagel':'medium','English muffin':'','sourdough':'','whole-wheat bread':'','corn tortilla':'','flour tortilla':'',
  'rice cakes':'','dates':'medjool','raisins':'mini box','egg whites':'large'};
var GRAMS_PER_UNIT={"egg whites": 32.7, "nonfat Greek yogurt": 226.2, "low-fat cottage cheese": 226.4, "whey protein powder": 30.4, "plant protein powder": 46, "edamame": 155.4, "2% Greek yogurt": 227.4, "potatoes": 155.8, "sweet potato": 200.0, "oats": 81.0, "lentils": 198.3, "black beans": 172.0, "chickpeas": 164.0, "green peas": 160.3, "butternut squash": 205.0, "corn": 149.0, "pinto beans": 171.3, "kidney beans": 177.2, "barley": 156.9, "popcorn": 8.0, "white rice": 157.7, "brown rice": 201.6, "quinoa": 185.0, "sourdough": 43.0, "whole-wheat pasta": 140.3, "corn tortilla": 23.9, "whole-wheat bread": 32.1, "English muffin": 57.1, "rice cakes": 9.0, "cream of rice": 244.2, "couscous": 157.1, "white pasta": 139.9, "bagel": 104.9, "flour tortilla": 49.2, "granola": 122.1, "avocado": 135.9, "chia seeds": 11.9, "ground flaxseed": 6.9, "hemp seeds": 9.9, "walnuts": 7.3, "olives": 8.6, "almonds": 9.0, "almond butter": 16.0, "peanut butter": 16.1, "tahini": 15.0, "pumpkin seeds": 8.1, "hummus": 15.2, "sunflower seeds": 8.1, "cashews": 8.5, "pistachios": 7.7, "pecans": 6.8, "butter": 14.2, "berries": 150.6, "apple": 182.7, "raspberries": 123.1, "blackberries": 144.2, "strawberries": 143.8, "blueberries": 147.4, "pear": 177.2, "orange": 131.9, "kiwi": 68.9, "grapefruit": 123.8, "banana": 118.0, "peach": 148.7, "cherries": 154.0, "pineapple": 164.0, "mango": 165.0, "cantaloupe": 158.8, "watermelon": 153.3, "grapes": 150.7, "raisins": 14.0, "dates": 23.8, "cheese": 28.35, "dark chocolate": 28.35};
(function(){
  ['protein','carb','fat','fruit'].forEach(function(cat){
    (FOOD_DB[cat]||[]).forEach(function(f){
      f.cat=cat;
      var g=GRAMS_PER_UNIT[f.n]; if(!g) return;
      f.gpu=g; f.unitWas=f.u;
      /* Countable foods read better as a thing plus its weight: "1 medium banana (118 g)". */
      if(Object.prototype.hasOwnProperty.call(COUNTABLE, f.n)){ f.desc=COUNTABLE[f.n]; return; }
      f.g=f.g/g; f.p=f.p/g; f.c=f.c/g; f.f=f.f/g; f.kcal=f.kcal/g;
      f.max=Math.round((f.max||1)*g); f.u='g'; f.whole=false; f.frac=false;
    });
  });
})();
/* Vegetables print by weight too. Grams in one cup, USDA household weights. */
var VEG_G={broccoli:91, spinach:30, peppers:92, zucchini:124, 'green beans':110, asparagus:134, 'salad greens':47,
  cauliflower:107, mushrooms:70, cucumber:119, tomatoes:180, cabbage:89, 'brussels sprouts':88, carrots:128};
function vegGrams(n, cups){ return Math.max(25, Math.round((VEG_G[n]||90)*(cups||1)/5)*5); }



/* ===== NAMED MEALS (LP's own) =====
   Method borrowed from how the best recipe products work (Exceed OS analysis, 2026-09-01): obvious
   meals beat clever ones, low effort and batch-friendly, repetition is a feature. The RECIPES are
   ours, not theirs: each is a meal shape built only from sourced FOOD_DB foods, portioned to the
   member's numbers by the same fill logic as every other option. A template is used only when her
   food list and eating style can actually make it. */
var MEAL_NICE={'chicken breast':'Chicken','turkey breast':'Turkey','93% ground turkey':'Ground Turkey',
  'white fish (cod or tilapia)':'White Fish','canned tuna':'Tuna','shrimp':'Shrimp','egg whites':'Egg White',
  'nonfat Greek yogurt':'Greek Yogurt','low-fat cottage cheese':'Cottage Cheese','whey protein powder':'Protein',
  'plant protein powder':'Plant Protein','salmon':'Salmon','sirloin steak':'Steak','93% ground beef':'Lean Beef',
  'chicken thighs':'Chicken Thigh','pork tenderloin':'Pork Tenderloin','whole eggs':'Egg','extra-firm tofu':'Tofu',
  'tempeh':'Tempeh','seitan':'Seitan','edamame':'Edamame','ribeye':'Ribeye','80/20 ground beef':'Beef',
  'potatoes':'Potatoes','sweet potato':'Sweet Potato','oats':'Oats','lentils':'Lentil','black beans':'Black Bean',
  'chickpeas':'Chickpea','green peas':'Pea','butternut squash':'Squash','berries':'Berry','banana':'Banana',
  'apple':'Apple','corn':'Corn','white rice':'Rice','brown rice':'Brown Rice','quinoa':'Quinoa','sourdough':'Toast',
  'whole-wheat pasta':'Pasta','white pasta':'Pasta','corn tortilla':'Taco','bagel':'Bagel',
  'broccoli':'Broccoli','spinach':'Spinach','peppers':'Peppers','zucchini':'Zucchini','green beans':'Green Beans',
  'asparagus':'Asparagus','salad greens':'Greens','cauliflower':'Cauliflower','mushrooms':'Mushrooms',
  'cucumber':'Cucumber','tomatoes':'Tomatoes','cabbage':'Cabbage','brussels sprouts':'Brussels Sprouts','carrots':'Carrots',
  '96% ground beef':'Lean Ground Beef','90% ground beef':'Ground Beef','ground bison':'Bison','ground chicken':'Ground Chicken','flank steak':'Flank Steak','filet mignon':'Filet','NY strip steak':'Strip Steak','eye of round steak':'Steak','pork chop':'Pork Chop','deli turkey':'Turkey','canned chicken':'Chicken','2% Greek yogurt':'Greek Yogurt'};
function mealNice(n){ return MEAL_NICE[n] || (n ? n.charAt(0).toUpperCase()+n.slice(1) : ''); }
/* Vegetables that are eaten raw in a no-cook meal. */
var RAW_VEG=['salad greens','spinach','cucumber','tomatoes','peppers','carrots','cabbage'];
var MEAL_TEMPLATES=[
  /* breakfast */
  {id:'parfait', slot:'am', nocook:true, veg:false, protein:['nonfat Greek yogurt','2% Greek yogurt','whey protein powder'], carb:['berries','banana','apple','granola'],
   fat:['walnuts','almonds','chia seeds','hemp seeds','pumpkin seeds','ground flaxseed','almond butter','peanut butter'], minUnits:{'nonfat Greek yogurt':1},
   name:function(r){ return 'Greek Yogurt '+(r.fruit?mealNice(r.fruit)+' ':'')+'Parfait'; }, lead:['nonfat Greek yogurt'], boost:['whey protein powder'], carbs:2},
  {id:'scramble', slot:'am', veg:true, lead:['whole eggs','egg whites'], boost:['egg whites','turkey breast'], protein:['whole eggs','egg whites','turkey breast'], carb:['sourdough','potatoes','sweet potato','bagel'],
   vegs:['spinach','peppers','onions','tomatoes','mushrooms','zucchini','asparagus'], fat:['avocado','cheese','butter'], name:function(r){ return (r.p==='egg whites'?'Egg White':'Egg')+' Scramble with '+mealNice(r.v||'spinach')+(r.c?' and '+mealNice(r.c):''); }},
  {id:'oats', slot:'am', nocook:true, veg:false, protein:['whey protein powder','plant protein powder','nonfat Greek yogurt','egg whites'], carb:['oats','berries','banana'],
   fat:['peanut butter','almond butter','chia seeds','walnuts','hemp seeds'], name:function(r){ return 'Overnight Protein Oats'+(r.fruit?' with '+(r.fruit==='berries'?'Berries':mealNice(r.fruit)):''); }, needs:['oats'], carbs:2, minUnits:{'oats':0.5}},
  {id:'cottage', slot:'am', nocook:true, veg:false, protein:['low-fat cottage cheese'], carb:['berries','apple','banana'],
   fat:['almonds','walnuts','pumpkin seeds','chia seeds'], name:function(r){ return 'Cottage Cheese and '+mealNice(r.fruit||r.c||'berries')+' Bowl'; }, boost:['nonfat Greek yogurt'], carbs:2},
  {id:'btacos', slot:'am', veg:true, protein:['whole eggs','egg whites','93% ground turkey'], carb:['corn tortilla','potatoes'],
   fat:['avocado','cheese'], vegs:['peppers','spinach','onions','tomatoes'], name:function(){ return 'Breakfast Tacos'; }, lead:['whole eggs','egg whites'], boost:['egg whites'], needs:['corn tortilla']},
  {id:'smoothie', slot:'am', nocook:true, veg:false, protein:['whey protein powder','plant protein powder','nonfat Greek yogurt'], carb:['banana','berries','oats'],
   fat:['almond butter','peanut butter','chia seeds','hemp seeds','ground flaxseed'], name:function(r){ return mealNice(r.fruit||'berries')+' Protein Smoothie'; }, lead:['whey protein powder','plant protein powder'], boost:['nonfat Greek yogurt'], carbs:2, needsAny:['banana','berries']},
  {id:'tofuscramble', slot:'am', veg:true, protein:['extra-firm tofu'], carb:['potatoes','sourdough','sweet potato'],
   fat:['avocado','hemp seeds'], name:function(r){ return 'Tofu Scramble with '+mealNice(r.c||'potatoes'); }},
  /* lunch and dinner */
  {id:'bowl', slot:'pm', veg:true, protein:['chicken breast','chicken thighs','93% ground turkey','sirloin steak','flank steak','96% ground beef','ground bison','ground chicken','salmon','shrimp','pork tenderloin','extra-firm tofu','tempeh','seitan'],
   carb:['white rice','brown rice','quinoa'], fat:['avocado','olive oil','tahini'],
   name:function(r){ return mealNice(r.p)+', '+mealNice(r.c)+' and '+mealNice(r.v||'broccoli')+' Bowl'; }},
  {id:'sheetpan', slot:'pm', veg:true, protein:['salmon','white fish (cod or tilapia)','sirloin steak','NY strip steak','filet mignon','eye of round steak','chicken breast','pork tenderloin','pork chop','chicken thighs','turkey breast','ribeye'],
   carb:['potatoes','sweet potato','butternut squash'], fat:['olive oil','butter'],
   name:function(r){ return mealNice(r.p)+' with Roasted '+mealNice(r.c)+' and '+mealNice(r.v||'green beans'); }},
  {id:'tacos', slot:'pm', veg:true, protein:['93% ground turkey','96% ground beef','93% ground beef','90% ground beef','ground chicken','chicken breast','shrimp','white fish (cod or tilapia)','80/20 ground beef'],
   carb:['corn tortilla','black beans'], fat:['avocado','cheese'], name:function(r){ return mealNice(r.p)+' Tacos'; }, needs:['corn tortilla'], carbs:2},
  {id:'burrito', slot:'pm', veg:true, protein:['chicken breast','96% ground beef','93% ground beef','93% ground turkey','sirloin steak','flank steak','extra-firm tofu'],
   carb:['white rice','brown rice','black beans'], fat:['avocado','cheese'], vegs:['peppers','onions','salad greens','tomatoes'], carbs:1, name:function(r){ return mealNice(r.p)+' Burrito Bowl'; }},
  {id:'pasta', slot:'pm', veg:true, protein:['93% ground beef','93% ground turkey','chicken breast','shrimp'],
   carb:['whole-wheat pasta','white pasta'], fat:['olive oil','cheese'], name:function(r){ return mealNice(r.p)+' Pasta with '+mealNice(r.v||'spinach'); }},
  {id:'stirfry', slot:'pm', veg:true, protein:['chicken breast','shrimp','sirloin steak','flank steak','pork tenderloin','extra-firm tofu','tempeh','edamame'],
   carb:['white rice','brown rice','quinoa'], fat:['olive oil'], vegs:['broccoli','peppers','zucchini','green beans','asparagus','snap peas','mushrooms','onions'], name:function(r){ return mealNice(r.p)+' Stir-Fry'; }},
  {id:'salad', slot:'pm', veg:true, protein:['chicken breast','salmon','canned tuna','shrimp','turkey breast','whole eggs','edamame'],
   carb:['chickpeas','quinoa','sweet potato','sourdough'], fat:['avocado','olives','olive oil','walnuts','cheese','hummus'],
   vegs:['salad greens','spinach','peppers','tomatoes','cucumber'], name:function(r){ return mealNice(r.p)+' Power Salad'; }},
  {id:'sandwich', slot:'pm', veg:true, protein:['turkey breast','deli turkey','canned tuna','canned chicken','chicken breast'], carb:['sourdough','whole-wheat bread','bagel'],
   fat:['avocado','hummus','cheese'], name:function(r){ return mealNice(r.p)+' and '+mealNice(r.f||'avocado')+' Sandwich'; }},
  /* NO-COOK lunches and dinners (Jayme 2026-09-19): assembled from ready-to-eat foods, raw vegetables only. */
  {id:'nc_sandwich', slot:'pm', nocook:true, veg:true, protein:['deli turkey','canned chicken','canned tuna'], carb:['whole-wheat bread','sourdough'],
   fat:['cheese','avocado','hummus'], vegs:RAW_VEG, name:function(r){ return mealNice(r.p)+' Sandwich'+(r.f?' with '+mealNice(r.f):''); }, needsAny:['whole-wheat bread','sourdough']},
  {id:'nc_wrap', slot:'pm', nocook:true, veg:true, protein:['canned chicken','deli turkey','canned tuna'], carb:['flour tortilla'],
   fat:['avocado','hummus','cheese'], vegs:RAW_VEG, name:function(r){ return mealNice(r.p)+' Wrap'; }, needs:['flour tortilla']},
  {id:'nc_plate', slot:'pm', nocook:true, veg:true, protein:['canned tuna','canned chicken','deli turkey'], carb:['chickpeas','rice cakes','whole-wheat bread'],
   fat:['hummus','avocado','olives'], vegs:RAW_VEG, name:function(r){ return mealNice(r.p)+' and '+mealNice(r.f||'hummus')+' Plate'; }},
  {id:'nc_plant', slot:'pm', nocook:true, veg:true, protein:['edamame','extra-firm tofu','plant protein powder','2% Greek yogurt','low-fat cottage cheese'], carb:['chickpeas','black beans','whole-wheat bread'],
   fat:['hummus','avocado'], vegs:RAW_VEG, lead:['edamame','extra-firm tofu'], boost:['plant protein powder'],
   name:function(r){ return mealNice(r.p)+' and '+mealNice(r.c||'chickpeas')+' Salad'; }},
  {id:'grainbowl', slot:'pm', veg:true, protein:['extra-firm tofu','tempeh','seitan','edamame'], carb:['lentils','chickpeas','quinoa','black beans'],
   fat:['tahini','hummus','avocado'], name:function(r){ return mealNice(r.p)+' and '+mealNice(r.c)+' Bowl'; }}
];
MEAL_NICE['avocado']='Avocado'; MEAL_NICE['hummus']='Hummus'; MEAL_NICE['cheese']='Cheese';
/* Order a template's foods: her starred foods first, then her picks, then the template's own order. */
function tplPool(pool, names, picks, starred){
  var inTpl=pool.filter(function(f){ return names.indexOf(f.n)>=0; });
  var rank=function(f){ var st=(starred||[]).indexOf(f.n); if(st>=0) return st; return (picks&&picks.length&&picks.indexOf(f.n)>=0) ? 10 : 20+names.indexOf(f.n); };
  return inTpl.sort(function(a,b){ return rank(a)-rank(b); });
}
function mealName(tpl, opt){
  var ps=opt.parts||[], role=function(list){ return ps.filter(function(x){ return !x.veg && list.indexOf(x.n)>=0; }).map(function(x){ return x.n; }); };
  var pr=role(tpl.protein), cr=role(tpl.carb), fr=role(tpl.fat||[]), vg=ps.filter(function(x){ return x.veg; })[0];
  var fruit=cr.filter(function(n){ return /berries|banana|apple/.test(n); })[0];
  try { return tpl.name({p:pr[0], c:cr[0], fruit:fruit, f:fr[0], v:vg&&vg.n}); } catch(e){ return ''; }
}
/* A plain, honest name for a meal that did not come from a template: lead protein, carb, vegetable. */
function plainMealName(opt){
  var ps=opt.parts||[], P=ps.filter(function(x){ return !x.veg && (FOOD_DB.protein||[]).some(function(f){ return f.n===x.n; }); }),
      C=ps.filter(function(x){ return !x.veg && (FOOD_DB.carb||[]).concat(FOOD_DB.fruit||[]).some(function(f){ return f.n===x.n; }); }), V=ps.filter(function(x){ return x.veg; });
  if(P[0] && /protein powder/.test(P[0].n)) return 'Protein Shake'+(C[0]?' with '+(C[0].n==='berries'?'Berries':mealNice(C[0].n)):'');
  if(P[0] && /yogurt|cottage/.test(P[0].n)) return mealNice(P[0].n)+(C[0]?' and '+(C[0].n==='berries'?'Berry':mealNice(C[0].n)):'')+' Bowl';
  if(P[0] && C.some(function(x){ return x.n==='oats'; })) return 'Oatmeal with '+mealNice(P[0].n)+' on the Side';
  var bits=[P[0]&&mealNice(P[0].n), C[0]&&mealNice(C[0].n), V[0]&&mealNice(V[0].n)].filter(Boolean);
  if(!bits.length) return '';
  return bits.length===1 ? bits[0]+' Plate' : bits.slice(0,-1).join(', ')+' and '+bits[bits.length-1]+' Plate';
}

/* ===== RECIPES (white-label library in recipe-data.js) =====
   A recipe stays the recipe. We scale the whole thing to her protein, add a side from the recipe's
   own pairing list when calories are still short, and swap an ingredient only when her eating style
   or allergies require it. A recipe that cannot land her numbers is simply not offered. */
var RECIPE_STYLE_BLOCK={vegan:'M P R F S E D', vegetarian:'M P R F S', pescatarian:'M P R', 'no red meat':'R', 'no pork':'P'};
var RECIPE_ALLERGY_TAG={dairy:'D', egg:'E', fish:'F', shellfish:'S', nut:'N', peanut:'K', gluten:'G', soy:'Y'};
var RECIPE_SEC={mf:'Meat and fish', pp:'Plant protein', ed:'Eggs and dairy', pw:'Protein powder', cg:'Carbs and grains',
                fr:'Fruit', vg:'Vegetables', fx:'Fats, nuts and extras', ps:'Pantry and spices'};
function recipeBlocked(sel){
  var b=(RECIPE_STYLE_BLOCK[String(sel.style||'').toLowerCase()]||'').split(' ').filter(Boolean);
  (sel.allergies||[]).forEach(function(a){ if(RECIPE_ALLERGY_TAG[a]) b.push(RECIPE_ALLERGY_TAG[a]); });
  return b;
}
/* The recipe's ingredients after any swaps her style or allergies require, or null if it cannot be made. */
function recipeIngredients(r, sel){
  var blocked=recipeBlocked(sel), swaps=(typeof RECIPE_SWAPS!=='undefined')?RECIPE_SWAPS:[], out=[];
  for(var i=0;i<r.ing.length;i++){
    var g=r.ing[i], name=g[2], tags=(g[3]||'').split(' ').filter(Boolean);
    var bad=tags.filter(function(t){ return blocked.indexOf(t)>=0; });
    if(bad.length){
      if(bad.length>1) return null;                                  // one swap clears one conflict
      var sw=swaps.filter(function(x){ return x.match.test(name) && x.need===bad[0]; })[0];
      if(!sw) return null;
      var left=(sw.tags||'').split(' ').filter(Boolean).concat(tags.filter(function(t){ return t!==sw.need; }));
      if(left.some(function(t){ return blocked.indexOf(t)>=0; })) return null;
      name=sw.to;
    }
    var w=recipeWeigh(g[0], g[1], name, g[4]);
    out.push([w[0], w[1], w[2], g[4], w[3]||0]);
  }
  return out;
}

/* RECIPE WEIGHTS. Recipes were written in cups, spoons and pieces; they print in ounces (meat, fish)
   and grams (everything else). Gram weights are USDA household measures. Seasonings with no real
   calories print by name only; the recipe's own macros never change. */
var RECIPE_UNIT_G={
  cup:{'brewed coffee, cooled':240,'coconut milk':226,'cottage cheese':226,'milk':244,'unsweetened almond milk':240,'unsweetened oat milk':240,'vegetable stock':240},
  tbsp:{'almond butter':16,'sunflower seed butter':16,'blueberries':9,'butter':14,'chia seeds':12,'chickpeas':10,'cilantro':1,'coconut oil':13.6,'olive oil':13.5,
        'crumbled feta':9,'dairy-free cheese':7,'dried blueberries':10,'flour':8,'gluten-free flour':8,'grated Parmesan':5,'green onion':6,'maple syrup':20,'mayonnaise':14,'mint':2,
        'nonfat Greek yogurt':17,'dairy-free Greek-style yogurt':17,'parsley':4,'peanut butter':16,'red bell pepper':9,'red onion':10,'ricotta':15,'rolled oats':5,
        'certified gluten-free oats':5,'shredded cheddar':7,'unsweetened almond milk':15,'unsweetened oat milk':15},
  tsp:{'chia seeds':4,'chives':1,'coconut oil':4.5,'olive oil':4.5,'hemp seeds':3,'maple syrup':7,'red pesto':5,'cacao nibs':2.5,'balsamic glaze':7},
  each:{'avocado':136,'banana':118,'basil leaves':0.5,'bell pepper':119,'black olives':4.4,'celery stick':40,'cherry tomatoes':17,'corn cob':90,
        'cucumber':300,'green onion':15,'kalamata olives':4,'kiwi':69,'leek':89,'onion':110,'radishes':4.5,'red bell pepper':119,'red onion':110,
        'shallot':44,'small onion':70,'small red onion':70,'sun-dried tomatoes':2,'tomato':123,'zucchini':196,'egg whites':33},
  slice:{'bacon':8,'bacon medallions':12,'turkey bacon':15,'prosciutto':14},
  scoop:30, handful:30
};
var RECIPE_EACH_OZ={'salmon fillet':6,'chicken thigh':4,'shrimp':0.35,'can tuna in water':4};
var RECIPE_EACH_RENAME={'corn cob':'corn kernels','egg whites':'liquid egg whites','chicken thigh':'chicken thigh (raw)','can tuna in water':'canned tuna'};
var RECIPE_CALORIC_PS=/maple syrup|balsamic glaze|cacao nibs|curry paste|brewed coffee|lemon juice/;
function recipeWeigh(q, u, name, sec){
  if(sec==='ps' && !RECIPE_CALORIC_PS.test(name)) return [0, 'taste', name];
  if(u==='oz') return sec==='mf' ? [q, 'oz', name] : [q*28.35, 'g', name];
  if(u==='g') return [q, 'g', name];
  if(!u){
    if(/whole eggs/.test(name)) return [q, '', name];
    if(/^lemon$|^lime$/.test(name)) return [q*(name==='lemon'?48:30), 'g', name+' juice'];
    if(RECIPE_EACH_OZ[name]) return [q*RECIPE_EACH_OZ[name], 'oz', RECIPE_EACH_RENAME[name]||name];
    var e=RECIPE_UNIT_G.each[name];
    if(e && name==='corn cob') return [q, 'ea', 'ear of corn', e];
    return e ? [q, 'ea', name, e] : [q, '', name];               // counted produce: "1/2 medium onion (55 g)" 
  }
  if(u==='slice'){ var sl=RECIPE_UNIT_G.slice[name]||15; return [q*sl, 'g', name]; }
  if(u==='scoop'||u==='handful') return [q*RECIPE_UNIT_G[u], 'g', name];
  if(u==='clove') return [q*3, 'g', name];
  var t=RECIPE_UNIT_G[u]; if(t) return [q*(t[name]||(u==='cup'?240:u==='tbsp'?15:5)), 'g', name];
  return [q, u, name];
}
var FRAC={0.25:'¼', 0.33:'⅓', 0.5:'½', 0.67:'⅔', 0.75:'¾', 0.13:'⅛'};
function fracText(q){
  var w=Math.floor(q+1e-9), r=Math.round((q-w)*100)/100, f=FRAC[r]||'';
  if(!f && r>0) return String(Math.round(q*100)/100);
  return ((w? String(w):'')+f) || '0';
}
function recipeQty(q, u, name){
  if(u==='taste') return 0;
  if(u==='ea') u='';
  if(u==='g') return q<20 ? Math.max(1, Math.round(q)) : Math.round(q/5)*5;
  if(u==='oz') return q<2 ? Math.max(0.25, Math.round(q*4)/4) : Math.round(q*2)/2;
  if(u==='cup'||u==='tsp') return Math.max(0.25, Math.round(q*4)/4);
  if(u==='tbsp'||u==='scoop'||u==='handful') return Math.max(0.5, Math.round(q*2)/2);
  if(u==='slice'||u==='clove') return Math.max(1, Math.round(q));
  if(/egg|shrimp|tomatoes|olives|radishes|basil|kiwi|chicken thigh|fillet|can tuna|green onion/.test(name)) return Math.max(1, Math.round(q));
  return Math.max(0.25, Math.round(q*4)/4);
}
var RECIPE_DESC={banana:'medium', onion:'medium', 'red onion':'medium', tomato:'medium', 'bell pepper':'medium', 'red bell pepper':'medium',
  zucchini:'medium', cucumber:'medium', leek:'medium', shallot:'medium', avocado:'', kiwi:'', 'egg whites':'large'};
function recipeLine(q, u, name, gpe){
  if(u==='taste') return name;
  if(u==='ea'){
    var wt=Math.round(q*(gpe||0)), d=RECIPE_DESC[name]!=null ? RECIPE_DESC[name] : '', nm=name;
    if(q>1 && !/s$/.test(nm)) nm = nm==='ear of corn' ? 'ears of corn' : /ch$|sh$/.test(nm) ? nm+'es' : nm+'s';
    return fracText(q)+' '+(d?d+' ':'')+nm+(wt?' ('+wt+' g)':'');
  }
  if(u==='g') return q+' g '+name;
  var t=fracText(q), many=q>1;
  if(!u && /^can /.test(name)) return t+' '+(many?'cans ':'can ')+name.slice(4);
  if(!u && !many && /eggs$/.test(name)) return t+' '+name.replace(/eggs$/,'egg');
  if(!u) return t+' '+(many && !/s$/.test(name) && !/tuna|zucchini|shrimp|celery stick$|fillet$/.test(name) ? name+'s' : name);
  var uu=u;
  if(many && (u==='cup'||u==='slice'||u==='clove'||u==='scoop')) uu=u+'s';
  if(many && u==='handful') uu='handfuls';
  return t+' '+uu+' '+name;
}
function recipeOption(r, target, sel, slot){
  var ing=recipeIngredients(r, sel); if(!ing) return null;
  var fam=proteinFamily(r.lead), mine=(sel.protein||[]).filter(function(n){ return proteinFamily(n)===fam; });
  if(mine.length && /ground beef|steak|chicken|turkey/.test(fam) && mine.indexOf(r.lead)<0){
    /* She picked a different cut from the same family (96% ground beef for a lean ground beef recipe):
       name her cut. The macro difference between cuts in one family is small. */
    ing=ing.map(function(g){ return (g[3]==='mf' && proteinFamily(g[2])===fam && !/bacon|prosciutto/.test(g[2])) ? [g[0], g[1], mine[0], g[3]] : g; });
  }
  var tCal=target.protein*4+target.carbs*4+target.fat*9, tP=target.protein;
  var s=tP/r.m[1];
  if(r.m[0]*s > tCal*1.08) s=Math.max(s*0.95, tCal*1.06/r.m[0]);   // a rich recipe gives a little protein back
  s=Math.max(0.75, Math.min(3, s));
  var tot={kcal:r.m[0]*s, p:r.m[1]*s, c:r.m[2]*s, f:r.m[3]*s};
  var items=[], parts=[];
  ing.forEach(function(g){
    var sc=(g[3]==='ps') ? Math.min(s, 1.5) : s;
    var q=recipeQty(g[0]*sc, g[1], g[2]);
    if(g[1]!=='taste') items.push(recipeLine(q, g[1], g[2], g[4]));
    parts.push({n:g[2], units:q, u:g[1], gpe:g[4]||0, whole:!g[1]||g[1]==='ea', sec:RECIPE_SEC[g[3]]||'Fats, nuts and extras', recipe:r.id});
  });
  var gap=tCal-tot.kcal;
  if(gap > tCal*0.05 && r.sides && r.sides.length){
    var carbs=safeFoods('carb', sel.style, sel.allergies), picks=sel.carb||[];
    var sides=r.sides.map(function(n){ return carbs.filter(function(f){ return f.n===n; })[0]; }).filter(Boolean)
      .sort(function(a,b){ return (picks.indexOf(a.n)>=0?0:1)-(picks.indexOf(b.n)>=0?0:1); });
    var sf=sides[0];
    if(sf){
      var mm=macrosOf(sf, Math.min(sf.max||2, gap/sf.kcal));
      if(mm.units < minPortion(sf)) mm=macrosOf(sf, minPortion(sf));
      if(tot.kcal+mm.kcal <= tCal*1.10){
        tot.kcal+=mm.kcal; tot.p+=mm.p; tot.c+=mm.c; tot.f+=mm.f;
        items.push('on the side: '+fmtQty(sf, null, mm.units));
        parts.push({n:sf.n, units:mm.units, u:sf.u||'', whole:!!sf.whole, side:true});
      }
    }
  }
  if(tot.p < tP*0.95 || Math.abs(tot.kcal-tCal) > tCal*0.10) return null;
  return {items:items, parts:parts, cal:Math.round(tot.kcal), protein:Math.round(tot.p), carbs:Math.round(tot.c), fat:Math.round(tot.f),
          name:r.name, tier:1, recipe:{id:r.id, how:r.how, scale:Math.round(s*100)/100}};
}
/* Protein families, so a recipe built on "lean ground beef" counts for someone who picked 96% ground
   beef, and a sirloin recipe counts for someone who picked flank steak. */
var PROTEIN_FAMILY=[
  ['ground beef', /ground beef|lean ground beef/],
  ['steak', /steak|sirloin|filet|ribeye|eye of round/],
  ['chicken', /chicken/],
  ['turkey', /turkey/],
  ['white fish', /white fish|cod|tilapia|halibut/],
  ['salmon', /salmon/], ['tuna', /tuna/], ['shrimp', /shrimp/], ['pork', /pork/],
  ['yogurt', /greek yogurt|yogurt/], ['cottage cheese', /cottage/], ['eggs', /egg/],
  ['protein powder', /protein powder/], ['tofu', /tofu/], ['bison', /bison/]
];
function proteinFamily(n){ n=String(n||'').toLowerCase(); for(var i=0;i<PROTEIN_FAMILY.length;i++){ if(PROTEIN_FAMILY[i][1].test(n)) return PROTEIN_FAMILY[i][0]; } return n; }
/* Order the recipes for a slot: her starred and picked lead proteins first, then a rotation. */
function recipeCandidates(slotKind, sel, k, used, slotName){
  if(typeof RECIPE_LIBRARY==='undefined') return [];
  var star=(sel.starred||{}).protein||[], picks=sel.protein||[];
  var fams=picks.map(proteinFamily);
  return RECIPE_LIBRARY.map(function(r, i){ return {r:r, i:i}; })
    .filter(function(x){ return x.r.slot===slotKind; })
    .filter(function(x){ return !picks.length || fams.indexOf(proteinFamily(x.r.lead))>=0; })   // only proteins she eats
    .map(function(x){
      var pref=star.some(function(n){ return proteinFamily(n)===proteinFamily(x.r.lead); }) ? 0 : 1;
      /* Dinner should read like dinner: a cooked meal beats a cold salad at the end of the day. */
      var heat=(slotName==='Dinner') ? (x.r.hot?0:40) : (slotName==='Lunch' && x.r.hot ? 8 : 0);
      return {r:x.r, score:pref*100 + heat + (used[x.r.id]?50:0) + ((x.i*7 + k*11) % 37)};
    }).sort(function(a,b){ return a.score-b.score; }).map(function(x){ return x.r; });
}

/* PROTEIN BOOSTERS: a short list of real, obvious snacks, each a fixed portion of sourced foods.
   Filtered by eating style and allergies, her own foods first. (Replaces the generated companions,
   which could produce "2.2 oz chicken" as a snack.) */
var PROTEIN_BOOSTERS=[                                   // every one is no-cook: grab, open, combine
  {name:'Greek Yogurt and Berries', parts:[['nonfat Greek yogurt',1],['berries',0.5]]},
  {name:'Turkey and Cheese Roll-Ups', parts:[['deli turkey',3],['cheese',1]]},
  {name:'Protein Shake and a Banana', parts:[['whey protein powder',1],['banana',1]]},
  {name:'Cottage Cheese and Pineapple', parts:[['low-fat cottage cheese',0.75],['pineapple',0.5]]},
  {name:'Beef Jerky and an Apple', parts:[['beef jerky',1.5],['apple',1]]},
  {name:'Tuna and Hummus Cup', parts:[['canned tuna',4],['hummus',2]]},
  {name:'Greek Yogurt and Granola', parts:[['2% Greek yogurt',0.75],['granola',0.25]]},
  {name:'Turkey and Rice Cakes', parts:[['deli turkey',3],['rice cakes',2]]},
  {name:'Plant Protein Shake and a Banana', parts:[['plant protein powder',1],['banana',1]]},
  {name:'Store-Bought Hard-Boiled Eggs', parts:[['whole eggs',3]]}
];
function foodByName(n){ var h=(typeof swapFind==='function')?swapFind(n):null; return h?h.food:null; }

/* ===== EATING-STYLE + ALLERGY FILTERING =====
   style is a lowercase string like "vegan" / "vegetarian" / "pescatarian" / "no red meat".
   Vegetarian leans on DAIRY + EGGS. Vegan has to lean on tofu, tempeh, seitan, edamame and
   plant protein. Pescatarian leans on FISH + EGGS. That is handled by `k` here, not by copy. */
var STYLE_KINDS={
  vegan:        ["plant"],
  vegetarian:   ["plant","dairy","egg"],
  pescatarian:  ["plant","dairy","egg","fish","shellfish"]
};
function allowsFood(f, style, allergies){
  var kinds=STYLE_KINDS[String(style||'').toLowerCase()];
  if(kinds && kinds.indexOf(f.k||'plant')<0) return false;
  var s=String(style||'').toLowerCase();
  if(s==='no red meat' && f.sub==='redmeat') return false;
  if(s==='no pork'     && f.sub==='pork')    return false;
  var al=allergies||[];
  for(var i=0;i<(f.a||[]).length;i++){ if(al.indexOf(f.a[i])>=0) return false; }
  return true;
}
/* The safe list for one macro category. Never returns empty: if the filters wipe everything out,
   it hands back the plant-only foods so the caller shows food rather than a blank plan. */
function safeFoods(cat, style, allergies){
  var base=(cat==='carb') ? (FOOD_DB.carb||[]).concat(FOOD_DB.fruit||[]) : (FOOD_DB[cat]||[]);   // fruit is picked separately, eaten as a carb
  var list=base.filter(function(f){ return allowsFood(f, style, allergies); });
  if(list.length) return list;
  return base.filter(function(f){ return (f.k||'plant')==='plant'; });
}

/* Units that never take an "s" (abbreviations), and pluralising only the FIRST word so
   "cup dry" becomes "cups dry", never "cup drys". */
var NO_PLURAL={oz:1,tbsp:1,tsp:1,g:1,ml:1};
function pluralUnit(u, q){
  if(!u) return '';
  if(q===1) return u;
  var parts=String(u).split(' ');
  if(NO_PLURAL[parts[0]]) return u;
  parts[0]=parts[0]+'s';
  return parts.join(' ');
}

/* How many units of this food it takes to hit targetG (unrounded). */
function unitsFor(f, targetG){ var u=targetG/f.g; return isFinite(u)?u:0; }

/* The unit count fmtQty will actually PRINT. Macros are computed from this, never from the raw
   figure, so the numbers on the card describe the portion the member is actually served. */
function displayUnits(f, units){
  if(!isFinite(units)||units<=0.1) units=0.5;
  /* Round DOWN to the nearest measurable step. Rounding to nearest biases every food upward, and
     across three macros and three meals that compounded into a day 10-15% over target. Under is
     the safer direction: the uncounted produce sits on top of this anyway. */
  /* Whole items (scoops, eggs, bananas) round down unless they are at least three-quarters of the way
     to the next one. Pure floor turned 1.9 scoops of protein into 1 and left vegan breakfasts ~35% short. */
  if(f.whole) return Math.max(1, Math.floor(units+0.25+1e-9));
  if(f.u==="g") return units<20 ? Math.max(1, Math.round(units)) : Math.round(units/5)*5;   // grams: to the gram when small, else to 5
  if(f.u==="oz") return Math.max(0.5, Math.floor(units*10+1e-9)/10);
  return Math.max(0.25, Math.floor(units*4+1e-9)/4);
}
/* The smallest portion that reads as real food. A meal never lists "0.5 oz chicken" or "0.25 tbsp
   seeds": a fragment like that is rounding noise, not a portion anyone plates (Jayme, 2026-09-16). */
function minPortion(f){
  var u=f.u||'';
  if(u==='g'){
    if(f.cat==='fat') return /oil|butter/.test(f.n) ? 5 : 10;
    if(/protein powder/.test(f.n)) return 25;
    if(f.cat==='protein') return 100;                              // yogurt, cottage cheese, egg whites
    if(f.cat==='fruit') return 50;
    return 40;                                                     // carbs
  }
  if(u==='oz') return (f.n==='cheese') ? 1 : 3;
  if(u==='cup') return 0.5;
  if(u==='cup dry') return 0.25;
  if(u==='tbsp') return 1;
  if(u==='scoop' || u==='serving' || u==='slice') return 1;
  if(u==='tortilla') return 2;
  if(f.whole) return /egg whites/.test(f.n) ? 3 : (/eggs/.test(f.n) ? 2 : 1);
  return 0.25;                                                   // avocado and other part-of-a-whole foods
}
/* Real macros for a served portion. This is why calories stopped being an estimate. */
function macrosOf(f, units){
  var u=displayUnits(f, units);
  return {kcal:u*(f.kcal||0), p:u*(f.p||0), c:u*(f.c||0), f:u*(f.f||0), units:u};
}

/* Render a quantity of ONE food. Pass an explicit unit count to override the target-derived one. */
function fmtQty(f, targetG, unitsOverride){
  /* Uses displayUnits, the same rounding the macros are counted from. Before this, the card could
     print "2 bananas" while the calories were counted for 1.5. The printed portion and the counted
     portion must be the same number or the card is lying. */
  var units=(unitsOverride!=null)?unitsOverride:unitsFor(f,targetG);
  var q=displayUnits(f, units);
  if(f.desc!=null && f.gpu){                                   // "1 medium banana (118 g)"
    var wt=Math.round(q*f.gpu);
    if(f.n==='grapefruit') return fracText(q/2)+' grapefruit ('+wt+' g)';
    if(f.n==='raisins') return fracText(q)+' mini box'+(q>1?'es':'')+' of raisins ('+wt+' g)';
    var unitWord = f.u && !/^(half|box)$/.test(f.u) && f.n.toLowerCase().indexOf(f.u)<0 ? ' '+pluralUnit(f.u,q) : '';
    var nm = f.n; if(q>1 && !unitWord && !/s$/.test(nm)) nm = /ch$|sh$/.test(nm) ? nm+'es' : nm+'s';
    return fracText(q)+unitWord+' '+(f.desc ? f.desc+' ' : '')+nm+' ('+wt+' g)';
  }  if(f.whole){
    if(f.u && f.n.toLowerCase().indexOf(f.u.toLowerCase())>=0) return q+' '+(q!==1?f.n+'s':f.n);   // "2 corn tortillas", never "2 tortillas corn tortilla"
    if(f.u) return q+' '+pluralUnit(f.u,q)+' '+f.n;
    return q+' '+((q!==1 && !/s$/i.test(f.n)) ? f.n+'s' : f.n);   // "2 bananas", never "2 whole eggss"
  }
  if(f.u==="oz"){ return q+' oz '+f.n; }
  if(f.u==="g"){ return q+' g '+f.n; }

  return f.u? (q+' '+pluralUnit(f.u,q)+' '+f.n) : (q+' '+f.n);
}

/* Fill a macro target from the client's chosen foods for this meal slot, using up to TWO foods
   so no single food is pushed past a portion a real person would put on a plate.
   Returns { items:[strings], hit:gramsActuallyCovered }. */
function fillMacro(cands, targetG, slot, seed, tierMax, starred, chosen, capScale){
  /* capScale lets a big meal carry bigger portions. A food's max is sized for a normal ~550 kcal
     meal; on "2 meals + a shake" a dinner can be double that, and fixed caps left it short on fat. */
  var cs=(capScale && capScale>1) ? capScale : 1;
  /* The empty return MUST carry zeroed macros. Callers sum .kcal/.p/.c/.f, and an early return
     without them made a meal total NaN whenever its carbs already covered its protein. */
  if(!cands.length || targetG<=0) return {items:[], parts:[], hit:0, short:0, kcal:0, p:0, c:0, f:0};
  var fit=cands.filter(function(f){ return f.slot==='any' || f.slot===slot; });
  if(!fit.length) fit=cands;                                   // they only picked off-slot foods; honour their picks
  /* POWER FOOD SYSTEM RULE: build the plan on TIER 1. Step out to tier 2, then 3, only when
     the member's own picks leave nothing leaner. Teaching them to swap up the tiers and adjust
     their portions for it is what the free Power Food System is FOR.
     tierMax lets a caller deliberately open the ladder (used to get DISTINCT options when the
     tier-1 pool is too thin to produce three different meals). */
  /* A STARRED food is an explicit choice and beats the tier default. If she starred salmon,
     salmon is in her plan; the tier badge is what teaches her the trade. The tier ladder is the
     default for everything she did NOT choose. */
  var isStar=function(f){ return (starred||[]).indexOf(f.n)>=0; };
  var stars=fit.filter(isStar);
  if(tierMax){
    var capped=fit.filter(function(f){ return (f.t||1)<=tierMax || isStar(f); });
    if(capped.length) fit=capped;
  } else {
    var lean=fit.filter(function(f){ return (f.t||1)===1 || isStar(f); });
    if(!lean.length) lean=fit.filter(function(f){ return (f.t||1)<=2 || isStar(f); });
    if(lean.length) fit=lean;
  }
  /* STEP UP A TIER ONLY WHEN THE LEANER FOODS CANNOT PHYSICALLY GET THERE. The Power Food System rule
     is "tier 1 first, then tier 2 when nothing leaner does the job". Measured by capacity: if the
     tier-limited foods at their portion caps cannot reach 90% of the target, open the next tier.
     This is what lets a vegan breakfast reach its protein with tofu instead of stalling at 2 scoops. */
  var capOf=function(list){ return list.slice().map(function(x){ return (x.max||99)*cs*x.g; })
      .sort(function(a,b){return b-a;}).slice(0,4).reduce(function(a,b){return a+b;},0); };
  if(capOf(fit) < targetG*0.9){
    var wider=cands.filter(function(x){ return (x.slot==='any'||x.slot===slot) && fit.indexOf(x)<0; })
                   .sort(function(a,b){ return (a.t||1)-(b.t||1); });
    for(var wi=0; wi<wider.length && capOf(fit) < targetG*0.9; wi++) fit.push(wider[wi]);
  }
  if(stars.length){                                            // never let the tier pass drop a star
    stars.forEach(function(f){ if(fit.indexOf(f)<0) fit.push(f); });
  }
  /* Rank by how much of the target a food can carry WITHOUT exceeding its own portion cap,
     then rotate the starting point by seed so days do not all look identical. */
  /* STARRED FAVOURITES come first. A member stars their top three per category (the ★ TOP
     mechanic from the original Power Food System sheet); those are the foods they actually
     reach for, so the plan is built from them before anything else. */
  var starOf=function(f){ var i=(starred||[]).indexOf(f.n); return i<0?99:i; };
  /* Priority: STARRED first, then anything the member actually CHOSE, then the foods we had to
     add to make the slot work. A top-up must never outrank her own pick. */
  var mine=function(f){ return (!chosen||!chosen.length||chosen.indexOf(f.n)>=0) ? 0 : 1; };
  var ranked=fit.slice().sort(function(a,b){
    var sa=starOf(a), sb=starOf(b);
    if(sa!==sb) return sa-sb;                                  // starred first, in the order starred
    var ma=mine(a), mb=mine(b);
    if(ma!==mb) return ma-mb;                                  // then her own picks, then the fills
    var ca=Math.min(unitsFor(a,targetG),(a.max||99)*cs)*a.g, cb=Math.min(unitsFor(b,targetG),(b.max||99)*cs)*b.g;
    return cb-ca;                                              // then biggest single-food coverage
  });
  var start=seed % ranked.length;
  var order=ranked.slice(start).concat(ranked.slice(0, start));

  /* CHAIN foods until the target is actually met. A single capped food cannot carry a 60g
     protein meal (which is exactly what "2 meals + a shake" asks for), so stopping at one or
     two foods silently under-feeds the day. Cap at three so a meal stays a meal. */
  var picks=[], covered=0, used=0;
  for(var i=0; i<order.length && used<4 && covered < targetG*0.96; i++){
    var f=order[i], need=targetG-covered;
    var du=displayUnits(f, Math.min(unitsFor(f, need), (f.max||99)*cs));
    var adds=du*f.g;
    if(adds <= 0) continue;
    if(used>0 && adds < targetG*0.14) continue;                // too small to be worth listing
    picks.push({f:f, u:du}); covered+=adds; used++;
  }
  if(!picks.length){                                           // nothing cleared the bar: take the best one
    var f0=order[0];
    var du0=displayUnits(f0, Math.min(unitsFor(f0, targetG), (f0.max||99)*cs));
    picks.push({f:f0, u:du0}); covered=du0*f0.g;
  }
  /* REAL PORTIONS ONLY. A second food below its minimum folds into the lead food when the lead has
     room; otherwise it is raised to a real portion. A lead food below its minimum is raised too. */
  for(var q=picks.length-1; q>=1; q--){
    var sm=picks[q], mn=minPortion(sm.f);
    if(sm.u >= mn-1e-9) continue;
    var lead=picks[0], room=(lead.f.max||99)*cs - lead.u, add=sm.u*sm.f.g/lead.f.g;
    if(add <= room+1e-9){ lead.u=displayUnits(lead.f, lead.u+add); picks.splice(q,1); }
    else sm.u=mn;
  }
  if(picks[0].u < minPortion(picks[0].f)-1e-9) picks[0].u=minPortion(picks[0].f);
  covered=picks.reduce(function(a,pk){ return a+pk.u*pk.f.g; }, 0);
  /* SHORT BY A WHOLE UNIT. When the only food left comes in whole units (a scoop, an egg), rounding
     can leave the target well short with nothing else to add: 1.7 scoops of protein became 1 and
     vegan breakfasts landed ~35% under. If one more unit lands closer to the target, add it. */
  if(covered < targetG*0.9){
    for(var j=picks.length-1; j>=0; j--){
      var pk=picks[j];
      if(!pk.f.whole || pk.u+1 > (pk.f.max||99)*cs) continue;
      /* On a tie, round up: for protein, a few grams over beats a few grams under. */
      if(Math.abs(targetG-(covered+pk.f.g)) <= Math.abs(targetG-covered)){ pk.u+=1; covered+=pk.f.g; }
      break;
    }
  }
  /* STILL MORE THAN 10% SHORT? The leaner tier is too coarse to land (a 22g scoop cannot make 30g),
     so retry one tier up and keep whichever lands closer. Tier 1 still wins whenever it gets there. */
  var curTier=tierMax||1;
  if(covered < targetG*0.9 && curTier < 3){
    var wide=fillMacro(cands, targetG, slot, seed, curTier+1, starred, chosen, capScale);
    if(Math.abs(targetG - wide.hit) < Math.abs(targetG - covered)) return wide;
  }
  var items=[], parts=[], tot={kcal:0,p:0,c:0,f:0};
  picks.forEach(function(pk){
    var m=macrosOf(pk.f, pk.u);
    tot.kcal+=m.kcal; tot.p+=m.p; tot.c+=m.c; tot.f+=m.f;
    items.push(fmtQty(pk.f, null, pk.u));
    parts.push({n:pk.f.n, units:m.units, u:pk.f.u||'', whole:!!pk.f.whole});   // structured, for shopping + prep
  });
  /* `short` lets a caller say "your food list cannot reach this target" instead of hiding it. */
  return {items:items, parts:parts, hit:Math.round(covered), short:Math.max(0, Math.round(targetG-covered)),
          kcal:Math.round(tot.kcal), p:Math.round(tot.p), c:Math.round(tot.c), f:Math.round(tot.f)};
}

/* Build a meal plan from a client's targets (it.pfs) + selected foods.
   it = {pfs:{calories,protein,carbs,fat}}; sel = {protein:[],carb:[],fat:[],veg:[]}; name = client's name.
   Protein is spread near-evenly (the floor matters every meal); calories/carbs/fat weight toward
   the back of the day, the way people actually eat. */
var MEAL_SPLIT=[
  [{pro:.34,e:.28}],                                            // 1 meal (shouldn't happen, kept safe)
  [{pro:.45,e:.42},{pro:.55,e:.58}],
  [{pro:.33,e:.28},{pro:.33,e:.34},{pro:.34,e:.38}],
  [{pro:.27,e:.24},{pro:.25,e:.26},{pro:.30,e:.34},{pro:.18,e:.16}],
  [{pro:.22,e:.20},{pro:.20,e:.21},{pro:.26,e:.29},{pro:.16,e:.15},{pro:.16,e:.15}]
];
/* Fruit is its own pick list (sel.fruit) but it is eaten as a carb, so the builders see one carb list. */
function withFruit(sel){
  sel=sel||{};
  if(!sel.fruit || !sel.fruit.length) return sel;
  var out={}; for(var k in sel) out[k]=sel[k];
  out.carb=(sel.carb||[]).concat(sel.fruit.filter(function(n){ return (sel.carb||[]).indexOf(n)<0; }));
  if(sel.starred && sel.starred.fruit){ out.starred={}; for(var k2 in sel.starred) out.starred[k2]=sel.starred[k2];
    out.starred.carb=(sel.starred.carb||[]).concat(sel.starred.fruit); }
  return out;
}
function generateMealPlan(it, sel, days, name){
  sel=withFruit(sel);
  var p=it.pfs;
  sel=sel||{};
  /* Frequency drives how many meals get built and whether a shake is carved out first.
     sel.frequency is one of FREQUENCY_ORDER; sel.shakeGrams defaults to 30. */
  var S=mealSplit(p, sel.frequency, sel.shakeGrams);
  var m=S.meals;
  /* The meals are built from what is LEFT after the shake, so 2 + shake gives two real meals. */
  p={calories:Math.max(0,p.calories-(S.shake?S.shake.calories:0)),
     protein: Math.max(0,p.protein -(S.shake?S.shake.protein :0)),
     carbs:p.carbs, fat:p.fat};
  /* sel.style / sel.allergies are optional. When present they hard-filter BEFORE the member's
     own picks, so an allergen can never survive into a plan. */
  function pick(cat, names){
    var pool=safeFoods(cat, sel.style, sel.allergies);
    var list=pool.filter(function(f){return !names||!names.length||names.indexOf(f.n)>=0;});
    return list.length?list:pool;
  }
  var P=pick('protein',sel.protein), C=pick('carb',sel.carb), F=pick('fat',sel.fat);
  var V=(sel.veg&&sel.veg.length)?sel.veg:FOOD_DB.veg;
  var names=S.names;
  var split=MEAL_SPLIT[Math.min(m,5)-1]||MEAL_SPLIT[2];
  var out=[];
  for(var d=0;d<days;d++){
    var meals=[];
    for(var k=0;k<m;k++){
      var s=split[k]||split[split.length-1];
      /* Slot follows the MEAL NAME, not the index. On "2 + shake" the first meal is Lunch, so
         index 0 is not automatically breakfast and must not be fed breakfast food. */
      var slot=(names[k]==='Breakfast')?'am':'pm';
      var seed=d+k;
      var target={protein:Math.round(p.protein*s.pro), carbs:Math.round(p.carbs*s.e), fat:Math.round(p.fat*s.e)};
      /* Same meal builder as the /build deck (buildOption), so the dashboard's "Build my meal plan"
         gets the same accuracy fixes instead of a second, older copy of the fill logic. */
      var o=buildOption(P, C, F, V, target, slot, seed, d*m+k, null,
                        sel.starred||{}, {protein:sel.protein, carb:sel.carb, fat:sel.fat});
      meals.push({name:names[k]||("Meal "+(k+1)), items:o.items,
        cal:o.cal, protein:o.protein, carbs:o.carbs, fat:o.fat});
    }
    /* The shake is its own slot, always last, so its protein is never double-counted. */
    if(S.shake) meals.push({name:"Protein shake", shake:true,
      items:[S.shake.protein+"g protein shake"],
      cal:S.shake.calories, protein:S.shake.protein, carbs:0, fat:0});
    out.push({day:d+1,label:"Day "+(d+1),meals:meals});
  }
  var nm=name?(String(name).split(' ')[0]+"'s"):"Your";
  return {title:nm+" meal plan", frequency:S.frequency, label:S.label,
    note:"Built from your favorites. Swap any food and regenerate anytime.", days:out};
}

/* ═══════════════════════════════════════════════════════════════════════════
   OPTIONS PER SLOT — the delivered meal plan (LOCKED 2026-09-01)
   Replaces "14 prescribed days". A member gets a SEVEN-DAY plan built from a
   small deck of interchangeable options: 3 breakfasts, 3 lunches, 3 dinners,
   plus 3 companions. Every option inside a slot is built to the SAME per-meal
   target, which is what makes them swappable without doing any maths.
   Fewer decisions, less repetition, and "build new meal plan" deals a fresh deck.
   ═══════════════════════════════════════════════════════════════════════════ */
var PLAN_DAYS=7;                 // the plan covers a week
var OPTIONS_PER_SLOT=3;          // 3 interchangeable options in every meal slot
var COMPANIONS_PER_PLAN=3;       // snacks + protein boosters

/* Build one option to a given macro target. slot = am|pm, seed rotates the food choice. */
function buildOption(P, C, F, V, target, slot, seed, vegIndex, tierMax, star, chose){
  star=star||{}; chose=chose||{};
  /* SEQUENTIAL FILL, crediting what has already been delivered. Protein foods carry fat, carb
     foods carry protein. Filling each macro independently double-counts the day and was the
     reason a "1,950 calorie" plan actually came to 2,600. Protein goes first because protein is
     the anchor; carbs and fat then only make up what is genuinely still missing. */
  /* FILL ORDER: carbs, then fat, then PROTEIN LAST. Protein is the anchor and has to land exact,
     so it goes last and absorbs whatever the carb and fat foods already contributed. Oats carry
     10g of protein a cup; filling protein first and carbs second put that 10g on top of a target
     that was already met. Display order is still protein-first, because that is how you plate. */
  var EMPTY={items:[], hit:0, kcal:0, p:0, c:0, f:0};
  var rCarb=EMPTY, rFat=EMPTY, rPro=EMPTY;
  /* Every food carries all three macros, so the three fills depend on each other. Iterate to a
     fixed point: three passes is enough to converge and it costs nothing. Protein resolves LAST
     inside each pass because protein is the anchor and has to land exact. */
  /* Each pass is a complete meal. Passes do not always settle (swapping one food changes what the
     others need), so the LAST pass is not necessarily the most accurate one. Score every pass and
     keep the best: calorie distance from the meal target, with protein under 95% of its target
     treated as the worst miss, because protein is the anchor. */
  var tCal=target.protein*4 + target.carbs*4 + target.fat*9;
  var capScale=Math.min(1.6, Math.max(1, tCal/700));
  /* Beans, lentils, chickpeas and peas count twice: as the carb AND as a big share of the protein.
     With a real protein serving on the plate as well, that pushed protein past 120% of target.
     So each meal is also tried with only the lower-protein carbs (potatoes, rice, oats, fruit), and
     the scoring below keeps whichever version lands closest. Her beans still show up in the
     options where they fit; they just stop doubling the protein. */
  var pools=[C];
  var lowP=C.filter(function(f){ return !((f.p||0) >= 0.3*Math.max(1, f.c||0)); });
  if(lowP.length && lowP.length < C.length) pools.push(lowP);
  var best=null;
  for(var pi=0; pi<pools.length; pi++){
    var CC=pools[pi];
    rCarb=EMPTY; rFat=EMPTY; rPro=EMPTY;
    /* Each pass is a complete meal. Passes do not always settle (swapping one food changes what the
       others need), so the LAST pass is not necessarily the most accurate one. Score every pass and
       keep the best: calorie distance from the meal target, with protein under 95% of its target
       treated as the worst miss (protein is the anchor) and protein well over target also penalised. */
    for(var pass=0; pass<6; pass++){
      /* Credit carbs from BOTH other fills. Fat foods carry real carbs (a whole avocado is 13g, chia
         5g a tablespoon) and leaving rFat.c out put carbs over target in 94% of meals. */
      var carbNeed=Math.max(0, target.carbs - rPro.c - rFat.c);
      rCarb=fillMacro(CC, carbNeed, slot, seed, tierMax, star.carb, chose.carb, capScale);
      var fatNeed=Math.max(0, target.fat - rPro.f - rCarb.f);
      /* If the meal already carries its fat, do not bolt oil onto it just to fill a line. */
      rFat=(fatNeed >= Math.max(3, target.fat*0.15))
        ? fillMacro(F, fatNeed, slot, seed+1, tierMax, star.fat, chose.fat, capScale) : EMPTY;
      /* PROTEIN ANCHOR FLOOR. Crediting all the protein in beans shrank the actual protein food to a
         garnish ("0.7 oz ground turkey") in a third of meals. The protein food always carries at
         least half the meal's protein target, so every plate still starts with protein. */
      var proNeed=Math.max(target.protein*0.5, target.protein - rCarb.p - rFat.p);
      rPro=fillMacro(P, proNeed, slot, seed, tierMax, star.protein, chose.protein, capScale);
      if(pass>0){
        var cal=rPro.kcal+rCarb.kcal+rFat.kcal, pro=rPro.p+rCarb.p+rFat.p;
        var pr=pro/Math.max(1,target.protein);
        var score=Math.abs(cal-tCal)/Math.max(1,tCal)
                + 3*Math.max(0, 0.95 - pr)
                + 1*Math.max(0, pr - 1.10);
        if(!best || score < best.score - 1e-9) best={score:score, rPro:rPro, rCarb:rCarb, rFat:rFat};
      }
    }
  }
  rPro=best.rPro; rCarb=best.rCarb; rFat=best.rFat;
  var items=rPro.items.concat(rCarb.items, rFat.items);
  var parts=(rPro.parts||[]).concat(rCarb.parts||[], rFat.parts||[]);
  if(V && V.length){
    var vn=V[vegIndex%V.length], vc=(slot==='am'?1:1.5), vg=vegGrams(vn, vc);
    items.push(vg+' g '+vn);
    parts.push({n:vn, veg:true, cups:vc, grams:vg});
  }
  /* Calories are now SUMMED FROM REAL PER-FOOD VALUES, not inferred as 4/4/9 from the anchor
     macros. Protein foods carry fat, carb foods carry protein, and that is now counted. */
  return {items:items, parts:parts,
          cal:rPro.kcal+rCarb.kcal+rFat.kcal,
          protein:rPro.p+rCarb.p+rFat.p,
          carbs:rPro.c+rCarb.c+rFat.c,
          fat:rPro.f+rCarb.f+rFat.f,
          anchor:{protein:rPro.hit, carbs:rCarb.hit, fat:rFat.hit}};
}

/* SNACKS & PROTEIN BOOSTERS.
   Deliberately protein-forward and small. These are not extra calories bolted on top of the
   target — they are how a member closes a protein gap on a day that came up short, or trades
   part of a meal for something portable. That is the honest job they do. */
var COMPANION_PROTEIN=20;        // grams, the useful size of a protein top-up
function generateCompanions(sel, count, name){
  sel=withFruit(sel||{});
  var want=count||COMPANIONS_PER_PLAN, mine=[].concat(sel.protein||[], sel.carb||[], sel.fat||[]);
  var boost=PROTEIN_BOOSTERS.map(function(b, idx){
    var foods=b.parts.map(function(pt){ var f=foodByName(pt[0]); return {f:f, u:pt[1]*((f&&f.gpu)||1)}; });   // booster portions are written in the old serving units
    if(foods.some(function(x){ return !x.f || !allowsFood(x.f, sel.style, sel.allergies); })) return null;
    var score=idx - 5*foods.filter(function(x){ return mine.indexOf(x.f.n)>=0; }).length;
    return {b:b, foods:foods, score:score};
  }).filter(Boolean).sort(function(a,b){ return a.score-b.score; }).slice(0, want);
  var recipeSnacks=(typeof RECIPE_LIBRARY==='undefined'?[]:RECIPE_LIBRARY).filter(function(r){ return r.slot==='snack'; }).map(function(r){
    var ing=recipeIngredients(r, sel); if(!ing) return null;
    return {name:r.name, items:ing.filter(function(g){ return g[1]!=='taste'; }).map(function(g){ return recipeLine(recipeQty(g[0], g[1], g[2]), g[1], g[2], g[4]); }),
            parts:ing.map(function(g){ return {n:g[2], units:recipeQty(g[0], g[1], g[2]), u:g[1], gpe:g[4]||0, whole:!g[1]||g[1]==='ea', sec:RECIPE_SEC[g[3]]||'Fats, nuts and extras', recipe:r.id}; }),
            cal:r.m[0], protein:r.m[1], carbs:r.m[2], fat:r.m[3], recipe:{id:r.id, how:r.how, scale:1}};
  }).filter(Boolean);
  if(recipeSnacks.length + boost.length >= Math.min(2, want)){
    var mixed=[];
    for(var mi=0; mixed.length<want && mi<Math.max(recipeSnacks.length, boost.length); mi++){
      if(recipeSnacks[mi] && mixed.length<want) mixed.push(recipeSnacks[mi]);
      if(boost[mi] && mixed.length<want) mixed.push(boost[mi]);
    }
    return mixed.map(function(x){
      if(x.recipe) return x;
      var t={kcal:0,p:0,c:0,f:0}, items=[], parts=[];
      x.foods.forEach(function(fd){ var m=macrosOf(fd.f, fd.u); t.kcal+=m.kcal; t.p+=m.p; t.c+=m.c; t.f+=m.f;
        items.push(fmtQty(fd.f, null, fd.u)); parts.push({n:fd.f.n, units:m.units, u:fd.f.u||'', whole:!!fd.f.whole}); });
      return {name:x.b.name, items:items, parts:parts, cal:Math.round(t.kcal), protein:Math.round(t.p), carbs:Math.round(t.c), fat:Math.round(t.f)};
    });
  }
  var P=safeFoods('protein', sel.style, sel.allergies),
      C=safeFoods('carb',    sel.style, sel.allergies),
      F=safeFoods('fat',     sel.style, sel.allergies);
  function narrow(pool, picks){ var l=pool.filter(function(f){return !picks||!picks.length||picks.indexOf(f.n)>=0;}); return l.length?l:pool; }
  P=narrow(P, sel.protein); C=narrow(C, sel.carb); F=narrow(F, sel.fat);
  var out=[];
  var star=sel.starred||{};
  for(var i=0;i<(count||COMPANIONS_PER_PLAN);i++){
    var rPro=fillMacro(P, COMPANION_PROTEIN, 'any', i, null, star.protein);
    /* Alternate what rides along: a light carb, then a light fat, then protein on its own. */
    var extra={items:[],hit:0}, kind=i%3;
    if(kind===0) extra=fillMacro(C, 20, 'am', i, null, star.carb);
    else if(kind===1) extra=fillMacro(F, 6, 'any', i, null, star.fat);
    var items=rPro.items.concat(extra.items);
    var carbs=(kind===0)?extra.hit:0, fat=(kind===1)?extra.hit:0;
    out.push({name:(kind===2?'Protein booster':'Snack')+' '+(i+1),
              items:items, parts:(rPro.parts||[]).concat(extra.parts||[]), cal:rPro.kcal+(extra.kcal||0),
              protein:rPro.p+(extra.p||0), carbs:rPro.c+(extra.c||0), fat:rPro.f+(extra.f||0)});
  }
  return out;
}

/* THE deliverable. Returns a 7-day plan expressed as a deck of options.
   it = {pfs:{calories,protein,carbs,fat}}
   sel = {protein:[],carb:[],fat:[],veg:[], style, allergies, frequency, shakeGrams} */
function generateMealOptions(it, sel, name){
  var p=it.pfs; sel=withFruit(sel||{});
  var S=mealSplit(p, sel.frequency, sel.shakeGrams);
  /* Meals are built from what is LEFT after the shake is reserved. */
  var base={calories:Math.max(0,p.calories-(S.shake?S.shake.calories:0)),
            protein: Math.max(0,p.protein -(S.shake?S.shake.protein :0)),
            carbs:p.carbs, fat:p.fat};
  /* SLOT GUARDRAIL. Their picks come first, but breakfast has to stay breakfast. If a member
     stars three dinner foods, we do NOT serve steak at 7am — we top the breakfast pool up from
     the safe database so the slot always has real options. Intentional flexibility, not chaos. */
  var addedFoods={};                                           // slot -> [names we had to add]
  function poolFor(cat, picks, slot){
    var all=safeFoods(cat, sel.style, sel.allergies);
    var inSlot=function(f){ return f.slot==='any' || f.slot===slot; };
    var theirs=all.filter(function(f){ return !picks||!picks.length||picks.indexOf(f.n)>=0; });
    var fits=theirs.filter(inSlot);
    if(fits.length>=3) return fits;                            // enough of their own food works here
    var topUp=all.filter(function(f){ return inSlot(f) && fits.indexOf(f)<0; });
    topUp.slice(0,4).forEach(function(f){                      // record only what can actually surface
      (addedFoods[slot]=addedFoods[slot]||[]).push(f.n); });
    return fits.concat(topUp);                                 // their picks first, then sensible fills
  }
  var V=(sel.veg&&sel.veg.length)?sel.veg:FOOD_DB.veg;
  var split=MEAL_SPLIT[Math.min(S.meals,5)-1]||MEAL_SPLIT[2];
  var n=sel.optionsPerSlot||OPTIONS_PER_SLOT;

  var usedRecipes={};
  var slots=S.names.map(function(nm,k){
    var w=split[k]||split[split.length-1];
    var slot=(nm==='Breakfast')?'am':'pm';
    var target={protein:Math.round(base.protein*w.pro),
                carbs:Math.round(base.carbs*w.e),
                fat:Math.round(base.fat*w.e)};
    /* Options inside a slot must be genuinely DIFFERENT or the deck is a lie. Re-roll the seed
       until the item list is one we have not already produced for this slot. */
    var P=poolFor('protein', sel.protein, slot),
        C=poolFor('carb',    sel.carb,    slot),
        F=poolFor('fat',     sel.fat,     slot);
    var star=sel.starred||{};
    var chose={protein:sel.protein, carb:sel.carb, fat:sel.fat};
    var options=[], seen={};
    /* NAMED MEALS FIRST. Every template her pools can actually make, ranked by how many of her own
       (and starred) foods it uses, rotated per slot so lunch and dinner do not open on the same meal. */
    /* RECIPES FIRST: the licensed library, portioned to this slot's numbers. */
    var rc=recipeCandidates(slot, sel, k, usedRecipes, nm);
    /* RULE (Jayme 2026-09-19): every meal has at least one recipe AND at least one no-cook option.
       Recipes fill first but leave one seat for a no-cook meal unless a recipe is itself no-cook. */
    var hasNoCook=function(){ return options.some(function(o){ return o.nocook; }); };
    rc.filter(function(r){ return !usedRecipes[r.id] || (sel.protein||[]).length===0 && rc.length<=n; }).forEach(function(r){   // no recipe twice in a day; her own foods fill the gap
      if(options.length>=n) return;
      if(options.length>=n-1 && !hasNoCook() && !r.nocook) return;
      var ro=recipeOption(r, target, sel, slot);
      if(!ro) return;
      var key=ro.items.join('|'); if(seen[key]) return;
      ro.nocook=!!r.nocook;
      seen[key]=1; usedRecipes[r.id]=1; options.push(ro);
    });
    if(!options.some(function(o){ return o.recipe; })){
      /* Still no recipe (her proteins match none at this meal, like a steak-only list at breakfast):
         any recipe for this meal that her style and allergies allow. */
      var anyR=rc.length ? rc : (typeof RECIPE_LIBRARY!=='undefined' ? RECIPE_LIBRARY.filter(function(r){ return r.slot===slot; }) : []);
      if(rc.length && !rc.some(function(r){ return recipeOption(r, target, sel, slot); })) anyR=RECIPE_LIBRARY.filter(function(r){ return r.slot===slot; });
      anyR.some(function(r){
        if(options.length>=n) return true;
        var ro=recipeOption(r, target, sel, slot); if(!ro) return false;
        var key=ro.items.join('|'); if(seen[key]) return false;
        ro.nocook=!!r.nocook; seen[key]=1; options.push(ro); return true;
      });
    }
    var kind=slot, tplMine=[].concat(sel.protein||[], sel.carb||[], sel.fat||[]);
    var starAll=[].concat(star.protein||[], star.carb||[], star.fat||[]);
    var cands=MEAL_TEMPLATES.filter(function(t){ return t.slot===kind; }).map(function(t, ti){
      var tp=tplPool(P, t.protein, sel.protein, star.protein), tc=tplPool(C, t.carb, sel.carb, star.carb), tf=tplPool(F, t.fat||[], sel.fat, star.fat);
      if(t.lead) tp=tp.filter(function(f){ return t.lead.indexOf(f.n)>=0; }).concat(tp.filter(function(f){ return t.lead.indexOf(f.n)<0; }));
      if(!tp.length || !tc.length) return null;
      if(t.lead && t.lead.indexOf(tp[0].n)<0) return null;
      if(t.needs && !t.needs.every(function(nd){ return tc.some(function(f){ return f.n===nd; }); })) return null;
      var names=tp.concat(tc, tf).map(function(f){ return f.n; });
      var hits=names.filter(function(nm2){ return tplMine.indexOf(nm2)>=0; }).length + 2*names.filter(function(nm2){ return starAll.indexOf(nm2)>=0; }).length;
      return {t:t, tp:tp, tc:tc, tf:tf, score:-hits*10 + ((ti + k*2) % 7)};
    }).filter(Boolean).sort(function(a,b){ return a.score-b.score; });
    var tCalT=target.protein*4+target.carbs*4+target.fat*9;
    var usedTpl={};
    function runTemplates(cands, gates, cap){ gates.forEach(function(gate){ cands.forEach(function(cd, ci){
      if(options.length>=cap) return;
      if((usedTpl[cd.t.id]||0)>=gate[2]) return;
      var t=cd.t, leads=cd.tp.filter(function(f){ return !t.lead || t.lead.indexOf(f.n)>=0; });
      for(var li=0; li<Math.min(3, leads.length) && options.length<n; li++){
        var lead=leads[(li+ci) % leads.length];
        var Pp=[lead].concat(cd.tp.filter(function(f){ return (t.boost||[]).indexOf(f.n)>=0 && f.n!==lead.n; }));
        var need=(t.needs||[]).map(function(nd){ return cd.tc.filter(function(f){ return f.n===nd; })[0]; }).filter(Boolean);
        var rest=cd.tc.filter(function(f){ return need.indexOf(f)<0; });
        var Cp=need.concat(rest.slice((li+ci) % Math.max(1,rest.length)).concat(rest.slice(0,(li+ci) % Math.max(1,rest.length)))).slice(0, t.carbs||1);
        if(!Cp.length) Cp=cd.tc.slice(0,1);
        var Vt=t.veg ? (t.vegs ? V.filter(function(v){ return t.vegs.indexOf(typeof v==='string'?v:v.n)>=0; }) : V) : [];
        if(t.veg && !Vt.length) Vt=V;
        var opt=buildOption(Pp, Cp, cd.tf, Vt, target, slot, ci+li, k+ci+li, 3, star, chose);
        var key=opt.items.join('|');
        if(seen[key] || !opt.items.length) continue;
        var got=(opt.parts||[]).map(function(x){ return x.n; });
        if(t.needs && !t.needs.every(function(nd){ return got.indexOf(nd)>=0; })) continue;
        if(t.lead && !t.lead.some(function(nd){ return got.indexOf(nd)>=0; })) continue;
        if(t.needsAny && !t.needsAny.some(function(nd){ return got.indexOf(nd)>=0; })) continue;
        if(t.minUnits && (opt.parts||[]).some(function(x){ var fx=foodByName(x.n); return t.minUnits[x.n]!=null && x.units < t.minUnits[x.n]*((fx&&fx.gpu)||1)-1e-9; })) continue;
        var leadPart=(opt.parts||[]).filter(function(x){ return x.n===lead.n; })[0];
        if(!leadPart || (lead.p||0)*leadPart.units < opt.protein*(t.nocook && t.boost ? 0.3 : 0.55)) continue;   // the named protein has to carry the meal
        if(opt.protein < target.protein*gate[0] || Math.abs(opt.cal-tCalT) > tCalT*gate[1]) continue;   // a named meal that misses the numbers is not offered
        seen[key]=1; opt.tier=1; opt.name=mealName(t, opt); opt.nocook=!!t.nocook; options.push(opt); usedTpl[t.id]=(usedTpl[t.id]||0)+1;
        break;                                                     // one version of each meal per pass
      }
    }); }); }
    if(!hasNoCook()){
      /* The no-cook seat draws on every ready-to-eat food her style and allergies allow, her own picks first. */
      var Pa=safeFoods('protein', sel.style, sel.allergies), Ca=safeFoods('carb', sel.style, sel.allergies), Fa=safeFoods('fat', sel.style, sel.allergies);
      var rawV=(V.filter(function(v){ return RAW_VEG.indexOf(v)>=0; }).length ? V.filter(function(v){ return RAW_VEG.indexOf(v)>=0; }) : RAW_VEG);
      var ncands=MEAL_TEMPLATES.filter(function(t){ return t.slot===kind && t.nocook; }).map(function(t, ti){
        var tp=tplPool(Pa, t.protein, sel.protein, star.protein), tc=tplPool(Ca, t.carb, sel.carb, star.carb), tf=tplPool(Fa, t.fat||[], sel.fat, star.fat);
        if(t.lead) tp=tp.filter(function(f){ return t.lead.indexOf(f.n)>=0; }).concat(tp.filter(function(f){ return t.lead.indexOf(f.n)<0; }));
        if(!tp.length || !tc.length) return null;
        if(t.needs && !t.needs.every(function(nd){ return tc.some(function(f){ return f.n===nd; }); })) return null;
        var mine=tp.concat(tc, tf).filter(function(f){ return tplMine.indexOf(f.n)>=0; }).length;
        return {t:(t.veg ? Object.assign({}, t, {vegs:rawV}) : t), tp:tp, tc:tc, tf:tf, score:-mine*10 + ((ti + k*3) % 5)};
      }).filter(Boolean).sort(function(a,b){ return a.score-b.score; });
      runTemplates(ncands, [[0.95,0.12,1],[0.9,0.15,1],[0.85,0.15,1]], options.length+1);
    }
    runTemplates(cands, [[0.95,0.12,1],[0.95,0.12,2]], n);
    /* Option 1 is pure Tier 1. If the tier-1 pool cannot yield three DIFFERENT meals, later
       options open to tier 2, then 3. That is not a compromise, it is the lesson: the leanest
       option first, then what it costs you to reach past it. */
    for(var tier=1; tier<=3 && options.length<n; tier++){
      for(var seed=0; seed<12 && options.length<n; seed++){
        var opt=buildOption(P,C,F,V,target,slot,seed,k+options.length,tier,star,chose);
        if(slot==='am' && (opt.parts||[]).some(function(x){ return /protein powder|yogurt|cottage/.test(x.n); })){
          /* A shake or yogurt breakfast does not get a handful of broccoli on the side. */
          var vegItems=(opt.parts||[]).filter(function(x){ return x.veg; }).map(function(x){ return x.grams+' g '+x.n; });
          opt.parts=(opt.parts||[]).filter(function(x){ return !x.veg; });
          opt.items=opt.items.filter(function(x){ return vegItems.indexOf(x)<0; });
        }
        var key=opt.items.join('|');
        if(seen[key]) continue;
        seen[key]=1; opt.tier=tier; opt.name=plainMealName(opt); options.push(opt);
      }
    }
    /* If the food list genuinely cannot produce n DIFFERENT meals, return fewer rather than
       padding the deck with the same meal twice. A repeated option is not an option. */
    return {name:nm, target:target, options:options, thin:(options.length<n)};
  });

  if(S.shake) slots.push({name:'Protein shake', target:{protein:S.shake.protein},
    options:[{items:[S.shake.protein+'g protein shake'], parts:[{n:'protein shake', shake:true, grams:S.shake.protein}], cal:S.shake.calories,
              protein:S.shake.protein, carbs:0, fat:0}]});

  var nm=name?(String(name).split(' ')[0]+"'s"):'Your';
  var addedAll=[];
  Object.keys(addedFoods).forEach(function(k2){ addedAll=addedAll.concat(addedFoods[k2]); });
  return {title:nm+' nutrition system', days:PLAN_DAYS,
    frequency:S.frequency, label:S.label, optionsPerSlot:n,
    added:[...new Set(addedAll)],
    slots:slots, companions:generateCompanions(sel, COMPANIONS_PER_PLAN, name),
    note:'Seven days, built from '+n+' interchangeable options per meal. Every option in a slot '+
         'hits the same numbers, so you can swap any day for any other without doing the maths.'};
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONDITION PROFILES — and the HYBRID case (LOCKED 2026-09-01)
   A member is not one label. She can be on a GLP-1 AND in menopause at the same
   time, and those two situations pull in OPPOSITE directions on volume. A PDF
   cookbook cannot resolve that; a rules engine can. This is the composition.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Measured target: a condition deck runs at roughly DOUBLE the protein density of a
   general deck (about 10g protein per 100 kcal, against ~5.8 general). */
var CONDITION_PROTEIN_DENSITY = 10;   // grams protein per 100 kcal

function conditionProfile(flags){
  flags = flags || {};
  var glp1 = flags.glp1;                       // 'no' | 'on' | 'off' | 'considering'
  var meno = !!flags.menopause;
  var onGlp1 = (glp1 === 'on');
  var offGlp1 = (glp1 === 'off');
  var p = {
    key: 'general',
    proteinDensity: null,                      // null = use the normal phase maths
    optionsPerSlot: OPTIONS_PER_SLOT,          // 3 by default
    lowVolume: false, emphasiseCalcium: false, spreadFibre: false,
    headline: '', notes: []
  };

  if (onGlp1 && meno){
    /* THE HYBRID. Both raise the protein requirement, and they agree there. They DISAGREE on
       volume: menopause wants fibre spread across the day, a GLP-1 makes volume the binding
       constraint. Naming that conflict, and resolving it toward dense fibre rather than bulk,
       is the whole job. */
    p.key='glp1+menopause';
    p.proteinDensity=CONDITION_PROTEIN_DENSITY;
    p.optionsPerSlot=2; p.lowVolume=true; p.emphasiseCalcium=true; p.spreadFibre=true;
    p.headline='On a GLP-1 and in menopause';
    p.notes=[
      'Both of these raise your protein requirement, and on that they agree. Protein is the '+
      'highest priority in your plan and it does not move.',
      'They disagree about volume, and that is the part almost nobody handles. Menopause wants '+
      'fibre spread across the day. A GLP-1 makes volume the thing you cannot manage. So your '+
      'fibre comes from dense sources like chia, flax, berries and beans rather than from bulk '+
      'vegetables you will not finish.',
      'Calcium gets made visible rather than assumed, because bone is the quiet risk in this '+
      'season and a smaller appetite is how it gets missed.',
      'Fewer choices on purpose. Two options per meal, not three. A small appetite and decision '+
      'fatigue do not need a bigger menu.'
    ];
    return p;
  }
  if (onGlp1){
    p.key='glp1'; p.proteinDensity=CONDITION_PROTEIN_DENSITY;
    p.optionsPerSlot=2; p.lowVolume=true;
    p.headline='On a GLP-1';
    p.notes=[
      'Protein first and highest priority, in the smallest volume that carries it. The risk on a '+
      'GLP-1 is not overeating. It is under-eating protein and losing muscle alongside the fat.',
      'Fewer choices on purpose. Two options per meal, not three. Repetition is the feature here, '+
      'not a compromise.'
    ];
    return p;
  }
  if (offGlp1){
    p.key='glp1-offramp'; p.proteinDensity=CONDITION_PROTEIN_DENSITY;
    p.headline='Coming off a GLP-1';
    p.notes=[
      'The appetite comes back before the habits do. That gap is where the weight returns, and it '+
      'is the part you were almost certainly never taught.',
      'Your plan is built around a protein floor you can hold without the medication holding it '+
      'for you, and a structure for the weeks when the food noise comes back.'
    ];
    if (meno){ p.emphasiseCalcium=true; p.spreadFibre=true; p.key='glp1-offramp+menopause';
      p.headline='Coming off a GLP-1, in menopause';
      p.notes.push('Menopause is running underneath this, so the protein floor stays high and '+
        'calcium and fibre stay on the page rather than being assumed.'); }
    return p;
  }
  if (meno){
    p.key='menopause'; p.proteinDensity=CONDITION_PROTEIN_DENSITY;
    p.emphasiseCalcium=true; p.spreadFibre=true;
    p.headline='Perimenopause or menopause';
    p.notes=[
      'Protein floor goes up in this season, not down. That is the single biggest lever you have.',
      'Calcium-rich foods get made visible instead of assumed, and fibre gets spread across the '+
      'day rather than dumped into one meal.',
      'The scale gets read across weeks. It is going to be noisy week to week, and that noise is '+
      'not failure.'
    ];
    return p;
  }
  return p;
}

/* ===== RESTAURANT MEALS: complete orders from verified chain data =====
   Data lives in restaurant-data.js (RESTAURANT_DB), built from the official chain nutrition
   files in data/restaurants/. Every item carries its source.
   Rules (Jayme, Sept 2026): a meal is a REAL order. It always has a main (or a full bowl built
   the way the line builds it). Protein goes up only with a real add-on the chain sells. Sides are
   lean sides. Sauces and dressings are never added silently. No "half meals". */
var RESTAURANT_RULES=[
  "Protein you can see. Build around it.",
  "Grilled, not fried. Ask for light oil.",
  "Sauce and dressing on the side.",
  "One starch. Skip the bread, chips or fries if the meal already has one.",
  "Zero-calorie drink."
];
var RM_ROW={name:0,serving:1,cat:2,kcal:3,p:4,c:5,f:6,lto:7,src:8};
function rmItems(chain){
  var d=(typeof RESTAURANT_DB!=='undefined')&&RESTAURANT_DB.chains[chain]; if(!d) return [];
  return d.items.map(function(r){ return {name:r[0],serving:r[1],cat:r[2],kcal:r[3],p:r[4],c:r[5],f:r[6],lto:!!r[7],src:d.src[r[8]]||''}; });
}
function rmKids(i){ return /\bkid|cub meal|junior|jr\.?\b|mini\b/i.test(i.name+' '+i.serving); }
function rmLabel(i, role){
  var n=i.name.replace(/\s*\([^)]*\b(add-?on|add extra|protein component|pasta topping|protein option)\b[^)]*\)/ig,' ').replace(/\s+/g,' ').trim();
  n=n.replace(/,\s*(ingredient|cup and|medium|small|large|regular|bowl portion)\b.*$/i,'').replace(/\s*\(supplier [a-z]\)/ig,'');
  if(role==='add-on' && i.cat==='component_protein') n='Extra '+n.toLowerCase();
  return n;
}
function rmTotals(list){
  var t={kcal:0,p:0,c:0,f:0}; list.forEach(function(i){ t.kcal+=i.kcal; t.p+=i.p; t.c+=i.c; t.f+=i.f; });
  t.kcal=Math.round(t.kcal); t.p=Math.round(t.p); t.c=Math.round(t.c); t.f=Math.round(t.f); return t;
}
/* Lower is better. Overshoot costs more than undershoot, protein short costs most. */
function rmScore(c, calT, proT){
  var t=c.t, e=(t.kcal-calT)/calT, pr=t.p/proT;
  var s=Math.max(0,Math.abs(e)-0.05)*(e>0?3:1.5);          // inside +-5% of calories is a perfect fit
  s+=Math.max(0,0.95-pr)*3 + Math.max(0,pr-1.35)*0.5;       // protein 95-135% is a perfect fit
  var extras=c.kind!=='main' ? c.protein.length-1 : c.parts.length-1;
  s+=extras*0.05;                                           // simpler orders win ties
  c.parts.forEach(function(p){ if(rmKids(p)) s+=0.08; });   // kids portions only when they really help
  return s;
}
function rmBowls(items){
  var comp=items.filter(function(i){ return /^component_/.test(i.cat) && !i.lto && !rmKids(i); });
  var greens=comp.filter(function(i){ return i.cat==='component_base' && /green|lettuce|romaine|arugula|spinach|salad/i.test(i.name); });
  var grains=comp.filter(function(i){ return i.cat==='component_base' && /rice|grain|quinoa|farro|lentil/i.test(i.name); });
  var beans=comp.filter(function(i){ return /\bbeans?\b/i.test(i.name) && i.kcal<=160; });
  var prots=comp.filter(function(i){ return i.cat==='component_protein' && i.p>=12; });
  var buns=comp.filter(function(i){ return i.cat==='component_base' && /\bbun\b|\broll\b|bread/i.test(i.name) && !/mini|kid|hot dog/i.test(i.name); });
  if(!greens.length && !grains.length && buns.length && prots.length){
    /* Parts-only burger chains (Five Guys): bun or lettuce wrap, one or two patties, the free veg. */
    var free0=comp.filter(function(i){ return i.cat==='component_topping' && i.kcal<=15; }).slice(0,4);
    var cheese=comp.filter(function(i){ return i.cat==='component_topping' && /cheese/i.test(i.name) && i.kcal<=80; }).slice(0,1);
    var outB=[];
    prots.filter(function(p){ return /patty|burger|chicken|steak/i.test(p.name); }).forEach(function(p1){
      [[p1],[p1,p1]].forEach(function(pp){ [null].concat(buns.slice(0,1)).forEach(function(bun){ [null].concat(cheese).forEach(function(ch){
        outB.push({kind:'build', parts:[bun].concat(pp, free0, [ch]).filter(Boolean), protein:pp, bunless:!bun});
      }); }); });
    });
    return outB;
  }
  var free=comp.filter(function(i){ return i.cat==='component_topping' && i.kcal<=40 && !/lettuce|romaine/i.test(i.name); });
  var veg=free.filter(function(i){ return /fajita|vegetable|veggie|tomato|cucumber|onion|pepper|pico/i.test(i.name) && !/salsa/i.test(i.name); }).slice(0,1)
    .concat(free.filter(function(i){ return /salsa|pico/i.test(i.name); }).sort(function(a,b){return a.kcal-b.kcal;}).slice(0,1));
  var rich=comp.filter(function(i){ return i.cat==='component_topping' && i.kcal>40 && i.kcal<=250; });
  if(!prots.length || (greens.length+grains.length)<1) return [];
  var out=[], G=[null].concat(greens.slice(0,1)), R=[null].concat(grains), B=[null].concat(beans), X=[null].concat(rich);
  /* Two proteins are ordered one of two ways, and the order has to say which:
     HALF AND HALF (a half portion of each, same as one serving) or DOUBLE MEAT (a full portion of each). */
  var half=function(i){ return {name:i.name, serving:i.serving, cat:i.cat, kcal:i.kcal/2, p:i.p/2, c:i.c/2, f:i.f/2, lto:i.lto, src:i.src, half:true}; };
  prots.forEach(function(p1, i1){
    var pairs=[[p1]];
    prots.forEach(function(p2, i2){
      if(p2===p1) pairs.push([p1,p1]);                              // double portion of one meat
      else if(i2>i1){ pairs.push([p1,p2]); pairs.push([half(p1),half(p2)]); }
    });
    pairs.forEach(function(pp){
      G.forEach(function(g){ R.forEach(function(r){ if(!g&&!r) return;
        B.forEach(function(b){ X.forEach(function(x){
          var parts=[g,r,b].concat(pp, veg, [x]).filter(Boolean);
          out.push({kind:'bowl', parts:parts, protein:pp});
        }); });
      }); });
    });
  });
  return out;
}
function rmCombos(items, slot){
  var ok=items.filter(function(i){ return !i.lto && i.kcal>0; });
  var breakfastOnly=ok.filter(function(i){return i.cat==='main';}).length<3;
  var anchors=ok.filter(function(i){
    if(slot==='breakfast') return i.cat==='breakfast' || (breakfastOnly&&i.cat==='main');
    return i.cat==='main' || (breakfastOnly&&i.cat==='breakfast');
  }).filter(function(i){ return i.p>=8; });
  var addons=ok.filter(function(i){
    return ((i.cat==='protein_addon' || i.cat==='component_protein' || (i.cat==='drink'&&i.p>=15)) && i.p>=8 && i.p*4/i.kcal>=0.3)
      || (i.cat==='main' && i.p>=15 && i.p*4/i.kcal>=0.6);     // very lean mains double as add-ons (8 ct grilled nuggets)
  });
  var sides=ok.filter(function(i){ return i.cat==='side' && i.kcal<=220; });
  addons=addons.filter(function(i){ return !/collagen/i.test(i.name); });     // collagen is not a complete protein
  if(slot==='breakfast'){                                                     // breakfast has to read as breakfast
    addons=addons.filter(function(i){ return !/patty|burger|chili|roast beef|steak tips|tender|strip|diced chicken|snacker|thigh|drumstick|wing|nugget(?!.*grill)/i.test(i.name) || /grilled nugget|grilled filet/i.test(i.name); });
    sides=sides.filter(function(i){ return /fruit|apple|berr|banana|yogurt|parfait|oat|egg|hash|grits|melon|grape|orange|mandarin/i.test(i.name); });
  }
  /* An add-on has to make sense on the thing it is added to: extra patty on a burger, extra
     chicken on a chicken dish, salad or bowl. A whole lean entree (8 ct grilled nuggets) goes with anything. */
  var BEEF_MAIN=/burger|whopper|stack|smasher|hamburger|dave'?s|baconator|double-double|patty melt|cheeseburger/i;
  var fits=function(a, x){
    if(x.cat==='main' || x.cat==='drink' || /latte|matcha|shake|milk\b|protein powder|jerky|egg/i.test(x.name)) return true;
    if(/patty|burger|ground beef/i.test(x.name)) return BEEF_MAIN.test(a.name);
    if(BEEF_MAIN.test(a.name)) return /bacon|egg|cheese/i.test(x.name);
    return true;
  };
  var combos=[];
  anchors.forEach(function(a){
    var A=[[]], addons0=addons;
    addons=addons0.filter(function(x){ return fits(a,x); });
    var drink=function(i){ return i.cat==='drink' || /latte|matcha|shake|smoothie|protein powder|milk\b/i.test(i.name); };
    addons.forEach(function(x,ix){ A.push([x]); if(!drink(x)) A.push([x,x]);
      addons.slice(ix+1).forEach(function(y){ if(!(drink(x)&&drink(y))) A.push([x,y]); }); });
    A.forEach(function(ad){
      [null].concat(sides).forEach(function(s){
        combos.push({kind:'main', anchor:a, parts:[a].concat(ad, s?[s]:[]), protein:ad});
      });
    });
    addons=addons0;
  });
  if(slot!=='breakfast') rmBowls(items).forEach(function(b){ combos.push(b); });
  return combos;
}
/* chain: a RESTAURANT_DB key. target: {calories, protein} for ONE meal.
   Returns {chain, target, options:[{title, items:[...], totals, fit}], rules, sources, empty}. */
function restaurantMeals(chain, target, opts){
  opts=opts||{};
  var calT=Math.max(200,+target.calories||0), proT=Math.max(10,+target.protein||0);
  var items=rmItems(chain), slot=opts.slot||'meal', want=opts.count||3;
  var combos=rmCombos(items, slot);
  combos.forEach(function(c){ c.t=rmTotals(c.parts); c.s=rmScore(c, calT, proT); });
  var fits=combos.filter(function(c){ return c.t.kcal<=calT*1.10 && c.t.p>=proT*0.90; });
  var pool=(fits.length? fits : combos).sort(function(a,b){ return a.s-b.s; });
  var picked=[], seenKey={};
  for(var i=0;i<pool.length && picked.length<want;i++){
    var c=pool[i], key=c.kind!=='main' ? c.kind+':'+c.protein.map(function(p){return p.name;}).sort()[0]+(c.bunless?':wrap':'') : c.anchor.name;
    if(seenKey[key]) continue; seenKey[key]=1; picked.push(c);
  }
  var options=picked.map(function(c){
    var counts={}, rows=[];
    c.parts.forEach(function(p){ var k=p.name+'|'+p.serving+(p.half?'|half':''); if(counts[k]){ counts[k].qty++; return; } counts[k]={item:p, qty:1}; rows.push(counts[k]); });
    var lines=rows.map(function(r){
      var role = c.kind!=='main' ? (r.item.cat==='component_protein'?'protein':'bowl')
               : r.item===c.anchor ? 'main' : (r.item.cat==='side'?'side':'add-on');
      var nm=rmLabel(r.item, role), qty=r.qty;
      var twoMeats=c.kind==='bowl' && c.protein.length>1;
      if(role==='protein' && c.kind==='bowl'){
        if(r.item.half) nm+=' (half portion)';
        else if(r.qty>1){ nm+=' (double portion)'; qty=1; }
        else nm+=twoMeats ? ' (full portion)' : ' (one portion)';
      }
      return {name:nm, serving:r.item.serving, qty:qty, portions:r.qty, role:role,
              kcal:Math.round(r.item.kcal*r.qty), p:Math.round(r.item.p*r.qty), src:r.item.src};
    });
    var title = c.kind!=='main'
      ? (c.kind==='bowl' ? 'Bowl: ' : c.bunless ? 'Lettuce wrap or bowl: ' : 'Build it: ')+lines.map(function(l){ return (l.qty>1?'double ':'')+l.name; }).join(', ')
        +(c.kind==='bowl' && c.protein.length>1 ? (c.protein[0].half ? '. Ask for half and half.' : c.protein[0]===c.protein[1] ? '. Ask for double meat.' : '. Ask for double meat, a full portion of each.') : '')
      : lines.map(function(l){ return (l.qty>1?l.qty+'x ':'')+l.name; }).join(' + ');
    return {title:title, items:lines, totals:c.t,
            fit:{kcalPct:Math.round(c.t.kcal/calT*100), proteinPct:Math.round(c.t.p/proT*100)}};
  });
  var d=(typeof RESTAURANT_DB!=='undefined')&&RESTAURANT_DB.chains[chain];
  return {chain:chain, target:{calories:calT, protein:proT}, options:options, rules:RESTAURANT_RULES,
          retrieved:d?d.retrieved:'', official:d?d.official!==0:false, empty:!options.length};
}
function restaurantChains(){ return (typeof RESTAURANT_DB!=='undefined')? Object.keys(RESTAURANT_DB.chains).sort() : []; }

/* ===== SWAP SYSTEM =====
   Trade any food for another and land on the same numbers. A swap matches the food's ANCHOR macro:
   protein for protein, carbs for carbs, fat for fat. That keeps the meal doing the same job. The
   side effects (a swap that brings extra carbs or fat along) are called out so the member can trim
   elsewhere, never hidden. Portions use the same rounding the deck prints, so a swap reads like a
   real serving. */
var SWAP_ANCHOR={protein:'p', carb:'c', fat:'f'};
var SWAP_MACRO_NAME={p:'protein', c:'carbs', f:'fat'};
function swapFind(name){
  var cats=['protein','carb','fat','fruit'];
  for(var i=0;i<cats.length;i++){
    var list=FOOD_DB[cats[i]]||[];
    for(var j=0;j<list.length;j++){ if(list[j].n===name) return {cat:(cats[i]==='fruit'?'carb':cats[i]), food:list[j]}; }
  }
  return null;
}
/* All foods a member can swap between, grouped, respecting eating style and allergies. */
function swapFoods(opts){
  opts=opts||{};
  return {protein:safeFoods('protein',opts.style,opts.allergies),
          carb:safeFoods('carb',opts.style,opts.allergies),
          fat:safeFoods('fat',opts.style,opts.allergies)};
}
function swapNote(base, bu, m, key){
  var notes=[], bc=bu*(base.c||0), bf=bu*(base.f||0), bp=bu*(base.p||0);
  if(key!=='c' && m.c-bc>=8)  notes.push('brings about '+Math.round(m.c-bc)+'g more carbs, so go a little lighter on your carb');
  if(key!=='f' && m.f-bf>=5)  notes.push('brings about '+Math.round(m.f-bf)+'g more fat, so skip or halve the added fat');
  if(key!=='p' && m.p-bp>=8)  notes.push('adds about '+Math.round(m.p-bp)+'g protein, a bonus');
  if(key==='p' && bp-m.p>=6)  notes.push('lands a little under on protein');
  return notes.join('; ');
}
/* name: a FOOD_DB food name. units: how much of it (in that food's unit, e.g. 6 for 6 oz).
   Returns {category, macro, from:{...}, swaps:[{name, qty, kcal, p, c, f, delta, tier, note, src}]} */
function foodSwaps(name, units, opts){
  opts=opts||{};
  var hit=swapFind(name); if(!hit) return null;
  var base=hit.food, key=SWAP_ANCHOR[hit.cat];
  var bu=displayUnits(base, +units||1), grams=bu*base[key], baseKcal=bu*(base.kcal||0);
  var pool=safeFoods(hit.cat, opts.style, opts.allergies).filter(function(f){ return f.n!==base.n && (f[key]||0)>0; });
  var swaps=pool.map(function(f){
    var raw=grams/f[key];
    if(raw>(f.max||99)*1.25) return null;                        // a portion nobody would eat
    var m=macrosOf(f, raw);
    if(m[key] < grams*0.8) return null;                          // rounding lost too much
    return {name:f.n, qty:fmtQty(f,null,raw), tier:f.t,
            kcal:Math.round(m.kcal), p:Math.round(m.p), c:Math.round(m.c), f:Math.round(m.f),
            delta:Math.round(m.kcal-baseKcal), note:swapNote(base, bu, m, key), src:f.src};
  }).filter(Boolean).sort(function(a,b){ return (a.tier-b.tier) || (Math.abs(a.delta)-Math.abs(b.delta)); });
  return {category:hit.cat, macro:SWAP_MACRO_NAME[key],
          from:{name:base.n, qty:fmtQty(base,null,bu), grams:Math.round(grams), kcal:Math.round(baseKcal)},
          swaps:swaps};
}
/* The member's swap chart: for ONE meal, every protein that gives her the meal's protein, every carb
   that gives her the meal's carbs, and a standard 10g serving of added fat. perMeal = mealSplit().perMeal */
var SWAP_FAT_SERVING=10;
function swapChart(perMeal, opts){
  opts=opts||{};
  function col(cat, grams){
    var key=SWAP_ANCHOR[cat];
    return safeFoods(cat, opts.style, opts.allergies).map(function(f){
      if(!(f[key]>0)) return null;
      var raw=grams/f[key]; if(raw>(f.max||99)*1.25) return null;
      var m=macrosOf(f, raw); if(m[key]<grams*0.8) return null;
      return {name:f.n, qty:fmtQty(f,null,raw), tier:f.t, kcal:Math.round(m.kcal), p:Math.round(m.p), c:Math.round(m.c), f:Math.round(m.f)};
    }).filter(Boolean).sort(function(a,b){ return (a.tier-b.tier) || (a.kcal-b.kcal); });
  }
  var pm=perMeal||{};
  return {
    protein:{grams:Math.round(pm.protein||0), items:col('protein', pm.protein||30)},
    carb:{grams:Math.round(pm.carbs||0), items:col('carb', pm.carbs||30)},
    fat:{grams:SWAP_FAT_SERVING, items:col('fat', SWAP_FAT_SERVING)}
  };
}

/* ===== SHOPPING LIST + MEAL PREP GUIDE =====
   Built from the member's own meal deck. ONE shopping list covers the example week (PLAN_ROTATION):
     option 1 of every meal days 1-3, option 2 days 4-5, option 3 days 6-7.
   Prep happens in two sessions (PREP_SESSIONS) because cooked food keeps 3-4 days in the fridge
   (USDA FSIS leftovers guidance).
   Meal portions are COOKED amounts; the list converts to what you actually buy. Safe internal
   temperatures follow USDA FSIS. Every conversion here is a buying estimate, and says so. */
var PREP_DAYS=3;
/* The EXAMPLE WEEK (Jayme 2026-09-17: no batch labels in the plan). The plan is one set of meals,
   three options per meal, one shopping list. This is only the suggested way to eat through it. */
var PLAN_ROTATION=[{label:'Option 1', days:'Days 1 to 3',  option:0, count:3, start:1},
                   {label:'Option 2', days:'Days 4 and 5', option:1, count:2, start:4},
                   {label:'Option 3', days:'Days 6 and 7', option:2, count:2, start:6}];
/* Two short prep sessions keep every cooked meal inside the 3 to 4 day fridge window. */
var PREP_SESSIONS=[{label:'Day 1 prep', when:'Day 1', covers:[0]},
                   {label:'Day 4 prep', when:'Day 4', covers:[1,2]}];
var PREP_WAYS=[
  {title:'Easiest: one option at a time',
   lines:['Eat option 1 of every meal for days 1 to 3, option 2 for days 4 and 5, and option 3 for days 6 and 7.',
          'Prep twice: on day 1 make option 1, on day 4 make options 2 and 3.',
          'Repeating a meal for two or three days is the point. Fewer decisions, easier shopping.']},
  {title:'Mix and match',
   lines:['Cook the same foods on the same two prep days, but pack them loose instead of by meal.',
          'Each day, pick any option for any meal. They all hit your numbers.',
          'Best if you get bored easily or your days change a lot.']}
];
function exampleWeek(deck){
  var days=[];
  PLAN_ROTATION.forEach(function(r){
    for(var d=0; d<r.count; d++) days.push({day:r.start+d, option:r.option,
      meals:(deck.slots||[]).filter(function(sl){ return sl.options && sl.options.length; }).map(function(sl){
        var o=sl.options[Math.min(r.option, sl.options.length-1)]; return {slot:sl.name, name:o.name||o.items.join(', ')}; })});
  });
  return days;
}
/* sec = shopping section. buy(total, unitsLabel) turns the COOKED total into a store amount.
   cook = how to batch it. temp = USDA FSIS safe minimum internal temperature where one applies. */
var SHOP_INFO=(function(){
  var lb=function(oz){ return Math.max(0.25, Math.ceil(oz/16*4)/4); };
  var rawMeat=function(cookedOz){ return 'about '+lb(cookedOz/0.75)+' lb raw'; };   // meat and fish lose about 25% cooking
  var n=function(x){ return Math.ceil(x); };
  return {
    'chicken breast':   {sec:'Meat and fish', buy:rawMeat, cook:'Season and bake at 425°F for 20 to 25 minutes.', temp:'165°F'},
    'turkey breast':    {sec:'Meat and fish', buy:rawMeat, cook:'Roast at 375°F, or buy it roasted and slice it.', temp:'165°F'},
    '93% ground turkey':{sec:'Meat and fish', buy:rawMeat, cook:'Brown in a skillet, breaking it up as it cooks.', temp:'165°F'},
    'white fish (cod or tilapia)':{sec:'Meat and fish', buy:rawMeat, cook:'Bake at 400°F for 12 to 15 minutes.', temp:'145°F'},
    'canned tuna':      {sec:'Meat and fish', buy:function(oz){ return n(oz/4)+' cans (5 oz)'; }, cook:'No cooking. Drain and portion.'},
    'shrimp':           {sec:'Meat and fish', buy:rawMeat, cook:'Sauté 2 to 3 minutes per side until pink and opaque.', temp:'145°F'},
    'salmon':           {sec:'Meat and fish', buy:rawMeat, cook:'Bake at 400°F for 12 to 15 minutes.', temp:'145°F'},
    'sirloin steak':    {sec:'Meat and fish', buy:rawMeat, cook:'Sear or grill, then rest 3 minutes before slicing.', temp:'145°F'},
    '93% ground beef':  {sec:'Meat and fish', buy:rawMeat, cook:'Brown in a skillet and drain.', temp:'160°F'},
    'chicken thighs':   {sec:'Meat and fish', buy:rawMeat, cook:'Bake at 425°F for 25 to 30 minutes.', temp:'165°F'},
    'pork tenderloin':  {sec:'Meat and fish', buy:rawMeat, cook:'Roast at 425°F for 20 to 25 minutes, rest 3 minutes.', temp:'145°F'},
    'ribeye':           {sec:'Meat and fish', buy:rawMeat, cook:'Sear or grill, then rest 3 minutes.', temp:'145°F'},
    '80/20 ground beef':{sec:'Meat and fish', buy:rawMeat, cook:'Brown in a skillet and drain.', temp:'160°F'},
    'egg whites':       {sec:'Eggs and dairy', buy:function(c){ return n(c/13)+' carton'+(n(c/13)>1?'s':'')+' (16 oz)'; }, cook:'Bake as egg-white bites at 350°F for 20 minutes, or cook fresh.', temp:'160°F'},
    'whole eggs':       {sec:'Eggs and dairy', buy:function(c){ return n(c/12)+' dozen'; }, cook:'Hard-boil a batch (12 minutes), or cook fresh.', temp:'160°F'},
    'nonfat Greek yogurt':{sec:'Eggs and dairy', buy:function(c){ return n(c/4)+' tub'+(n(c/4)>1?'s':'')+' (32 oz)'; }, cook:'No cooking. Portion into containers.'},
    'low-fat cottage cheese':{sec:'Eggs and dairy', buy:function(c){ return n(c/3)+' tub'+(n(c/3)>1?'s':'')+' (24 oz)'; }, cook:'No cooking. Portion into containers.'},
    'cheese':           {sec:'Eggs and dairy', buy:function(oz){ return n(oz/8)+' block (8 oz)'; }, cook:'Slice or shred and portion.'},
    'butter':           {sec:'Eggs and dairy', buy:function(){ return 'from your pantry'; }},
    'extra-firm tofu':  {sec:'Plant protein', buy:function(oz){ return n(oz/14)+' block'+(n(oz/14)>1?'s':'')+' (14 oz)'; }, cook:'Press, cube and bake at 400°F for 25 minutes.'},
    'tempeh':           {sec:'Plant protein', buy:function(oz){ return n(oz/8)+' package'+(n(oz/8)>1?'s':'')+' (8 oz)'; }, cook:'Slice and pan-sear 4 minutes per side.'},
    'seitan':           {sec:'Plant protein', buy:function(oz){ return n(oz/8)+' package'+(n(oz/8)>1?'s':'')+' (8 oz)'; }, cook:'Slice and sear until browned.'},
    'edamame':          {sec:'Plant protein', buy:function(c){ return n(c/2.5)+' frozen bag'+(n(c/2.5)>1?'s':'')+' (12 oz)'; }, cook:'Steam from frozen for 5 minutes.'},
    'whey protein powder':{sec:'Protein powder', buy:function(sc){ return sc+(sc===1?' scoop':' scoops')+' (check your tub)'; }},
    'plant protein powder':{sec:'Protein powder', buy:function(sc){ return sc+(sc===1?' serving':' servings')+' (check your tub)'; }},
    'protein shake':    {sec:'Protein powder', buy:function(x){ return x+(x===1?' shake':' shakes'); }},
    'potatoes':         {sec:'Carbs and grains', buy:function(c){ return 'about '+lb(c*5.6)+' lb'; }, cook:'Cube and roast at 425°F for 30 to 35 minutes.'},
    'sweet potato':     {sec:'Carbs and grains', buy:function(c){ return 'about '+lb(c*8.5)+' lb'; }, cook:'Cube and roast at 425°F for 35 to 40 minutes.'},
    'oats':             {sec:'Carbs and grains', buy:function(c){ return Math.ceil(c*4)/4+' cups dry'; }, cook:'Make overnight oats in jars, one per breakfast.'},
    'lentils':          {sec:'Carbs and grains', buy:function(c){ return Math.ceil(c/2.5*4)/4+' cups dry'; }, cook:'Simmer 20 to 25 minutes until tender.'},
    'black beans':      {sec:'Carbs and grains', buy:function(c){ return n(c/1.5)+' can'+(n(c/1.5)>1?'s':'')+' (15 oz)'; }, cook:'Rinse and drain.'},
    'chickpeas':        {sec:'Carbs and grains', buy:function(c){ return n(c/1.5)+' can'+(n(c/1.5)>1?'s':'')+' (15 oz)'; }, cook:'Rinse and drain, or roast at 400°F for 25 minutes.'},
    'green peas':       {sec:'Carbs and grains', buy:function(c){ return n(c/2.5)+' frozen bag'+(n(c/2.5)>1?'s':'')+' (12 oz)'; }, cook:'Steam from frozen for 4 minutes.'},
    'corn':             {sec:'Carbs and grains', buy:function(c){ return n(c/2.5)+' frozen bag'+(n(c/2.5)>1?'s':'')+' (12 oz)'; }, cook:'Steam from frozen for 4 minutes.'},
    'butternut squash': {sec:'Carbs and grains', buy:function(c){ return n(c/4)+' medium squash'; }, cook:'Cube and roast at 400°F for 30 minutes.'},
    'white rice':       {sec:'Carbs and grains', buy:function(c){ return Math.ceil(c/3*4)/4+' cups dry'; }, cook:'1 cup dry rice to 2 cups water. Simmer covered 18 minutes.'},
    'brown rice':       {sec:'Carbs and grains', buy:function(c){ return Math.ceil(c/3*4)/4+' cups dry'; }, cook:'1 cup dry rice to 2.5 cups water. Simmer covered 45 minutes.'},
    'quinoa':           {sec:'Carbs and grains', buy:function(c){ return Math.ceil(c/3*4)/4+' cups dry'; }, cook:'Rinse. 1 cup dry to 2 cups water. Simmer 15 minutes.'},
    'whole-wheat pasta':{sec:'Carbs and grains', buy:function(c){ return Math.ceil(c*2)+' oz dry'; }, cook:'Boil 9 to 11 minutes, drain, toss with a little olive oil.'},
    'white pasta':      {sec:'Carbs and grains', buy:function(c){ return Math.ceil(c*2)+' oz dry'; }, cook:'Boil 9 to 11 minutes, drain, toss with a little olive oil.'},
    'sourdough':        {sec:'Carbs and grains', buy:function(x){ return x+' slices (about '+n(x/16)+' loaf)'; }},
    'corn tortilla':    {sec:'Carbs and grains', buy:function(x){ return x+(x===1?' tortilla':' tortillas'); }},
    'bagel':            {sec:'Carbs and grains', buy:function(x){ return x+(x===1?' bagel':' bagels'); }},
    'berries':          {sec:'Fruit', buy:function(c){ return n(c/2)+' pint'+(n(c/2)>1?'s':'')+' (or frozen)'; }, cook:'Wash and portion.'},
    'banana':           {sec:'Fruit', buy:function(x){ return x+(x===1?' banana':' bananas'); }},
    'apple':            {sec:'Fruit', buy:function(x){ return x+(x===1?' apple':' apples'); }},
    '96% ground beef':  {sec:'Meat and fish', buy:rawMeat, cook:'Brown in a skillet and drain.', temp:'160°F'},
    '90% ground beef':  {sec:'Meat and fish', buy:rawMeat, cook:'Brown in a skillet and drain.', temp:'160°F'},
    'ground bison':     {sec:'Meat and fish', buy:rawMeat, cook:'Brown in a skillet, breaking it up as it cooks.', temp:'160°F'},
    'ground chicken':   {sec:'Meat and fish', buy:rawMeat, cook:'Brown in a skillet, breaking it up as it cooks.', temp:'165°F'},
    'eye of round steak':{sec:'Meat and fish', buy:rawMeat, cook:'Sear hot and fast, rest 3 minutes, slice thin against the grain.', temp:'145°F'},
    'flank steak':      {sec:'Meat and fish', buy:rawMeat, cook:'Grill or sear, rest 5 minutes, slice thin against the grain.', temp:'145°F'},
    'filet mignon':     {sec:'Meat and fish', buy:rawMeat, cook:'Sear, finish in a 400°F oven, rest 5 minutes.', temp:'145°F'},
    'NY strip steak':   {sec:'Meat and fish', buy:rawMeat, cook:'Sear or grill, then rest 3 minutes.', temp:'145°F'},
    'pork chop':        {sec:'Meat and fish', buy:rawMeat, cook:'Sear 4 to 5 minutes a side, rest 3 minutes.', temp:'145°F'},
    'canned chicken':   {sec:'Meat and fish', buy:function(oz){ return n(oz/4)+' cans (5 oz)'; }, cook:'No cooking. Drain and portion.'},
    'deli turkey':      {sec:'Meat and fish', buy:function(oz){ return n(oz/8)+' package'+(n(oz/8)>1?'s':'')+' (8 oz)'; }, cook:'No cooking. Portion into containers.'},
    'beef jerky':       {sec:'Meat and fish', buy:function(oz){ return n(oz/3)+' bag'+(n(oz/3)>1?'s':'')+' (about 3 oz)'; }},
    '2% Greek yogurt':  {sec:'Eggs and dairy', buy:function(c){ return n(c/4)+' tub'+(n(c/4)>1?'s':'')+' (32 oz)'; }, cook:'No cooking. Portion into containers.'},
    'pinto beans':      {sec:'Carbs and grains', buy:function(c){ return n(c/1.5)+' can'+(n(c/1.5)>1?'s':'')+' (15 oz)'; }, cook:'Rinse and drain.'},
    'kidney beans':     {sec:'Carbs and grains', buy:function(c){ return n(c/1.5)+' can'+(n(c/1.5)>1?'s':'')+' (15 oz)'; }, cook:'Rinse and drain.'},
    'barley':           {sec:'Carbs and grains', buy:function(c){ return Math.ceil(c/3*4)/4+' cups dry'; }, cook:'1 cup dry to 3 cups water. Simmer covered 40 to 45 minutes.'},
    'couscous':         {sec:'Carbs and grains', buy:function(c){ return Math.ceil(c/3*4)/4+' cups dry'; }, cook:'Pour boiling water over, cover 5 minutes, fluff.'},
    'cream of rice':    {sec:'Carbs and grains', buy:function(){ return 'one box covers it'; }, cook:'Cook fresh each morning, about 1 minute.'},
    'popcorn':          {sec:'Carbs and grains', buy:function(){ return 'one bag of kernels covers it'; }},
    'whole-wheat bread':{sec:'Carbs and grains', buy:function(x){ return x+' slices (about '+n(x/18)+' loaf)'; }},
    'English muffin':   {sec:'Carbs and grains', buy:function(x){ return x+(x===1?' muffin':' muffins'); }},
    'rice cakes':       {sec:'Carbs and grains', buy:function(){ return 'one sleeve covers it'; }},
    'flour tortilla':   {sec:'Carbs and grains', buy:function(x){ return x+(x===1?' tortilla':' tortillas'); }},
    'granola':          {sec:'Carbs and grains', buy:function(){ return 'one bag covers it'; }},
    'avocado':          {sec:'Fats, nuts and extras', buy:function(x){ return n(x)+(n(x)===1?' avocado':' avocados'); }, cook:'Cut fresh each day so it stays green.'},
    'olive oil':        {sec:'Fats, nuts and extras', buy:function(){ return 'from your pantry'; }}
  };
})();
/* Buying amounts for foods weighed in grams. Cooked grains convert back to dry with the usual
   cooked-to-dry ratios (white rice about 2.6x, pasta 2.5x). Package sizes are the common US ones. */
(function(){
  var n=function(x){ return Math.max(1, Math.ceil(x)); }, lb=function(g){ return Math.max(0.25, Math.ceil(g/453.6*4)/4); };
  var pk=function(size, word){ return function(g){ var k=n(g/size); return k+' '+word.replace('#', k>1?'s':''); }; };
  var dry=function(ratio){ return function(g){ return 'about '+Math.ceil(g/ratio/10)*10+' g dry'; }; };
  var G={
    'potatoes':function(g){ return 'about '+lb(g)+' lb'; }, 'sweet potato':function(g){ return 'about '+lb(g)+' lb'; },
    'butternut squash':function(g){ return n(g/700)+' medium squash'; },
    'oats':function(g){ return g<=1100 ? 'one canister covers it' : n(g/1100)+' canisters'; },
    'lentils':dry(2.6), 'white rice':dry(2.6), 'brown rice':dry(3.2), 'quinoa':dry(3.3), 'couscous':dry(2.7), 'barley':dry(2.75),
    'whole-wheat pasta':dry(2.5), 'white pasta':dry(2.5),
    'black beans':pk(240,'can# (15 oz)'), 'pinto beans':pk(240,'can# (15 oz)'), 'kidney beans':pk(240,'can# (15 oz)'), 'chickpeas':pk(240,'can# (15 oz)'),
    'green peas':pk(340,'frozen bag# (12 oz)'), 'corn':pk(340,'frozen bag# (12 oz)'), 'edamame':pk(340,'frozen bag# (12 oz)'),
    'nonfat Greek yogurt':pk(907,'tub# (32 oz)'), '2% Greek yogurt':pk(907,'tub# (32 oz)'), 'low-fat cottage cheese':pk(680,'tub# (24 oz)'),
    'cheese':pk(227,'block# (8 oz)'),
    'whey protein powder':function(g){ return Math.ceil(g)+' g (check your tub)'; }, 'plant protein powder':function(g){ return Math.ceil(g)+' g (check your tub)'; },
    'berries':pk(340,'pint# (or a frozen bag)'), 'raspberries':pk(170,'container# (6 oz)'), 'blackberries':pk(170,'container# (6 oz)'),
    'strawberries':pk(454,'container# (1 lb)'), 'blueberries':pk(340,'pint#')
  };
  Object.keys(GRAMS_PER_UNIT).forEach(function(name){
    if(Object.prototype.hasOwnProperty.call(COUNTABLE, name)) return;   // counted foods keep their count-based buying line
    var info=SHOP_INFO[name]||(SHOP_INFO[name]={});
    if(G[name]) info.buy=G[name];
    else { var f=foodByName(name)||{};
      info.buy = /butter$|oil$/.test(name) && !/nut|seed|peanut|almond/.test(name) ? function(){ return 'from your pantry'; } : f.cat==='fat' ? function(){ return 'one jar or bag covers it'; } : function(g){ return g>=150 ? 'about '+lb(g)+' lb' : ''; }; }
  });
  var cook={'white rice':'1 part dry rice to 2 parts water. Simmer covered 18 minutes.', 'brown rice':'1 part dry rice to 2.5 parts water. Simmer covered 45 minutes.',
    'quinoa':'Rinse. 1 part dry to 2 parts water. Simmer 15 minutes.', 'barley':'1 part dry to 3 parts water. Simmer covered 40 to 45 minutes.'};
  Object.keys(cook).forEach(function(k){ if(SHOP_INFO[k]) SHOP_INFO[k].cook=cook[k]; });
})();
var VEG_SOLD={cucumber:{oz:8,each:'cucumbers'}, tomatoes:{oz:5,each:'tomatoes'}, peppers:{oz:6,each:'bell peppers'}};
var VEG_RAW={spinach:1,'salad greens':1,cucumber:1,tomatoes:1,cabbage:1,peppers:1,carrots:1};   // eaten raw, just wash and chop

function foodSection(name){
  var cats={protein:null, carb:'Carbs and grains', fat:'Fats, nuts and extras', fruit:'Fruit'};
  for(var c in cats){ var f=(FOOD_DB[c]||[]).filter(function(x){ return x.n===name; })[0];
    if(f){ if(c!=='protein') return cats[c]; return f.k==='plant' ? 'Plant protein' : (f.k==='dairy'||f.k==='egg') ? 'Eggs and dairy' : 'Meat and fish'; } }
  return '';
}
function shopRound(x, u){
  if(u==='g') return Math.ceil(x/5)*5;
  if(u==='oz') return Math.ceil(x*2)/2;
  if(u==='tbsp') return Math.ceil(x);
  if(!u) return Math.ceil(x*4)/4;
  return Math.ceil(x*4)/4;
}
/* Everything eaten in one batch: option index `option` of every meal, for `days` days, plus
   one snack a day. Returns {totals:{name:{qty,u,whole,veg,cups}}, meals:[{slot, items, parts}]} */
function batchTotals(deck, option, days, withSnack, into){
  var totals=into||{}, meals=[];
  (deck.slots||[]).forEach(function(sl){
    if(!sl.options||!sl.options.length) return;
    var o=sl.options[Math.min(option, sl.options.length-1)];
    meals.push({slot:sl.name, name:o.name, recipe:o.recipe, items:o.items, parts:o.parts||[], cal:o.cal, protein:o.protein});
    (o.parts||[]).forEach(function(pt){ addPart(totals, pt, days); });
  });
  if(withSnack && deck.companions && deck.companions.length){
    var c=deck.companions[option % deck.companions.length];
    meals.push({slot:'Snack', name:c.name, recipe:c.recipe, items:c.items, parts:c.parts||[], cal:c.cal, protein:c.protein});
    (c.parts||[]).forEach(function(pt){ addPart(totals, pt, days); });
  }
  return {totals:totals, meals:meals};
}
function addPart(totals, pt, days){
  if(pt.u==='ea') pt={n:pt.n, units:pt.units, u:'', whole:true, sec:pt.sec, recipe:pt.recipe, gpe:pt.gpe};
  var k=pt.n;
  if(totals[k] && !pt.veg && !pt.shake && (totals[k].u||'')!==(pt.u||'')){
    var each=/cherry tomato/.test(pt.n)?0.6:(/olives/.test(pt.n)?0.14:0), tb=/green onion/.test(pt.n)?2:0;
    var eg=(typeof RECIPE_UNIT_G!=='undefined' && RECIPE_UNIT_G.each[pt.n]) || 0;   // a counted vegetable weighed elsewhere
    var conv={'g>':eg?1/eg:0, '>g':eg, '>oz':each, 'oz>':each?1/each:0, '>tbsp':tb, 'tbsp>':tb?1/tb:0, 'tsp>tbsp':1/3, 'tbsp>tsp':3, 'tbsp>oz':0.5, 'oz>tbsp':2, 'cup>oz':8, 'oz>cup':0.125};
    var r=conv[(pt.u||'')+'>'+(totals[k].u||'')];
    if(r && !(pt.u==='cup' && /oil|milk/.test(pt.n))){ pt={n:pt.n, units:(pt.units||0)*r, u:totals[k].u, whole:pt.whole, sec:pt.sec, recipe:pt.recipe}; }
  }
  if(totals[k] && !pt.veg && !pt.shake && (totals[k].u||'')!==(pt.u||'')) k=pt.n+' ('+(pt.u||'each')+')';
  var t=totals[k]||(totals[k]={qty:0, u:pt.u||'', whole:!!pt.whole, veg:!!pt.veg, shake:!!pt.shake, sec:pt.sec||'', recipe:pt.recipe||''});
  if(pt.veg) t.qty+=(pt.grams||vegGrams(pt.n, pt.cups))*days;
  else if(pt.shake) t.qty+=days;
  else t.qty+=(pt.units||0)*days;
}
function shopAmount(name, t){
  var info=SHOP_INFO[name]||{};
  if(t.shake) return Math.ceil(t.qty)+(Math.ceil(t.qty)===1?' shake':' shakes');
  if(t.whole || !t.u){
    var q=t.whole ? Math.ceil(t.qty) : Math.ceil(t.qty*4)/4;
    if(t.u) return q+' '+pluralUnit(t.u,q);
    return (t.whole ? q : 'about '+Math.ceil(t.qty))+(name==='avocado'?(Math.ceil(t.qty)===1?' avocado':' avocados'):'');
  }
  if(t.u==='tsp' && t.qty>=3) return (Math.ceil(t.qty/3*2)/2)+' tbsp';
  var v=shopRound(t.qty, t.u);
  if(t.u==='taste') return 'to taste';
  if(t.u==='ea') return Math.ceil(t.qty*4)/4+'';
  if(t.u==='g') return v+' g'+(v>=454 ? ' (about '+(Math.ceil(v/453.6*4)/4)+' lb)' : '');
  if(t.u==='oz' && t.recipe) return v+' oz'+(v>=16 ? ' (about '+(Math.ceil(v/16*4)/4)+' lb)' : '');
  if(t.u==='oz') return v+' oz'+(info.sec==='Meat and fish'?' cooked':'');
  return v+' '+pluralUnit(t.u, v);
}
var NO_COOK=/^(No cooking|Wash and portion|Cut fresh|Slice or shred|Rinse and drain\.$)/;
/* deck = generateMealOptions() output. opts.option = which batch (0 A, 1 B, 2 day 7); opts.days. */
function shoppingList(deck, opts){
  opts=opts||{};
  var option=opts.option||0, days=opts.days||PREP_DAYS;
  var bt;
  if(opts.week){
    /* ONE list for the whole week: every batch in the rotation, added together. */
    bt={totals:{}, meals:[]};
    PLAN_ROTATION.forEach(function(rr){
      var b=batchTotals(deck, rr.option, rr.count, opts.snack!==false, bt.totals);
      b.meals.forEach(function(m){ m.batch=rr.label; bt.meals.push(m); });
    });
    days=PLAN_ROTATION.reduce(function(a,rr){ return a+rr.count; }, 0);
  } else bt=batchTotals(deck, option, days, opts.snack!==false);
  var order=['Meat and fish','Plant protein','Eggs and dairy','Protein powder','Carbs and grains','Fruit','Vegetables','Fats, nuts and extras','Pantry and spices'];
  var secs={};
  Object.keys(bt.totals).forEach(function(name){
    var t=bt.totals[name], info=SHOP_INFO[name]||{}, sec, need, buy='';
    if(t.veg){
      sec='Vegetables';
      var oz=t.qty/28.35;
      need=Math.ceil(t.qty/5)*5+' g';
      buy=VEG_SOLD[name] ? Math.ceil(oz/VEG_SOLD[name].oz)+' '+VEG_SOLD[name].each : 'about '+Math.max(0.5, Math.ceil(oz/16*2)/2)+' lb (fresh or frozen)';
    } else {
      sec=info.sec||t.sec||foodSection(name)||'Fats, nuts and extras';
      var q=(t.whole||t.shake) ? Math.ceil(t.qty) : shopRound(t.qty, t.u);
      need=shopAmount(name, t);
      var dbf=foodByName(name), sameUnit=!dbf || (dbf.u||'')===(t.u||'');
      buy=(/\boil\b/.test(name) && t.u==='g') ? 'from your pantry' : (info.buy && sameUnit) ? info.buy(q) : ((t.u==='tbsp'||t.u==='tsp') ? 'one jar or bag covers it' : '');
    }
    (secs[sec]=secs[sec]||[]).push({name:name, need:String(need), buy:buy});
  });
  var r=opts.week ? {label:'The week'} : PLAN_ROTATION[Math.min(option, PLAN_ROTATION.length-1)];
  return {label:r.label, days:days, option:option, meals:bt.meals.map(function(m){ return {slot:m.slot, batch:m.batch||r.label, name:m.name||m.items.join(', ')}; }),
    sections:order.filter(function(s){ return secs[s]; }).map(function(s){
      return {name:s, items:secs[s].sort(function(a,b){ return a.name<b.name?-1:1; })}; }),
    note:'Meal amounts are cooked portions. The buying amounts are estimates, rounded up so you never come up short.'};
}
/* A prep session for one batch: what to cook, how, safe temperatures, then how to pack it. */
function prepGuide(deck, opts){
  opts=opts||{};
  var option=opts.option||0, days=opts.days||PREP_DAYS, bt, session=null;
  if(opts.session!=null){
    session=PREP_SESSIONS[opts.session];
    bt={totals:{}, meals:[]}; days=0;
    session.covers.forEach(function(ri){
      var rr=PLAN_ROTATION[ri], b=batchTotals(deck, rr.option, rr.count, opts.snack!==false, bt.totals);
      b.meals.forEach(function(m){ m.days=rr.count; m.forDays=rr.days; bt.meals.push(m); });
      days+=rr.count;
    });
  } else bt=batchTotals(deck, option, days, opts.snack!==false);
  var cookLines=[], noCook=[], vegRoast=[], vegRaw=[];
  Object.keys(bt.totals).forEach(function(name){
    var t=bt.totals[name], info=SHOP_INFO[name]||{};
    if(t.recipe) return;
    if(t.veg){ (VEG_RAW[name]?vegRaw:vegRoast).push(name); return; }
    if(t.shake){ noCook.push('Protein shakes: mix fresh each day.'); return; }
    var amt=shopAmount(name, t);
    if(!info.cook){ noCook.push(name+', '+amt+'.'); return; }
    if(NO_COOK.test(info.cook)){ noCook.push(name+', '+amt+'. '+info.cook.replace(/^No cooking\.\s*/,'')); return; }
    cookLines.push({name:name, amount:amt, how:info.cook, temp:info.temp||''});
  });
  var protein=cookLines.filter(function(l){ return /Meat and fish|Plant protein|Eggs and dairy/.test((SHOP_INFO[l.name]||{}).sec||''); });
  var carbs=cookLines.filter(function(l){ return protein.indexOf(l)<0; });
  var steps=[];
  var recipes=bt.meals.filter(function(m){ return m.recipe && m.recipe.how; });
  if(recipes.length) steps.push({title:'Make the recipes', lines:recipes.map(function(m){
    var dd=m.days||days; return m.name+' ('+dd+' '+(dd===1?'serving':'servings')+'): '+m.recipe.how; })});
  if(protein.length) steps.push({title:'Cook your proteins', lines:protein.map(function(l){
    return l.name+', '+l.amount+'. '+l.how+(l.temp?' Cook to '+l.temp+' inside.':''); })});
  if(carbs.length) steps.push({title:'Cook your carbs', lines:carbs.map(function(l){ return l.name+', '+l.amount+'. '+l.how; })});
  if(vegRoast.length) steps.push({title:'Roast your vegetables', lines:['Chop '+vegRoast.join(', ')+'. Toss with 5 g of olive oil and roast at 425°F for 20 to 25 minutes.']});
  if(vegRaw.length) steps.push({title:'Wash and chop the fresh vegetables', lines:['Wash, dry and chop '+vegRaw.join(', ')+'. Store in a sealed container with a paper towel.']});
  if(noCook.length) steps.push({title:'Portion the no-cook foods', lines:noCook});
  var containers=bt.meals.filter(function(m){ return !/shake/i.test(m.slot); }).map(function(m){ return {slot:m.slot, name:m.name, count:m.days||days, forDays:m.forDays||'', items:m.items, cal:m.cal, protein:m.protein}; });
  steps.push({title:'Pack your containers', lines:containers.map(function(c){
    return c.count+' '+c.slot.toLowerCase()+' '+(c.count===1?'container':'containers')+(c.name?' of '+c.name:'')+(c.forDays?' ('+c.forDays.toLowerCase()+')':'')+'.'; })});
  var r=session ? {label:session.label} : PLAN_ROTATION[Math.min(option, PLAN_ROTATION.length-1)];
  return {label:r.label, days:days, option:option, steps:steps, containers:containers, ways:PREP_WAYS,
    storage:['Get cooked food into the fridge within 2 hours.',
             'Eat it within 3 to 4 days. That is why you prep twice a week.',
             'Want to cook once for longer? Freeze the later containers and move them to the fridge the night before.'],
    source:'Cooking temperatures and storage times follow USDA Food Safety and Inspection Service guidance.'};
}

/* ===== LINK TO THE SYSTEM DOCUMENT =====
   system/index.html builds the full member document (meals, shopping lists, prep guides, swaps,
   restaurant orders) and saves it as a PDF. Callers pass the member's inputs and open the link.
   inp = {name, cal, pro, carbG, fatG, phase, freq, shake, style, allergies[], protein[], carb[], fat[], veg[], restaurants[]} */
/* ===== THE MACRO FREEDOM FRAMEWORK =====
   Two free meals a week are built into the Lean number (goal weight x 13). A free meal REPLACES a
   meal, it never adds on top. Want more than two? Every extra free meal costs 100 calories a day
   for that week, and the plan is rebuilt at the lower number, so the portions come down with it.
   On a free meal the only target is 600 to 800 calories. Protein and produce still count that day. */
var MACRO_FREEDOM={included:2, cutPerExtra:100, mealCal:[600,800], max:6};
/* THE 85% STANDARD (Jayme 2026-09-18). Numbers only change when she is at least 85% consistent.
   100% consistent in effort, 85% consistent in hitting the numbers. One shared wording, used by the
   system document and the dashboard so they never disagree. */
var CONSISTENCY_STANDARD={
  pct:85,
  headline:'We only adjust your numbers when you are at least 85% consistent.',
  subline:'100% consistent in effort. 85% consistent in hitting your numbers.',
  looksLike:['Every meal tracked, including the free meals and the misses.',
             'Your meals on plan: three meals a day plus your two free meals is about 90%.',
             'Calories within about 100 of your target.',
             'Protein within 5 to 10 grams of your target, every day.',
             'Steps within about 1,000 of your goal.',
             'Your training sessions done.'],
  under:'Under 85%, we hold your numbers and build consistency first. The plan is not the problem yet.'
};
/* YOUR OWN FOOD (Jayme 2026-09-19). Any food she likes can go in a meal, even a packaged one like
   breaded chicken tenders, by following one order: protein first, subtract, fill the rest.
   ownFoodFit() is the math, OWN_FOOD the shared teaching (system document + dashboard), and
   diaryLabels() the Cronometer diary-group names that carry each meal's numbers. */
var OWN_FOOD={
  steps:['Know the meal\'s numbers. They are on your diary group label (below).',
         'Protein first. Log enough of your food to hit the meal\'s protein, within 5 to 10 grams.',
         'Subtract. Take that food\'s calories away from the meal\'s calories.',
         'Fill the rest. Use carbs, fat and vegetables from your swap guide until the meal lands within about 50 calories.'],
  proteinCheck:'The protein check: a lean protein gives you at least 10 grams of protein for every 100 calories. Breaded, fried and packaged proteins usually give less, so the breading counts as part of your carbs and leaves less room for everything else. If your food falls under 10, let it cover about half the meal\'s protein and close the gap with a lean protein like Greek yogurt, egg whites or a shake.',
  cronometer:['Rename your diary groups with each meal\'s numbers, like the labels above. In Cronometer on the web that is under More, then Display. On your phone it is Settings, then Diary.',
              'Log the meal from your plan with the Log it in Cronometer link.',
              'To swap, delete the protein and add yours. Scan the barcode, or add it as a custom food straight from the label.',
              'Change the amount until the group\'s protein matches its label. Then adjust the carbs and fat until the calories do too.',
              'When your plan changes, you only rename the labels. Everything else stays the same.'],
  gold:'Diary groups come with Cronometer Gold. On the free version, save each meal as a custom meal with its numbers in the name instead.'
};
function ownFoodFit(meal, food){
  /* meal {calories, protein}; food {cal, protein} per serving. How much hits the protein and what is left. */
  var mc=+meal.calories||0, mp=+meal.protein||0, fc=+food.cal||0, fp=+food.protein||0;
  if(!(fc>0) || !(fp>0) || !(mp>0)) return null;
  var servings=Math.round(mp/fp*4)/4, cal=Math.round(servings*fc), pro=Math.round(servings*fp);
  var density=fp/fc*100, heavy=density<10;
  var r={servings:servings, calories:cal, protein:pro, left:Math.round(mc-cal), density:Math.round(density*10)/10, lean:density>=10, heavy:heavy};
  if(heavy){ /* half the meal's protein from this food, the rest from a lean booster */
    var hs=Math.max(0.5, Math.round(mp*0.5/fp*4)/4), hp=Math.round(hs*fp), gap=Math.max(0, mp-hp);
    var yog=Math.round(gap/0.103/5)*5; /* nonfat Greek yogurt, USDA 10.3 g protein per 100 g, 59 cal */
    r.half={servings:hs, calories:Math.round(hs*fc), protein:hp, gap:gap, yogurtG:yog, yogurtCal:Math.round(yog*0.59), left:Math.round(mc-hs*fc-yog*0.59)};
  }
  return r;
}
function diaryLabels(split){
  var s=split||{}, pm=s.perMeal||{}, out=(s.names||[]).map(function(n){ return n+' · '+pm.calories+' cal · '+pm.protein+' g protein'; });
  if(s.shake) out.push('Protein Shake · '+s.shake.calories+' cal · '+s.shake.protein+' g protein');
  return out;
}
function freedomPlan(pfs, freeMeals, sex){
  var n=Math.max(MACRO_FREEDOM.included, Math.min(MACRO_FREEDOM.max, +freeMeals||MACRO_FREEDOM.included));
  var extra=n-MACRO_FREEDOM.included, cut=extra*MACRO_FREEDOM.cutPerExtra;
  var out=macrosFrom(Math.max(1000, (+pfs.calories||0)-cut), +pfs.protein||0, sex);
  return {freeMeals:n, extra:extra, cut:cut, base:Math.round(+pfs.calories||0), pfs:out,
    rules:['A free meal replaces a meal, it never adds on top.',
           'On a free meal the only number is 600 to 800 calories. Nothing else to count.',
           'Protein and produce still count that day. Those two never flex.',
           'Forecast on Sunday. Count the week\'s free meals going in, never discover them as they happen.']};
}

/* ===== TIME TO GOAL =====
   Jayme's gauge (2026-09-17): maintenance is CURRENT bodyweight x a multiplier set by how much she
   walks (5,000 steps x13 up to 12,000+ x16, the same scale the plan is built on). Her target is her
   goal weight x the phase multiplier, so the deficit is real: Rachel at 182 lb walking 10,000 steps
   maintains near 2,730 and eats 1,950, which is about 1.5 lb a week.
   Maintenance falls as she gets lighter because it is tied to her bodyweight. Calories step down one
   multiplier (one goal weight) every PHASE_WEEKS to the Lean floor at goal weight x 11.
   No week is quoted above 1% of bodyweight, the line past which muscle starts going with the fat. */
var GOAL_PACE={maxPct:0.01, maxLb:1.5};   // never quote faster than 1.5 lb a week, or 1% of bodyweight
var PHASE_WEEKS=16;
var STEP_LEVELS=[{steps:5000, label:'5,000 steps'}, {steps:7500, label:'7,500 steps'},
                 {steps:10000, label:'10,000 steps'}, {steps:12000, label:'12,000 steps'}];
var ACTIVITY_STEPS={'Sedentary':5000, 'Lightly active':7500, 'Active':10000, 'Very active':12000};
var PACE_STEP_BASE=5000;                     // the maintenance multiplier already covers about 5,000 steps of daily life
function stepBurn(weight, steps){ return Math.round(0.25*(+weight)*Math.max(0,(+steps||0)-PACE_STEP_BASE)/1000); }
function stepLevel(steps){
  var want=+steps||7500, hit=STEP_LEVELS[0];
  STEP_LEVELS.forEach(function(L){ if(want>=L.steps) hit=L; });
  return hit;
}
function paceRun(weight, goal, calories, mult, steps){
  var x=+weight, g=+goal, c=+calories, n=0, first=0, last=0;
  while(x>g+0.01 && n<260){
    var burn=g*15 + 0.25*x*Math.max(0,steps-PACE_STEP_BASE)/1000;          // upper limit (ideal x15) plus what extra steps add
    var lb=Math.min(Math.max(0, burn-c)*7/3500, x*GOAL_PACE.maxPct, GOAL_PACE.maxLb);
    if(lb<=0.02) break;
    if(!n) first=lb;
    last=lb; x-=lb; n++;
    if(n%PHASE_WEEKS===0) c=Math.max(g*11, c-g);
  }
  return {weeks:(x<=g+0.01 ? n : null), first:Math.round(first*10)/10, last:Math.round(last*10)/10};
}
function goalTimeline(weight, goalweight, phase, opts){
  opts=opts||{};
  var w=+weight, g=+goalweight; if(!(w>0 && g>0)) return null;
  var ph=String(phase||'Lean');
  var out={start:Math.round(w), goal:Math.round(g), change:Math.round(Math.abs(w-g)), phase:ph};
  var cal=+opts.calories||0;
  if(ph!=='Lean' || w<=g || !cal){ out.weeks=null; return out; }
  var mult=15, steps=+opts.steps || ACTIVITY_STEPS[opts.activity] || 7500, L=stepLevel(steps);
  var run=paceRun(w, g, cal, mult, L.steps);
  out.multiplier=15; out.upper=Math.round(g*15);
  out.maintenance=out.upper; out.calories=cal; out.deficit=Math.round(g*15-cal);
  out.steps=L.steps; out.stepLabel=L.label; out.stepCalories=stepBurn(w, L.steps);
  out.weeks=run.weeks; out.paceNow=run.first; out.paceLater=run.last;
  out.bySteps=STEP_LEVELS.map(function(x){
    var r=paceRun(w, g, cal, mult, x.steps);
    return {steps:x.steps, label:x.label, gap:Math.round(g*15-cal)+stepBurn(w, x.steps), extra:stepBurn(w, x.steps), pace:r.first, weeks:r.weeks, mine:x.steps===L.steps};
  });
  out.lifting={fatShare:92, withoutShare:74};
  return out;
}

/* ===== CRONOMETER =====
   Cronometer imports a recipe from a pasted ingredient list. These lines are plain text, one food per
   line, decimal amounts (no ½ characters, which importers can misread). mealLink() opens a small page
   (recipe/) with a one-tap Copy button, because a link alone is not allowed to write to the clipboard. */
function cronNum(q){ return String(Math.round(q*100)/100); }
function mealIngredientLines(opt){
  var out=[];
  (opt.parts||[]).forEach(function(pt){
    if(pt.shake){ out.push((pt.grams||30)+' g protein powder'); return; }
    if(pt.veg){ out.push((pt.grams||vegGrams(pt.n, pt.cups))+' g '+pt.n); return; }
    if(pt.u==='taste') return;                                      // seasonings: no weight to log
    var n=pt.n.replace(/\s*\((raw)\)/,', raw').replace(/\s*\((dry)\)/,', dry');
    var u=pt.u||'';
    var fdb=foodByName(pt.n);
    if(fdb && fdb.desc!=null && fdb.gpu){ out.push(Math.round(pt.units*fdb.gpu)+' g '+n); return; }
    if(u==='ea' && pt.gpe){ out.push(Math.round(pt.units*pt.gpe)+' g '+n); return; }
    if(!u){ out.push(cronNum(pt.units)+' '+(/^can /.test(n)? n : n)); return; }
    out.push(cronNum(pt.units)+' '+u+' '+n);
  });
  return out;
}
var MEAL_PAGE='https://dashboard.legacyperformance.co/recipe/';
function mealLink(opt, base){
  var data={n:opt.name||'LP meal', i:mealIngredientLines(opt), m:[Math.round(opt.cal||0), Math.round(opt.protein||0), Math.round(opt.carbs||0), Math.round(opt.fat||0)],
            h:(opt.recipe&&opt.recipe.how)||''};
  var b64=(typeof btoa==='function') ? btoa(unescape(encodeURIComponent(JSON.stringify(data)))) : '';
  return (base||MEAL_PAGE)+'?r='+b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function systemLink(inp, base){
  var json=JSON.stringify(inp||{});
  var b64=(typeof btoa==='function') ? btoa(unescape(encodeURIComponent(json))) : '';
  return (base||'system/')+'#d='+encodeURIComponent(b64);
}
