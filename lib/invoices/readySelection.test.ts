import{it,expect}from'vitest';import{readySelection}from'./readySelection';
const job={customer_id:'a',currency_code:'GBP',customer_price:1.005,requires_po:false};
it('never consolidates different customer currencies or hides missing PO/prices',()=>{expect(readySelection([job,{...job,currency_code:'EUR'}],'').reason).toMatch(/currency/);expect(readySelection([{...job,requires_po:true}],'').reason).toMatch(/PO/);expect(readySelection([{...job,customer_price:null}],'').reason).toMatch(/price/);expect(readySelection([job,{...job,customer_id:'b'}],'').reason).toMatch(/same customer/);});
it('sums per-job rounded pennies rather than binary floating amounts',()=>{expect(readySelection([job,job],'').total).toBe(2.02);});
