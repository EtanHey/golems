import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { renderDecisionFlow } from '../../../src/decision-flow.mjs';
import { spec } from '../../fixtures/card-visuals.mjs';
const phase=process.argv[2], out='./evals/proof/card-visuals/';
const browser=await chromium.launch(); const receipts=[];
try { for(const width of [390,1280]) for(const colorScheme of ['light','dark']) {
const page=await browser.newPage({viewport:{width,height:1100},colorScheme,reducedMotion:'reduce'});
await page.setContent(renderDecisionFlow({...spec,subtitle:'Total audio 22 min 31 s · 5 sections · 61 cards. Keep this context.'}));
await page.locator('.df-context').evaluate(e=>e.open=true);
receipts.push({width,colorScheme,...await page.evaluate(()=>{const chart=document.querySelector('.df-chart-scroll'); const panel=document.querySelector('.df-chart'); const table=document.querySelector('.df-table-scroll'); const card=document.querySelector('.df-card'); const style=e=>({color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor}); return {scrollWidth:chart.scrollWidth,clientWidth:chart.clientWidth,panel:style(panel),table:style(table),card:style(card),totalLines:document.querySelector('.df-context').textContent.match(/Total audio/g).length,bars:[...chart.querySelectorAll('rect')].map(e=>{const r=e.getBoundingClientRect(),c=chart.getBoundingClientRect();return {visible:r.left>=c.left&&r.right<=c.right}})};})});
await page.screenshot({path:out+`r2-${width}-${colorScheme}-${phase}.png`,fullPage:true}); await page.close();
} } finally { await browser.close(); }
writeFileSync(out+`r2-${phase}.json`,JSON.stringify(receipts,null,2)+'\n');
