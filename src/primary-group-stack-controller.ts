import {setIcon} from 'obsidian';
import type {BoardResizeBinding} from './board-layout';
import {RowDragScroll} from './row-drag-scroll';
import {readPrimaryStackLayouts,reconcilePrimaryStackBoard,projectPrimaryStackBoard,movePrimaryStackGroup,setPrimaryStackWidth,reorderPrimarySingletons,type PrimaryStackBoard,type PrimaryStackEdge} from './primary-group-stacks';

const DRAG_TYPE='application/x-nosygrid-primary-group';
interface Target {id:string;edge:PrimaryStackEdge;element:HTMLElement;column:HTMLElement}
export class PrimaryGroupStacks {
  private scope='';
  private board:PrimaryStackBoard={columns:[]};
  private visible:PrimaryStackBoard={columns:[]};
  private host?:HTMLElement;
  private drag?:{id:string;element:HTMLElement;instance:string};
  private point?:{x:number;y:number};
  private frame=0;
  private scroll:RowDragScroll;
  private doc:Document;
  get active(){return !!this.drag;}
  constructor(private root:HTMLElement,private get:()=>unknown,private save:(value:unknown)=>void,private changed:()=>void,private report:(error:unknown)=>void,private canMove:()=>boolean) {
    this.doc=root.ownerDocument;this.scroll=new RowDragScroll(root);
    root.addEventListener('dragover',this.over,true);root.addEventListener('drop',this.drop,true);
    this.doc.addEventListener('dragend',this.cancel,true);this.doc.addEventListener('keydown',this.key,true);this.doc.defaultView?.addEventListener('blur',this.cancel);
  }
  begin(scope:string,order:string[],visible:string[],removed:string[],legacyWidth:(id:string)=>number|undefined){
    this.cancel();this.scope=scope;this.host=undefined;
    const saved=readPrimaryStackLayouts(this.get()).boards[scope];
    this.board=reconcilePrimaryStackBoard(saved,order,removed,legacyWidth);this.visible=projectPrimaryStackBoard(this.board,visible);
  }
  projection(ids:string[]){return projectPrimaryStackBoard(this.board,ids);}
  flat(){return this.board.columns.flatMap(column=>column.groups);}
  get singletons(){return this.board.columns.every(column=>column.groups.length===1);}
  registerBoard(host:HTMLElement){this.host=host;host.dataset.primaryBoard='true';}
  registerColumn(element:HTMLElement,id:string){element.dataset.primaryColumn=id;}
  resizeBinding(columnId:string,wrapper:HTMLElement):BoardResizeBinding {
    return {key:JSON.stringify([this.scope,columnId]),target:wrapper,get:()=>this.board.columns.find(column=>column.id===columnId)?.width,save:width=>this.commit(setPrimaryStackWidth(this.board,columnId,width),false)};
  }
  reorderSingletons(ids:string[]){this.commit(reorderPrimarySingletons(this.board,ids),false);}
  group(element:HTMLElement,id:string,label:string,header:HTMLElement){
    element.dataset.primaryGroup=id;
    const handle=header.createEl('button',{cls:'manual-order-group-move',attr:{type:'button','aria-label':`Move primary group: ${label}`,title:'Drag to arrange groups. Alt + arrow keys move this group.'}});
    handle.dataset.orderController='primary';setIcon(handle,'grip-vertical');
    handle.onclick=event=>{event.preventDefault();event.stopPropagation();};
    handle.ondragstart=event=>{
      if(!this.canMove()){event.preventDefault();return;}
      event.stopImmediatePropagation();this.cancel();this.scroll.lock();this.drag={id,element,instance:element.dataset.groupKey!};element.classList.add('is-group-dragging');this.root.classList.add('manual-order-reordering-groups');
      event.dataTransfer?.setData(DRAG_TYPE,id);if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setDragImage(header,20,15);}
    };
    handle.onkeydown=event=>{
      if(!event.altKey||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)||!this.canMove())return;
      event.preventDefault();event.stopPropagation();const ci=this.visible.columns.findIndex(column=>column.groups.includes(id)),column=this.visible.columns[ci];if(!column)return;
      const index=column.groups.indexOf(id);let target:string|undefined,edge:PrimaryStackEdge;
      if(event.key==='ArrowUp'||event.key==='ArrowDown'){const down=event.key==='ArrowDown';target=column.groups[index+(down?1:-1)];edge=down?'below':'above';}
      else {const rtl=this.doc.defaultView?.getComputedStyle(this.host??element).direction==='rtl',forward=(event.key==='ArrowRight')!==rtl,adjacent=this.visible.columns[ci+(forward?1:-1)];target=adjacent?.groups.at(-1)??id;edge=adjacent?'below':forward?'after-column':'before-column';}
      if(target)this.move(id,target,edge,element.dataset.groupKey!);
    };
    this.updateControls();
  }
  updateControls(){for(const handle of this.root.querySelectorAll<HTMLButtonElement>('[data-order-controller="primary"]')){handle.disabled=!this.canMove();handle.draggable=!handle.disabled;}}
  private target(x:number,y:number):Target|undefined {
    if(!this.drag||!this.host)return;
    let element=this.doc.elementFromPoint(x,y)?.closest<HTMLElement>('[data-primary-group]');
    if(!element||!this.host.contains(element)) {
      // A drop just outside a group is still an edge drop. Limit the hit area so
      // drops elsewhere in the view remain invalid.
      const margin=32;let best=Infinity;element=null;
      for(const candidate of this.host.querySelectorAll<HTMLElement>('[data-primary-group]')) {
        const rect=candidate.getBoundingClientRect();
        const dx=Math.max(rect.left-x,0,x-rect.right),dy=Math.max(rect.top-y,0,y-rect.bottom);
        if(dx>margin||dy>margin)continue;
        const distance=dx*dx+dy*dy;if(distance<best){best=distance;element=candidate;}
      }
    }
    if(!element)return;
    const column=element.parentElement;if(!column?.dataset.primaryColumn)return;
    const box=element.getBoundingClientRect(),dist=[Math.abs(x-box.left),Math.abs(x-box.right),Math.abs(y-box.top),Math.abs(y-box.bottom)],min=Math.min(...dist);
    const rtl=this.doc.defaultView?.getComputedStyle(this.host).direction==='rtl';
    const edge:PrimaryStackEdge=dist[0]===min?(rtl?'after-column':'before-column'):dist[1]===min?(rtl?'before-column':'after-column'):dist[2]===min?'above':'below';
    return {id:element.dataset.primaryGroup!,edge,element,column};
  }
  private clear(){this.root.querySelectorAll('.primary-stack-above,.primary-stack-below,.primary-stack-before,.primary-stack-after').forEach(el=>el.classList.remove('primary-stack-above','primary-stack-below','primary-stack-before','primary-stack-after'));}
  private show(target?:Target){this.clear();if(!target)return;const edge=target.edge;if(edge==='above'||edge==='below'){target.element.style.setProperty('--primary-indicator-width',`${target.column.getBoundingClientRect().width}px`);target.element.classList.add(`primary-stack-${edge}`);}else target.column.classList.add(edge==='before-column'?'primary-stack-before':'primary-stack-after');}
  private tick=()=>{
    this.frame=0;if(!this.drag||!this.point)return;
    const box=this.root.getBoundingClientRect(),margin=48,speed=(v:number,lo:number,hi:number)=>v<lo+margin?-Math.ceil((lo+margin-v)/6):v>hi-margin?Math.ceil((v-hi+margin)/6):0;
    const dx=speed(this.point.x,box.left,box.right),dy=speed(this.point.y,box.top,box.bottom);if(dx||dy){this.scroll.pan(dx,dy);this.show(this.target(this.point.x,this.point.y));this.frame=this.doc.defaultView?.requestAnimationFrame(this.tick)??0;}
  };
  private over=(event:DragEvent)=>{if(!this.drag)return;event.stopImmediatePropagation();this.point={x:event.clientX,y:event.clientY};const target=this.target(event.clientX,event.clientY);this.show(target);if(target){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';}else if(event.dataTransfer)event.dataTransfer.dropEffect='none';if(!this.frame)this.frame=this.doc.defaultView?.requestAnimationFrame(this.tick)??0;};
  private drop=(event:DragEvent)=>{const drag=this.drag;if(!drag)return;event.preventDefault();event.stopImmediatePropagation();const target=this.target(event.clientX,event.clientY);this.cancel();if(target&&this.canMove())this.move(drag.id,target.id,target.edge,drag.instance);};
  private move(id:string,target:string,edge:PrimaryStackEdge,instance:string){
    const source=this.board.columns.find(column=>column.groups.includes(id));const wrapper=[...this.root.querySelectorAll<HTMLElement>('[data-primary-column]')].find(el=>el.dataset.primaryColumn===source?.id);
    const width=source?.width??(wrapper?Math.round(wrapper.getBoundingClientRect().width):undefined),newId=`stack-${globalThis.crypto.randomUUID()}`;
    const next=movePrimaryStackGroup(this.board,id,target,edge,{id:newId,width});if(next===this.board)return;
    try{this.commit(next);}catch{return;}[...this.root.querySelectorAll<HTMLElement>('[data-group-key]')].find(el=>el.dataset.groupKey===instance)?.querySelector<HTMLElement>('[data-order-controller="primary"]')?.focus({preventScroll:true});
  }
  private commit(next:PrimaryStackBoard,refresh=true){
    if(next===this.board)return;const previous=this.get(),layouts=readPrimaryStackLayouts(previous);layouts.boards[this.scope]=next;
    try{this.save(layouts);this.board=next;if(refresh)this.changed();}
    catch(error){try{this.save(previous??null);}catch(rollback){console.error('NosyGrid: could not restore primary stacks.',rollback);}this.report(error);this.changed();throw error;}
  }
  cancel=()=>{this.drag?.element.classList.remove('is-group-dragging');this.drag=undefined;this.point=undefined;this.root.classList.remove('manual-order-reordering-groups');this.clear();if(this.frame)this.doc.defaultView?.cancelAnimationFrame(this.frame);this.frame=0;this.scroll.unlock();};
  private key=(event:KeyboardEvent)=>{if(this.drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.cancel();}};
  destroy(){this.cancel();this.scroll.destroy();this.root.removeEventListener('dragover',this.over,true);this.root.removeEventListener('drop',this.drop,true);this.doc.removeEventListener('dragend',this.cancel,true);this.doc.removeEventListener('keydown',this.key,true);this.doc.defaultView?.removeEventListener('blur',this.cancel);}
}
