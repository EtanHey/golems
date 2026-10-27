import {test,expect} from 'bun:test';
import {Window} from 'happy-dom';
import {renderDecisionFlow} from '../src/decision-flow.mjs';
test('scroll suppressed during a navigation lock is reconciled when the lock settles',()=>{
 const ids=['a','b','c'],window=new Window(),d=window.document,frames=[];let now=0;
 window.HTMLElement.prototype.scrollIntoView=function(){};
 Object.defineProperty(window,'scrollY',{value:0,writable:true,configurable:true});
 Object.defineProperty(window,'innerHeight',{value:844,configurable:true});
 const scenes=ids.map(id=>({id,title:id,script:'one two',duration:1,audioUrl:'data:audio/mpeg;base64,SUQz',words:[{word:'one',start:0,end:.3},{word:'two',start:.4,end:.7}]}));
 d.write(renderDecisionFlow({heading:'Private follow regression',storageKey:'dbx:m1-scroll-lock-regression',scenes,decisions:ids.map(id=>({id,title:id,body:'Body',options:['Keep'],sceneIds:[id]}))}));
 Object.defineProperty(d.documentElement,'scrollHeight',{value:5000,configurable:true});
 new Function('document','localStorage','navigator','Date','setTimeout','requestAnimationFrame',d.querySelector('script:last-of-type').textContent)(d,window.localStorage,window.navigator,{now:()=>now},()=>{},fn=>frames.push(fn));
 const flush=()=>{const batch=frames.splice(0);batch.forEach(fn=>fn())},active=()=>d.querySelector('.df-card.is-active').dataset.decision;
 try{
  d.querySelector('[data-chip-for="b"]').click();expect(active()).toBe('b');
  window.scrollY=4156;window.dispatchEvent(new window.Event('scroll'));now=100;flush();expect(active()).toBe('b');
  now=300;flush();const afterSettle=active();
  expect(frames).toHaveLength(0);expect(afterSettle).toBe('c');
 }finally{window.close()}
});
