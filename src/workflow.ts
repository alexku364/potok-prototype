import {type Order, type Role, type Stage, type Event, type Claim, type State, visible} from './data';

export type Actor={id:string;role:Role;name:string;org:string};
export type Input={price?:number;planned?:string;boxes?:number;reserveDays?:number;comment?:string;transport?:string;pickup?:string};
export type Action=keyof typeof actionLabels;
export const actionLabels={
  forward:'Передать поставщику',open:'Взять в обработку',approve:'Предложить цену и срок',
  revision:'Вернуть на исправление',reject:'Отклонить заявку',fix:'Исправить заявку',
  quote:'Передать условия клиенту',confirmBuyer:'Подтвердить согласие покупателя',
  confirmSmall:'Подтвердить обязательства перед крупным оптовиком',confirmLarge:'Подтвердить заказ заводу',
  production:'Создать производственное задание (1С)',scan:'Сканировать коробку',warehouse:'Принять все коробки на склад',
  transport:'Назначить транспорт',confirmTransport:'Подтвердить вывоз',expire:'Имитировать просрочку вывоза',
  release:'Снять резерв и перевести в свободный остаток',rereserve:'Запросить повторное резервирование',reserve:'Подтвердить повторный резерв',
  load:'Погрузить и сканировать коробку',ship:'Подтвердить отгрузку',largeReceived:'Подтвердить получение от завода',
  smallSent:'Отправить мелкому оптовику',smallReceived:'Подтвердить получение от крупного оптовика',storeSent:'Отправить в магазин',
  storeReceived:'Подтвердить получение в магазине',customerReceived:'Передать покупателю',
  edo:'Оформить закрывающие документы',docSent:'Отправить документы в ЭДО',docWaiting:'Ожидать подписания',docSigned:'Подтвердить подписание',close:'Закрыть заказ',
} as const;

export function businessDeadline(from:Date,days:number):string{
  const d=new Date(from);let remaining=days;
  while(remaining>0){d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6)remaining--;}
  return d.toISOString();
}
export function expired(o:Order,now=new Date()){return Boolean(o.reserveExpired||(!o.transport&&o.reserveUntil&&now.getTime()>Date.parse(o.reserveUntil)));}
export function allowedActions(o:Order,a:Actor,orders:Order[]=[],now=new Date()):Action[]{
  if(!visible(o,a.role,a.org))return [];
  const manager=a.id==='factory',warehouse=a.id==='warehouse';const result:Action[]=[];
  if((a.role==='small'&&o.stage==='small')||(a.role==='large'&&o.stage==='large'))result.push('forward');
  if(manager&&o.stage==='checking'&&o.receivedAt)result.push('open');
  if(manager&&o.stage==='processing')result.push('approve','revision','reject');
  if(a.role==='store'&&o.stage==='revision')result.push('fix');
  if(o.stage==='approval'){
    if((a.role==='large'&&o.termsTo==='large')||(a.role==='small'&&o.termsTo==='small'))result.push('quote');
    if(a.role==='store'&&o.termsTo==='store'&&!o.buyerConfirmed)result.push('confirmBuyer');
    if(a.role==='small'&&o.buyerConfirmed&&!o.smallConfirmed)result.push('confirmSmall');
    if(a.role==='large'&&o.smallConfirmed&&!o.largeConfirmed)result.push('confirmLarge');
    if(manager&&o.largeConfirmed&&o.smallConfirmed&&o.buyerConfirmed)result.push('production');
  }
  if(warehouse&&o.stage==='production'){if(o.scanned<o.boxes)result.push('scan');else result.push('warehouse');}
  if(o.stage==='warehouse'){
    if(a.role==='large'&&!o.reserveReleased&&!expired(o,now)&&!o.transport)result.push('transport');
    if(warehouse&&o.transport&&!o.reserveReleased)result.push('confirmTransport');
    if(manager&&!o.transport&&!o.reserveReleased){if(!expired(o,now))result.push('expire');else result.push('release');}
    if(a.role==='large'&&o.reserveReleased&&!o.reserveRequested)result.push('rereserve');
    if(manager&&o.reserveReleased&&o.reserveRequested)result.push('reserve');
  }
  if(warehouse&&o.stage==='shipping'&&!o.reserveReleased&&o.transportConfirmed){
    if(o.loaded<o.boxes)result.push('load');
    else if(o.kind==='claim'||!orders.some(x=>x.id!==o.id&&x.kind==='claim'&&x.stage==='shipping'&&x.loaded===x.boxes))result.push('ship');
  }
  if(['shipped','edo','closed'].includes(o.stage)){
    if(a.role==='large'&&o.delivery==='factory')result.push('largeReceived');
    if(a.role==='large'&&o.delivery==='large_received')result.push('smallSent');
    if(a.role==='small'&&o.delivery==='small_sent')result.push('smallReceived');
    if(a.role==='small'&&o.delivery==='small_received')result.push('storeSent');
    if(a.role==='store'&&o.delivery==='store_sent')result.push('storeReceived');
    if(a.role==='store'&&o.delivery==='store_received')result.push('customerReceived');
  }
  if(manager&&o.stage==='shipped')result.push('edo');
  if(manager&&o.stage==='edo')result.push(({draft:'docSent',sent:'docWaiting',waiting:'docSigned',signed:'close'} as const)[o.documents]);
  return result;
}

