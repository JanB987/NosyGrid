import {setIcon} from 'obsidian';
import type {BoardPlan} from './board-alignment';
import {RowDragScroll} from './row-drag-scroll';

export const BOARD_ORDER_KEY='manualVerticalGroupOrder';
const DRAG_TYPE='application/x-manual-order-bases-group';
export function readBoardOrders(value:unknown):Map<string,string[]> {
  if(!value||typeof value!=='object'||Array.isArray(value))return new Map();
  return new Map(Object.entries(value).flatMap(([scope,order])=>{
    if(!Array.isArray(order))return [];
    const slots=[...new Set(order.filter((slot):slot is string=>typeof slot==='string'))];return slots.length?[[scope,slots] as [string,string[]]]:[];
  }));
}
export function applyBoardOrder(slots:string[],saved:string[]=[]):string[] {
  const current=new Set(slots),ordered=[...new Set(saved)].filter(slot=>current.has(slot));
  const used=new Set(ordered);return [...ordered,...slots.filter(slot=>!used.has(slot))];
}
export function moveBoardSlot(slots:string[],source:string,target:string,after:boolean):string[] {
  if(source===target||!slots.includes(source)||!slots.includes(target))return [...slots];
  const next=slots.filter(slot=>slot!==source);next.splice(next.indexOf(target)+(after?1:0),0,source);return next;
}
function rememberOrder(previous:string[],current:string[]):string[] {
  const visible=new Set(current);let index=0;
  const result=previous.map(slot=>visible.has(slot)?current[index++]:slot);
  return [...result,...current.slice(index)];
}
interface GroupDrag {scope:string;slot:string;instance:string;element:HTMLElement}

