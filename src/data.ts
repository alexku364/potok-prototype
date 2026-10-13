export type Role='factory'|'large'|'small'|'store';
export type Stage='small'|'large'|'checking'|'processing'|'approval'|'production'|'warehouse'|'shipping'|'shipped'|'edo'|'closed'|'rejected'|'revision';
export type Delivery='factory'|'large_received'|'small_sent'|'small_received'|'store_sent'|'store_received'|'customer_received';
export type Item={sku:string;name:string;qty:number;price:number};
export type Event={at:string;actor:string;text:string};
export type Claim={id:string;orderId:string;part:string;description:string;qty:number;status:'new'|'accepted'|'fulfilled';route:'small'|'large'|'factory';replacementId?:string;created:string};
export type Order={id:string;kind:'normal'|'claim';sourceId?:string;claimId?:string;termsTo?:'large'|'small'|'store';largePrice?:number;smallPrice?:number;reserveUntil?:string;reserveRequested?:boolean;transportConfirmed?:boolean;shop:string;small:string;large:string;customer:string;items:Item[];stage:Stage;delivery:Delivery;created:string;updated:string;receivedAt?:string;openedAt?:string;confirmed?:boolean;buyerConfirmed?:boolean;smallConfirmed?:boolean;largeConfirmed?:boolean;planned?:string;price?:number;boxes:number;scanned:number;loaded:number;transport?:string;pickup?:string;reserveDays:number;reserveExpired?:boolean;reserveReleased?:boolean;documents:'draft'|'sent'|'waiting'|'signed';history:Event[]};
export type State={orders:Order[];claims:Claim[];notifications:{id:string;role:Role;text:string;orderId:string;read:boolean}[]};
export const stages:Stage[]=['checking','processing','approval','production','warehouse','shipping','shipped','edo','closed'];
export const stageLabels:Record<Stage,string>={small:'Передана мелкому оптовику',large:'Передана крупному оптовику',checking:'Заявка на проверке',processing:'Заявка в обработке',approval:'Заявка на согласовании',production:'Заказ в производстве',warehouse:'Готов на складе',shipping:'Готов к отгрузке',shipped:'Отгружен со склада производителя',edo:'Ожидает закрывающих документов',closed:'Заказ закрыт',rejected:'Отклонена',revision:'На исправлении'};
export const deliveryStages:Delivery[]=['factory','large_received','small_sent','small_received','store_sent','store_received','customer_received'];
export const deliveryLabels:Record<Delivery,string>={factory:'У производителя',large_received:'Получен крупным оптовиком',small_sent:'Отправлен мелкому оптовику',small_received:'Получен мелким оптовиком',store_sent:'Отправлен в магазин',store_received:'Получен магазином',customer_received:'Передан покупателю'};
export const roles:{id:string;role:Role;name:string;org:string;description:string}[]=[
  {id:'factory',role:'factory',name:'Анна Морозова',org:'Фабрика «Вектор», Пенза',description:'Менеджер производителя'},
  {id:'warehouse',role:'factory',name:'Игорь Волков',org:'Фабрика «Вектор», Пенза',description:'Кладовщик'},
  {id:'large',role:'large',name:'Екатерина Лебедева',org:'СибирьМебель, Иркутск',description:'Крупный оптовик'},
  {id:'small1',role:'small',name:'Павел Орлов',org:'БайкалТрейд, Иркутск',description:'Мелкий оптовик'},
  {id:'store1',role:'store',name:'Мария Иванова',org:'Мебельный дом, Иркутск',description:'Продавец магазина'},
];
export const catalog:Item[]=Array.from({length:42},(_,i)=>{const names=['Кухня модульная','Комод','Тумба прикроватная','Кровать 160×200','Стеллаж','Письменный стол','Полка настенная','Шкаф-купе','Тумба ТВ','Обеденный стол','Пенал','Фасад мебельный','Комплект направляющих','Столешница'];return{sku:`M-${String(1001+i)}`,name:`${names[i%names.length]} · ${['Дуб натуральный','Белый матовый','Орех','Графит'][Math.floor(i/14)%4]}`,qty:1,price:2500+(i%14)*1450}});
const now=()=>new Date().toISOString();
export const makeEvent=(actor:string,text:string):Event=>({at:now(),actor,text});
export function seed():State{return{orders:[],claims:[],notifications:[]}};
export function visible(o:Order,role:Role,org:string){if(role==='factory')return Boolean(o.receivedAt);if(role==='large')return o.stage!=='small';if(role==='small')return o.small===org;return o.shop===org}
export function total(o:Order){return o.items.reduce((sum,i)=>sum+i.price*i.qty,0)}
