import { chromium } from "playwright";
import fs from "node:fs";
const OUT = "/tmp/claude-0/-root-pourya/0ffb89c6-0ed3-4323-b6dd-356731fa68b2/scratchpad";
const pw = fs.readFileSync(".env.local","utf8").split("\n").find(l=>l.startsWith("APP_PASSWORD=")).split("=").slice(1).join("=").trim();
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1000,height:1250}})).newPage();
const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
await p.goto("http://127.0.0.1:3099/login",{waitUntil:"networkidle"});
await p.fill('input[type="password"]', pw); await p.click('button[type="submit"]');
await p.waitForURL(u=>!u.pathname.includes("login"));
const today = new Date().toISOString().slice(0,10);
await p.evaluate(async (date) => {
  const cs = (await (await fetch("/api/customers")).json()).customers;
  const target = cs.find(c => c.customer_code === "TEST-S1");
  await fetch("/api/visit-plans",{method:"POST",headers:{"Content-Type":"application/json"},
    body: JSON.stringify({entity_type:"customer", entity_id:target.id, planned_date:date})});
}, today);
await p.goto("http://127.0.0.1:3099/planner",{waitUntil:"networkidle"});
await p.waitForTimeout(3000);
const hint = p.locator("text=/از این مسیر فاصله دارد/");
console.log("restock hint shown:", await hint.count() > 0);
if (await hint.count()) {
  console.log("  ", (await hint.first().innerText()).trim());
  await p.locator('button:has-text("افزودن توقف")').click();
  await p.waitForTimeout(2500);
  const stops = await p.locator("ul > li").evaluateAll(ls => ls.map(l=>l.innerText.split("\n").filter(Boolean)[0]?.trim()).filter(Boolean));
  console.log("stops after insert:", stops);
  console.log("hint gone after insert:", await p.locator("text=/از این مسیر فاصله دارد/").count() === 0);
  await p.screenshot({ path: `${OUT}/16-restock.png`, fullPage: true });
}
console.log("errors:", errs.length ? errs.slice(0,2) : "none");
await b.close();