/** Reorder the shared column slots, never the note values used to form the groups. */
export class BoardOrder {
  private plans=new Map<string,BoardPlan>();
  private drag?:GroupDrag;
  private saving=false;
  private scroll:RowDragScroll;
  private doc:Document;
  get active(){return !!this.drag;}
  constructor(private root:HTMLElement,private get:()=>unknown,private save:(value:Record<string,string[]>|null)=>void,private changed:()=>void,private report:(error:unknown)=>void,private canMove:()=>boolean=()=>true) {
    this.doc=root.ownerDocument;this.scroll=new RowDragScroll(root);
    root.addEventListener('dragover',this.over,true);root.addEventListener('drop',this.drop,true);
    this.doc.addEventListener('dragend',this.cancel,true);this.doc.addEventListener('keydown',this.key,true);this.doc.defaultView?.addEventListener('blur',this.cancel);
  }
  begin(plans:Map<string,BoardPlan>) {
    this.cancel();this.plans=plans;
    const saved=readBoardOrders(this.get());for(const [scope,plan]of plans)plan.slots=applyBoardOrder(plan.slots,saved.get(scope));
  }
  slots(scope:string){return this.plans.get(scope)?.slots??[];}
  column(element:HTMLElement,scope:string,slot:string,label:string,header:HTMLElement) {
    const handle=header.createEl('button',{cls:'manual-order-group-move',attr:{type:'button','aria-label':`Move vertical group: ${label}`,title:'Drag to reorder groups. Alt + Left/Right moves this group.'}});setIcon(handle,'grip-vertical');
    handle.draggable=this.slots(scope).length>1;handle.disabled=!handle.draggable||!this.canMove();
    handle.onclick=event=>{event.preventDefault();event.stopPropagation();};
    handle.ondragstart=event=>{
      if(!this.canMove()||this.slots(scope).length<2){event.preventDefault();return;}
      event.stopImmediatePropagation();this.cancel();this.scroll.lock();
      this.drag={scope,slot,instance:element.dataset.groupKey!,element};element.classList.add('is-group-dragging');
      this.root.classList.add('manual-order-reordering-groups');
      event.dataTransfer?.setData(DRAG_TYPE,JSON.stringify({scope,slot}));
      if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setDragImage(header,20,15);}
    };
    handle.onkeydown=event=>{
      if(!event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key)||!this.canMove())return;
      event.preventDefault();event.stopPropagation();
      const rtl=this.doc.defaultView?.getComputedStyle(element).direction==='rtl',forward=(event.key==='ArrowRight')!==rtl,slots=this.slots(scope),target=slots[slots.indexOf(slot)+(forward?1:-1)];
      if(target)this.reposition(scope,slot,target,forward,element.dataset.groupKey!);
    };
  }
  private target(event:DragEvent) {
    if(!this.drag)return;
    let element=(event.target as Element)?.closest?.<HTMLElement>('.manual-order-board-column');
    while(element) {
      const board=element.parentElement;
      if(board?.dataset.boardAlignmentKey===this.drag.scope) {
        const slot=element.dataset.groupWidthKey!;if(slot===this.drag.slot)return;
        const box=element.getBoundingClientRect(),rtl=this.doc.defaultView?.getComputedStyle(board).direction==='rtl';
        return {element,slot,after:rtl?event.clientX<box.left+box.width/2:event.clientX>=box.left+box.width/2};
      }
      element=element.parentElement?.closest<HTMLElement>('.manual-order-board-column')??null;
    }
  }
  private clearIndicators(){this.root.querySelectorAll('.manual-order-group-before,.manual-order-group-after').forEach(element=>element.classList.remove('manual-order-group-before','manual-order-group-after'));}
  private readonly over=(event:DragEvent)=>{
    if(!this.drag)return;
    event.stopImmediatePropagation();this.clearIndicators();const target=this.target(event);
    if(!target){if(event.dataTransfer)event.dataTransfer.dropEffect='none';return;}
    event.preventDefault();this.scroll.restore();target.element.classList.add(target.after?'manual-order-group-after':'manual-order-group-before');if(event.dataTransfer)event.dataTransfer.dropEffect='move';
  };
  private readonly drop=(event:DragEvent)=>{
    const drag=this.drag;if(!drag)return;
    event.preventDefault();event.stopImmediatePropagation();const target=this.target(event);this.finish();
    if(target&&this.canMove())this.reposition(drag.scope,drag.slot,target.slot,target.after,drag.instance);
    else this.scroll.unlock();
  };
  private finish(){this.drag?.element.classList.remove('is-group-dragging');this.drag=undefined;this.root.classList.remove('manual-order-reordering-groups');this.clearIndicators();}
  readonly cancel=()=>{this.finish();if(!this.saving)this.scroll.unlock();};
  private readonly key=(event:KeyboardEvent)=>{if(this.drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.cancel();}};
  private reposition(scope:string,source:string,target:string,after:boolean,instance:string) {
    const current=this.slots(scope),next=moveBoardSlot(current,source,target,after);
    if(JSON.stringify(current)===JSON.stringify(next)){this.scroll.unlock();return;}
    const saved=readBoardOrders(this.get());saved.set(scope,rememberOrder(saved.get(scope)??[],next));
    this.saving=true;
    try{this.save(Object.fromEntries(saved));this.changed();}
    catch(error){this.report(error);this.changed();}
    finally{this.saving=false;this.scroll.unlock();}
    [...this.root.querySelectorAll<HTMLElement>('[data-group-key]')].find(element=>element.dataset.groupKey===instance)?.querySelector<HTMLElement>(':scope > .manual-order-group-header > .manual-order-group-move')?.focus({preventScroll:true});
  }
  destroy(){this.cancel();this.scroll.destroy();this.root.removeEventListener('dragover',this.over,true);this.root.removeEventListener('drop',this.drop,true);this.doc.removeEventListener('dragend',this.cancel,true);this.doc.removeEventListener('keydown',this.key,true);this.doc.defaultView?.removeEventListener('blur',this.cancel);this.plans.clear();}
}
