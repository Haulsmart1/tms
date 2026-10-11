export function modalTabTarget<T>(controls:readonly T[],active:T|null,panel:T,backwards:boolean):T|null{
 if(!controls.length)return panel;
 if(backwards&&(active===controls[0]||active===panel))return controls[controls.length-1];
 if(!backwards&&(active===controls[controls.length-1]||active===panel))return controls[0];
 return null;
}