export function transition(o:Order,a:Actor,action:Action,input:Input={},orders:Order[]=[],now=new Date()):{change:Partial<Order>;event:Event}{
  if(!allowedActions(o,a,orders,now).includes(action))throw new Error('Это действие сейчас недоступно для выбранного сотрудника');
  const at=now.toISOString();let change:Partial<Order>={};let text:string=actionLabels[action];
  const stage=(s:Stage)=>{change.stage=s;};
  switch(action){
    case 'forward': if(o.stage==='small'){stage('large');text='Мелкий оптовик передал заявку крупному оптовику';}else{stage('checking');change.receivedAt=at;text='Завод получил заявку от крупного оптовика';}break;
    case 'open':stage('processing');change.openedAt=at;text='Менеджер завода начал проверку комплектации';break;
    case 'approve':
      if(!input.price||!Number.isFinite(input.price)||input.price<=0||!input.planned||input.planned<at.slice(0,10)||!Number.isInteger(input.boxes)||input.boxes!<1||![3,4,5].includes(input.reserveDays!))throw new Error('Укажите цену, будущую дату готовности, количество коробок и 3–5 рабочих дней резерва');
      change={stage:'approval',termsTo:'large',price:input.price,planned:input.planned,boxes:input.boxes,reserveDays:input.reserveDays};text='Завод предложил крупному оптовику цену и срок';break;
    case 'quote':
      if(!input.price||!Number.isFinite(input.price)||input.price<=0)throw new Error('Укажите положительную цену для своего клиента');
      change=a.role==='large'?{largePrice:input.price,termsTo:'small'}:{smallPrice:input.price,termsTo:'store'};text=a.role==='large'?'Крупный оптовик передал условия мелкому оптовику':'Мелкий оптовик передал условия магазину';break;
    case 'revision':case 'reject':
      if(!input.comment?.trim())throw new Error('Укажите причину');stage(action==='revision'?'revision':'rejected');text=`${action==='revision'?'Завод вернул заявку на исправление':'Завод отклонил заявку'}: ${input.comment.trim()}`;break;
    case 'fix':throw new Error('Исправьте комплектацию в форме заявки');
    case 'confirmBuyer':change.buyerConfirmed=true;break;
    case 'confirmSmall':change.smallConfirmed=true;break;
    case 'confirmLarge':change.largeConfirmed=true;break;
    case 'production':change={stage:'production',confirmed:true,sourceId:`1С-ПЗ-${o.id}`};text='1С (имитация): создано производственное задание';break;
    case 'scan':change.scanned=o.scanned+1;text=`На складе просканирована коробка ${o.scanned+1} из ${o.boxes}`;break;
    case 'warehouse':change={stage:'warehouse',reserveUntil:businessDeadline(now,o.reserveDays)};text=`Все ${o.boxes} коробок приняты на склад. Начался срок резерва`;break;
    case 'transport':
      if(!input.transport?.trim()||!input.pickup||input.pickup<at.slice(0,10))throw new Error('Укажите машину и дату вывоза не раньше сегодняшней');
      change={transport:input.transport.trim(),pickup:input.pickup,transportConfirmed:false};text='Крупный оптовик назначил машину и дату вывоза';break;
    case 'confirmTransport':change={stage:'shipping',transportConfirmed:true};text='Кладовщик подтвердил вывоз. Заказ готов к отгрузке';break;
    case 'expire':change.reserveExpired=true;text='Демо: истекли согласованные рабочие дни для назначения машины';break;
    case 'release':change={reserveReleased:true,reserveExpired:true};text='Завод снял резерв, товар переведён в свободный остаток';break;
    case 'rereserve':change.reserveRequested=true;text='Крупный оптовик запросил повторное резервирование';break;
    case 'reserve':change={reserveReleased:false,reserveRequested:false,reserveExpired:false,reserveUntil:businessDeadline(now,o.reserveDays)};text='Завод подтвердил повторный резерв';break;
    case 'load':change.loaded=o.loaded+1;text=`Погружена и просканирована коробка ${o.loaded+1} из ${o.boxes}`;break;
    case 'ship':change={stage:'shipped',delivery:'factory'};text='Все коробки отгружены со склада производителя';break;
    case 'largeReceived':change.delivery='large_received';break;
    case 'smallSent':change.delivery='small_sent';break;
    case 'smallReceived':change.delivery='small_received';break;
    case 'storeSent':change.delivery='store_sent';break;
    case 'storeReceived':change.delivery='store_received';break;
    case 'customerReceived':change.delivery='customer_received';text='Магазин подтвердил передачу покупателю';break;
    case 'edo':change={stage:'edo',documents:'draft'};text='Завод оформил закрывающие документы (имитация)';break;
    case 'docSent':change.documents='sent';break;
    case 'docWaiting':change.documents='waiting';break;
    case 'docSigned':change.documents='signed';text='Документы подписаны в ЭДО (имитация)';break;
    case 'close':stage('closed');text='Завод закрыл заказ после подписания документов';break;
  }
  return {change,event:{at,actor:a.name,text}};
}

