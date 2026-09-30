/* Print the live system-document URL for a client kit JSON (same payload the dashboard sends). */
const fs=require('fs'),vm=require('vm'),path=require('path');
const c={btoa:s=>Buffer.from(s,'binary').toString('base64'),unescape,encodeURIComponent};
vm.createContext(c); vm.runInContext(fs.readFileSync(path.resolve(__dirname,'..','nutrition-engine.js'),'utf8'),c);
const inp=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const m=c.macrosFrom(inp.cal,inp.pro,inp.sex);
inp.carbG=Math.round(m.carbs); inp.fatG=Math.round(m.fat);
console.log(c.systemLink(inp,'https://dashboard.legacyperformance.co/system/?v='+Date.now()));
