import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

const temp=mkdtempSync(join(tmpdir(),'potok-tests-'));
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','src/workflow.ts','--outDir',temp,'--module','commonjs','--target','ES2020','--skipLibCheck','--strict']);
const require=createRequire(import.meta.url);
const {allowedActions,transition,commercialTerms,businessDeadline,expired,changeClaim,claimVisible}=require(join(temp,'workflow.js'));
const {seed,roles,visible}=require(join(temp,'data.js'));
after(()=>rmSync(temp,{recursive:true,force:true}));
const [manager,warehouse,large,small,store]=roles;
const now=new Date('2026-10-13T09:00:00Z');
function order(){return {id:'3251',kind:'normal',shop:store.org,small:small.org,large:large.org,customer:'Тестовый покупатель',items:[{sku:'K1',name:'Кухня',qty:1,price:1}],stage:'small',delivery:'factory',created:now.toISOString(),updated:now.toISOString(),boxes:2,scanned:0,loaded:0,reserveDays:3,documents:'draft',history:[]};}
function step(o,a,action,input={},others=[]){const {change,event}=transition(o,a,action,input,others,now);return {...o,...change,history:[...o.history,event]};}
function approved(){let o=order();o=step(o,small,'forward');o=step(o,large,'forward');o=step(o,manager,'open');return step(o,manager,'approve',{price:85000,planned:'2026-11-20',boxes:2,reserveDays:3});}
function production(){let o=approved();o=step(o,large,'quote',{price:92000});o=step(o,small,'quote',{price:99000});o=step(o,store,'confirmBuyer');o=step(o,small,'confirmSmall');o=step(o,large,'confirmLarge');return step(o,manager,'production');}
function stocked(){let o=production();o=step(o,warehouse,'scan');o=step(o,warehouse,'scan');return step(o,warehouse,'warehouse');}
function delivered(o=stocked()){o=step(o,large,'transport',{transport:'Тестовая машина',pickup:'2026-10-15'});o=step(o,warehouse,'confirmTransport');o=step(o,warehouse,'load');o=step(o,warehouse,'load');o=step(o,warehouse,'ship');o=step(o,large,'largeReceived');o=step(o,large,'smallSent');o=step(o,small,'smallReceived');o=step(o,small,'storeSent');o=step(o,store,'storeReceived');return step(o,store,'customerReceived');}