export function commercialTerms(o:Order,role:Role):[string,number|undefined][]{
  if(role==='factory')return [['Цена для крупного оптовика',o.price]];
  if(role==='large')return [['Цена завода для вас',o.price],['Ваша цена мелкому оптовику',o.largePrice]];
  if(role==='small')return [['Цена крупного оптовика для вас',o.largePrice],['Ваша цена магазину',o.smallPrice]];
  return [['Цена поставщика для магазина',o.smallPrice]];
}

export function claimVisible(c:Claim,a:Actor){return c.status!=='new'||a.role==='store'||a.role==='small'||(a.role==='large'&&c.route!=='small')||(a.role==='factory'&&c.route==='factory');}
export function changeClaim(state:State,cid:string,a:Actor,action:'forward'|'accept'|'finish',now=new Date()):State{
  const c=state.claims.find(x=>x.id===cid);const original=state.orders.find(x=>x.id===c?.orderId);
  if(!c||!original||!visible(original,a.role,a.org)||!claimVisible(c,a))throw new Error('Рекламация недоступна');
  let updated={...c};let orders=[...state.orders];let text='';let target:Role='store';const at=now.toISOString();
  if(action==='forward'&&c.status==='new'&&((a.role==='small'&&c.route==='small')||(a.role==='large'&&c.route==='large'))){
    updated.route=c.route==='small'?'large':'factory';target=updated.route; text=`Рекламация ${c.id} передана ${target==='large'?'крупному оптовику':'заводу'}`;
  }else if(action==='accept'&&c.status==='new'&&c.route==='factory'&&a.id==='factory'){
    const replacementId=`${c.id}-ПЗ`;updated={...c,status:'accepted',replacementId};
    const event={at,actor:a.name,text:`Рекламация ${c.id} принята. Создан приоритетный заказ ${replacementId}`};
    orders.unshift({id:replacementId,kind:'claim',claimId:c.id,sourceId:`1С-ПЗ-${replacementId}`,shop:original.shop,small:original.small,large:original.large,customer:original.customer,items:[{...original.items[0],name:c.part,qty:c.qty,price:0}],stage:'production',delivery:'factory',created:at,updated:at,receivedAt:at,openedAt:at,confirmed:true,buyerConfirmed:true,smallConfirmed:true,largeConfirmed:true,planned:original.planned,boxes:c.qty,scanned:0,loaded:0,reserveDays:original.reserveDays,documents:'draft',history:[event]});
    text=event.text;
  }else if(action==='finish'&&c.status==='accepted'&&a.role==='store'&&orders.find(o=>o.id===c.replacementId)?.delivery==='customer_received'){
    updated.status='fulfilled';text=`Магазин подтвердил замену детали и исполнение рекламации ${c.id}`;
  }else throw new Error('Сначала завершите предыдущий шаг рекламации');
  orders=orders.map(o=>o.id===original.id?{...o,updated:at,history:[...o.history,{at,actor:a.name,text}]}:o);
  return {...state,orders,claims:state.claims.map(x=>x.id===c.id?updated:x),notifications:[{id:`${cid}-${action}-${now.getTime()}`,role:target,text,orderId:original.id,read:false},...state.notifications]};
}
