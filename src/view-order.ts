import type {BasesViewConfig} from 'obsidian';
import type {Change,Row} from './order';
export const VIEW_RANKS_KEY='manualViewRanks';
export interface OrderEdit {owner:ViewOrder;check:()=>void;redo:()=>void;undo:()=>void}
function ranks(raw:unknown):Map<string,number> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return new Map();
  return new Map(Object.entries(raw).filter((entry):entry is [string,number]=>typeof entry[1]==='number'&&Number.isFinite(entry[1])));
}
function same(a:Map<string,number>|undefined,b:Map<string,number>|undefined):boolean {
  return a===undefined||b===undefined?a===b:a.size===b.size&&[...a].every(([path,rank])=>b.get(path)===rank);
}
/** Per-view order is independent of note properties after its first saved move. */
export class ViewOrder {
  private preview?:Map<string,number>;
  private cachedRaw:unknown=Symbol();
  private cached?:Map<string,number>;
  private receipts:{before:Map<string,number>|undefined;after:Map<string,number>}[]=[];
  constructor(private config:()=>BasesViewConfig,private refresh:()=>void,private exists:(path:string)=>boolean){}
  active(){return this.config().get('orderStorage')==='view';}
  invalidate(){this.cachedRaw=Symbol();}
  private saved():Map<string,number>|undefined {
    const raw:unknown=this.config().get(VIEW_RANKS_KEY);
    if(raw!==this.cachedRaw){this.cachedRaw=raw;this.cached=raw===undefined||raw===null?undefined:ranks(raw);}
    return this.cached;
  }
  rank(path:string,seed:number|undefined):number|undefined {const map=this.preview??this.saved();return map===undefined?seed:map.get(path);}
  private write(next:Map<string,number>|undefined) {
    this.preview=next??new Map();
    try {this.refresh();this.config().set(VIEW_RANKS_KEY,next===undefined?null:Object.fromEntries(next));}
    finally {this.preview=undefined;this.refresh();}
  }
  plan(rows:Row[],changes:Change[]):OrderEdit|undefined {
    if(!changes.length)return undefined;
    this.invalidate();
    const before=this.saved(),after=new Map(before??rows.flatMap(row=>row.rank===undefined?[]:[[row.path,row.rank] as const]));
    for(const path of after.keys())if(!this.exists(path))after.delete(path);
    for(const change of changes){if(change.after===undefined)after.delete(change.path);else after.set(change.path,change.after);}
    const receipt={before,after};this.receipts.push(receipt);if(this.receipts.length>50)this.receipts.shift();
    const check=(expected:Map<string,number>|undefined)=>{this.invalidate();if(!this.active()||!same(this.saved(),expected))throw new Error('The view order changed. Undo or reorder was cancelled.');};
    return {owner:this,check:()=>check(receipt.after),redo:()=>{check(receipt.before);this.write(receipt.after);},undo:()=>{check(receipt.after);this.write(receipt.before);}};
  }
  rename(oldPath:string,newPath:string) {
    if(oldPath===newPath)return;
    const migrate=(map:Map<string,number>|undefined)=>{if(map?.has(oldPath)){const value=map.get(oldPath)!;map.delete(oldPath);map.set(newPath,value);}};
    for(const receipt of this.receipts){migrate(receipt.before);migrate(receipt.after);}
    const current=this.saved();if(current?.has(oldPath)){migrate(current);this.config().set(VIEW_RANKS_KEY,Object.fromEntries(current));}
  }
}
