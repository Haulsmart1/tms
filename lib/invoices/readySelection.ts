import {toPence} from './money';
export interface ReadySelectionJob {customer_id:string;currency_code:string|null;customer_price:number|null;requires_po:boolean}
export function readySelection(jobs:readonly ReadySelectionJob[],poReference:string){
 const customers=new Set(jobs.map(j=>j.customer_id));const currencies=new Set(jobs.map(j=>(j.currency_code||'GBP').trim().toUpperCase()));
 const reason=!jobs.length?'Choose at least one completed job.':customers.size!==1?'All selected jobs must belong to the same customer.':currencies.size!==1?'Select jobs in one currency; create separate invoices for different currencies.':jobs.some(j=>j.customer_price===null||!Number.isFinite(j.customer_price)||j.customer_price<0)?'Add a valid customer price to each selected job.':jobs.some(j=>j.requires_po)&&!poReference.trim()?'Add the customer PO reference before invoicing.':null;
 return{reason,currency:currencies.size===1?[...currencies][0]:null,total:jobs.reduce((sum,j)=>sum+toPence(j.customer_price),0)/100};
}
