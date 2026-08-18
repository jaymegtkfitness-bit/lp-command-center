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
function computeTDEE(w){
  var kg=(+w.weight)/2.2046, cm=(+w.height)*2.54;
  var bmr=/^m/i.test(w.sex)?(10*kg+6.25*cm-5*w.age+5):(10*kg+6.25*cm-5*w.age-161);
  var af={"Sedentary":1.2,"Lightly active":1.375,"Active":1.55,"Very active":1.725,"Athlete":1.9}[w.activity]||1.375;
  return Math.round(bmr*af);
}

/* Daily macro targets from a client's numbers + track (the formula DEFAULT, before any override).
   w = {goalweight, sex, weight, height, age, activity}; track = Lean|Strong|Sustain|Reverse Diet. */
function computePFS(w, track){
  var gbw=+w.goalweight;
  var mult={"Lean":15,"Strong":15,"Sustain":15,"Long":15,"Reverse Diet":10}[track]||15;
  var ppl={"Lean":1.0,"Sustain":0.9,"Long":0.9,"Strong":0.8,"Reverse Diet":1.0}[track]||1.0;
  var base=macrosFrom(Math.round(gbw*mult), Math.round(gbw*ppl), w.sex);
  var tdee=computeTDEE(w);
  base.tdee=tdee; base.delta=base.calories-tdee;
  return base;
}

function mealsPerDay(){ return 3; }

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

var FOOD_DB={
  protein:[{n:"chicken breast",g:8.7,u:"oz"},{n:"lean beef",g:7.5,u:"oz"},{n:"turkey",g:8,u:"oz"},{n:"white fish",g:6,u:"oz"},{n:"shrimp",g:6,u:"oz"},{n:"salmon",g:6.3,u:"oz"},{n:"eggs",g:6,u:"",whole:true},{n:"Greek yogurt",g:10,u:"cup",frac:true},{n:"tofu/tempeh",g:10,u:"cup",frac:true},{n:"protein powder",g:24,u:"scoop",whole:true}],
  carb:[{n:"white rice",g:45,u:"cup",frac:true},{n:"potatoes",g:37,u:"cup",frac:true},{n:"sweet potato",g:27,u:"cup",frac:true},{n:"oats",g:27,u:"cup dry",frac:true},{n:"sourdough",g:15,u:"slice",whole:true},{n:"fruit",g:25,u:"piece",whole:true},{n:"beans/lentils",g:40,u:"cup",frac:true},{n:"pasta",g:43,u:"cup",frac:true}],
  fat:[{n:"olive oil",g:14,u:"tbsp",frac:true},{n:"avocado",g:15,u:"",frac:true},{n:"nut butter",g:8,u:"tbsp",frac:true},{n:"cheese",g:9,u:"oz",frac:true},{n:"egg yolks",g:5,u:"",whole:true},{n:"seeds",g:4,u:"tbsp",frac:true}],
  veg:["broccoli","spinach","peppers","zucchini","green beans","asparagus","salad greens","cauliflower"]
};

function fmtQty(f, targetG){
  var units=targetG/f.g; if(!isFinite(units)||units<=0.1) units=0.5;
  if(f.whole){ var c=Math.max(1,Math.round(units)); return f.u? (c+' '+f.u+(c!==1?'s':'')+' '+f.n) : (c+' '+f.n); }
  if(f.u==="oz"){ return (Math.round(units*10)/10)+' oz '+f.n; }
  var q=Math.max(0.25, Math.round(units*4)/4);
  return f.u? (q+' '+f.u+(q!==1?'s':'')+' '+f.n) : (q+' '+f.n);
}

/* Build a meal plan from a client's targets (it.pfs) + selected foods.
   it = {pfs:{calories,protein,carbs,fat}}; sel = {protein:[],carb:[],fat:[],veg:[]}; name = client's name (for the title). */
function generateMealPlan(it, sel, days, name){
  var p=it.pfs, m=mealsPerDay();
  var pmPro=Math.round(p.protein/m), pmCarb=Math.round(p.carbs/m), pmFat=Math.round(p.fat/m), pmCal=Math.round(p.calories/m);
  function pick(cat, names){ var list=FOOD_DB[cat].filter(function(f){return !names||!names.length||names.indexOf(f.n)>=0;}); return list.length?list:FOOD_DB[cat]; }
  var P=pick('protein',sel.protein), C=pick('carb',sel.carb), F=pick('fat',sel.fat), V=(sel.veg&&sel.veg.length)?sel.veg:FOOD_DB.veg;
  var names=["Breakfast","Lunch","Dinner","Meal 4","Meal 5"], out=[];
  for(var d=0;d<days;d++){ var meals=[];
    for(var k=0;k<m;k++){ var i=d*m+k;
      meals.push({name:names[k]||("Meal "+(k+1)),
        items:[fmtQty(P[i%P.length],pmPro), fmtQty(C[i%C.length],pmCarb), fmtQty(F[i%F.length],pmFat), "a big handful of "+V[i%V.length]],
        cal:pmCal,protein:pmPro,carbs:pmCarb,fat:pmFat}); }
    out.push({day:d+1,label:"Day "+(d+1),meals:meals}); }
  var nm=name?(String(name).split(' ')[0]+"'s"):"Your";
  return {title:nm+" meal plan",note:"Auto-built from your favorites. Swap any food and regenerate anytime.",days:out};
}