test('Пустой старт и последовательное поступление на завод',()=>{
  assert.deepEqual(seed(),{orders:[],claims:[],notifications:[]});let o=order();
  assert.equal(visible(o,'factory',manager.org),false);assert.equal(visible(o,'large',large.org),false);
  assert.throws(()=>step(o,large,'forward'));assert.throws(()=>step(o,manager,'open'));
  o=step(o,small,'forward');assert.equal(o.stage,'large');assert.throws(()=>step(o,small,'forward'));
  o=step(o,large,'forward');assert.equal(o.stage,'checking');assert.ok(o.receivedAt);assert.ok(visible(o,'factory',manager.org));
  assert.throws(()=>step(o,warehouse,'open'));
});
test('Условия возвращаются через оптовиков, запуск требует всех подтверждений',()=>{
  let o=approved();assert.throws(()=>step(o,store,'confirmBuyer'));assert.throws(()=>step(o,manager,'production'));
  assert.throws(()=>step(o,large,'quote',{price:-1}));o=step(o,large,'quote',{price:92000});
  assert.throws(()=>step(o,large,'confirmLarge'));o=step(o,small,'quote',{price:99000});
  assert.deepEqual(commercialTerms(o,'store'),[['Цена поставщика для магазина',99000]]);
  assert.deepEqual(commercialTerms(o,'small').map(x=>x[1]),[92000,99000]);
  assert.deepEqual(commercialTerms(o,'large').map(x=>x[1]),[85000,92000]);
  o=step(o,store,'confirmBuyer');assert.throws(()=>step(o,large,'confirmLarge'));
  o=step(o,small,'confirmSmall');o=step(o,large,'confirmLarge');o=step(o,manager,'production');
  assert.equal(o.stage,'production');assert.equal(o.sourceId,'1С-ПЗ-3251');
});
test('Склад, назначение транспорта и вывоз требуют отдельных действий',()=>{
  let o=production();assert.throws(()=>step(o,manager,'scan'));assert.throws(()=>step(o,warehouse,'warehouse'));
  o=step(o,warehouse,'scan');assert.throws(()=>step(o,warehouse,'warehouse'));o=step(o,warehouse,'scan');o=step(o,warehouse,'warehouse');
  o=step(o,large,'transport',{transport:'Тест',pickup:'2026-10-14'});assert.equal(o.stage,'warehouse');
  assert.throws(()=>step(o,warehouse,'load'));o=step(o,warehouse,'confirmTransport');assert.equal(o.stage,'shipping');
  o=step(o,warehouse,'load');assert.throws(()=>step(o,warehouse,'ship'));o=step(o,warehouse,'load');
  assert.throws(()=>step(o,warehouse,'load'));o=step(o,warehouse,'ship');assert.equal(o.stage,'shipped');
});
test('Доставка и документы независимы, закрытие только после подписания',()=>{
  let o=delivered();assert.equal(o.delivery,'customer_received');assert.equal(o.stage,'shipped');
  assert.throws(()=>step(o,manager,'close'));o=step(o,manager,'edo');assert.throws(()=>step(o,manager,'docSigned'));
  o=step(o,manager,'docSent');o=step(o,manager,'docWaiting');o=step(o,manager,'docSigned');o=step(o,manager,'close');
  assert.equal(o.stage,'closed');assert.equal(o.delivery,'customer_received');
});
test('Резерв считает будние дни и требует подтверждения повторного резерва заводом',()=>{
  assert.equal(businessDeadline(new Date('2026-10-16T09:00:00Z'),3),'2026-10-21T09:00:00.000Z');
  let o=stocked();assert.equal(expired(o,new Date('2026-10-20')),true);
  o=step(o,manager,'expire');assert.throws(()=>step(o,large,'transport',{transport:'Тест',pickup:'2026-10-15'}));
  o=step(o,manager,'release');o=step(o,large,'rereserve');assert.ok(o.reserveReleased);
  assert.throws(()=>step(o,large,'transport',{transport:'Тест',pickup:'2026-10-15'}));
  o=step(o,manager,'reserve');assert.equal(o.reserveReleased,false);assert.equal(expired(o,now),false);
});
test('Возврат и отклонение сохраняют причину; чужой участник не может действовать',()=>{
  let o=order();o=step(o,small,'forward');o=step(o,large,'forward');o=step(o,manager,'open');
  assert.throws(()=>step(o,manager,'revision'));o=step(o,manager,'revision',{comment:'Уточните размеры'});
  assert.equal(o.stage,'revision');assert.match(o.history.at(-1).text,/Уточните размеры/);
  assert.ok(allowedActions(o,store).includes('fix'));assert.equal(allowedActions(o,{...store,org:'Чужой магазин'}).length,0);
});
test('Рекламация проходит оба звена, создаёт отдельный приоритетный заказ и закрывается после замены',()=>{
  const original=delivered();const c={id:'R-test',orderId:original.id,part:'Дверца',description:'Повреждение',qty:1,status:'new',route:'small',created:now.toISOString()};
  let state={orders:[original],claims:[c],notifications:[]};assert.equal(claimVisible(c,manager),false);
  assert.throws(()=>changeClaim(state,c.id,manager,'accept',now));state=changeClaim(state,c.id,small,'forward',now);
  assert.throws(()=>changeClaim(state,c.id,manager,'accept',now));state=changeClaim(state,c.id,large,'forward',now);
  assert.throws(()=>changeClaim(state,c.id,warehouse,'accept',now));state=changeClaim(state,c.id,manager,'accept',now);
  const replacement=state.orders.find(o=>o.claimId===c.id);assert.equal(replacement.stage,'production');assert.equal(replacement.kind,'claim');assert.equal(replacement.scanned,0);
  assert.throws(()=>changeClaim(state,c.id,manager,'accept',now));assert.throws(()=>changeClaim(state,c.id,store,'finish',now));
  let o=step(replacement,warehouse,'scan');o=step(o,warehouse,'warehouse');o=step(o,large,'transport',{transport:'Тест',pickup:'2026-10-15'});o=step(o,warehouse,'confirmTransport');o=step(o,warehouse,'load');o=step(o,warehouse,'ship');o=step(o,large,'largeReceived');o=step(o,large,'smallSent');o=step(o,small,'smallReceived');o=step(o,small,'storeSent');o=step(o,store,'storeReceived');o=step(o,store,'customerReceived');
  state.orders=state.orders.map(x=>x.id===o.id?o:x);assert.throws(()=>changeClaim(state,c.id,large,'finish',now));state=changeClaim(state,c.id,store,'finish',now);assert.equal(state.claims[0].status,'fulfilled');
});
test('Готовая рекламационная отгрузка имеет приоритет над обычной',()=>{
  let o=stocked();o=step(o,large,'transport',{transport:'Тест',pickup:'2026-10-15'});o=step(o,warehouse,'confirmTransport');o=step(o,warehouse,'load');o=step(o,warehouse,'load');
  const claim={...o,id:'R-priority',kind:'claim'};assert.throws(()=>step(o,warehouse,'ship',{},[claim]));assert.ok(allowedActions(claim,warehouse,[o]).includes('ship'));
});
