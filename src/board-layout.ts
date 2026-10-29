export const BOARD_WIDTHS_KEY='manualGroupWidths';
export const MIN_BOARD_WIDTH=240;
export const MAX_BOARD_WIDTH=2400;

export function readBoardWidths(value:unknown):Map<string,number> {
  if(!value||typeof value!=='object'||Array.isArray(value))return new Map();
  return new Map(Object.entries(value).filter((entry):entry is [string,number]=>typeof entry[1]==='number'&&Number.isFinite(entry[1])&&entry[1]>=MIN_BOARD_WIDTH&&entry[1]<=MAX_BOARD_WIDTH));
}
export function linkedBoardWidthKey(property:string,valueKey:string):string {return JSON.stringify(['group-width',property,valueKey]);}
function legacyWidthGroup(key:string):string|undefined {
  try {
    const path:unknown=JSON.parse(key);if(!Array.isArray(path)||path.length<2)return;
    const parts:unknown[]=path;const [property,value]=parts.slice(-2);
    if(typeof property==='string'&&/^(note|file|formula)\..+/.test(property)&&typeof value==='string')return linkedBoardWidthKey(property,value);
  } catch {/* Non-group keys from older versions are left alone. */}
}
interface Column {element:HTMLElement;handle?:HTMLElement;widthKey:string}
interface Resize {column:Column;key:string;pointer:number;x:number;width:number;current:number;originals:Map<Column,string>;direction:number}

/** Persist explicit column widths; responsive defaults and collapsed rails need no width entry. */
export class BoardLayout {
  private columns=new Map<string,Column>();
  private widths=new Map<string,number>();
  private legacy=new Map<string,number>();
  private drag?:Resize;
  private deferred=false;
  get active(){return !!this.drag;}
  deferRefresh(){this.deferred=true;}
  private doc:Document;

  constructor(private root:HTMLElement,private get:()=>unknown,private save:(value:Record<string,number>|null)=>void,private changed:()=>void,private report:(error:unknown)=>void,private canResize:()=>boolean=()=>true,private preview:()=>void=()=>{}) {
    this.doc=root.ownerDocument;
    this.doc.addEventListener('pointermove',this.move,{passive:false});this.doc.addEventListener('pointerup',this.up);
    this.doc.addEventListener('pointercancel',this.cancelPointer);this.doc.addEventListener('keydown',this.key,true);
    this.doc.defaultView?.addEventListener('blur',this.cancel);
  }

  private resolveLegacy(widths:Map<string,number>) {
    const resolved=new Map<string,number>();
    for(const [key,width]of widths){const shared=legacyWidthGroup(key);if(shared&&!widths.has(shared)&&!resolved.has(shared))resolved.set(shared,width);}
    return resolved;
  }
  begin(){this.columns.clear();this.widths=readBoardWidths(this.get());this.legacy=this.resolveLegacy(this.widths);}
  private savedWidth(key:string,widthKey:string){return this.widths.get(widthKey)??this.legacy.get(widthKey)??this.widths.get(key);}
  widthFor(widthKey:string){return this.widths.get(widthKey)??this.legacy.get(widthKey);}
  measure(){for(const [key,column]of this.columns)column.handle?.setAttribute('aria-valuenow',String(Math.round(column.element.getBoundingClientRect().width)||this.savedWidth(key,column.widthKey)||640));}
  private apply(widthKey:string,size:number|undefined) {
    for(const column of this.columns.values())if(column.widthKey===widthKey) {
      if(size===undefined)column.element.style.removeProperty('--manual-order-column-width');else column.element.style.setProperty('--manual-order-column-width',`${size}px`);
    }
    this.preview();this.measure();
  }

  column(element:HTMLElement,key:string,closed:boolean,label:string,widthKey=key) {
    const column:Column={element,widthKey};this.columns.set(key,column);element.dataset.groupWidthKey=widthKey;
    element.classList.toggle('is-board-collapsed',closed);
    const saved=this.savedWidth(key,widthKey);if(saved!==undefined)element.style.setProperty('--manual-order-column-width',`${saved}px`);
    if(closed)return;
    const handle=column.handle=element.createDiv({cls:'manual-order-column-resize',attr:{role:'separator',tabindex:'0','aria-orientation':'vertical','aria-label':`Resize group: ${label}`,'aria-valuemin':String(MIN_BOARD_WIDTH),'aria-valuemax':String(MAX_BOARD_WIDTH),title:'Drag to resize. Arrow keys adjust width. Double-click to reset.'}});
    const width=()=>Math.round(element.getBoundingClientRect().width)||this.savedWidth(key,widthKey)||640;
    handle.setAttribute('aria-valuenow',String(width()));
    handle.onpointerdown=event=>{
      if(event.button!==0||event.isPrimary===false||!this.canResize())return;
      event.preventDefault();event.stopPropagation();
      this.drag={column,key,pointer:event.pointerId,x:event.clientX,width:width(),current:width(),originals:new Map([...this.columns.values()].filter(column=>column.widthKey===widthKey).map(column=>[column,column.element.style.getPropertyValue('--manual-order-column-width')])),direction:this.doc.defaultView?.getComputedStyle(element).direction==='rtl'?-1:1};
      this.root.classList.add('manual-order-resizing-column');
      try{handle.setPointerCapture(event.pointerId);}catch{/* Document listeners also cover pointer capture failures. */}
    };
    handle.ondblclick=event=>{event.preventDefault();event.stopPropagation();if(this.canResize())this.persist(key,undefined);};
    handle.onkeydown=event=>{
      if(!this.canResize()||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      const direction=this.doc.defaultView?.getComputedStyle(element).direction==='rtl'?-1:1;
      const size=event.key==='Home'?MIN_BOARD_WIDTH:event.key==='End'?MAX_BOARD_WIDTH:this.clamp(width()+(event.key==='ArrowLeft'?-1:1)*direction*(event.shiftKey?64:16));
      this.apply(widthKey,size);this.persist(key,size,true);
    };
  }

  private clamp(width:number){return Math.max(MIN_BOARD_WIDTH,Math.min(MAX_BOARD_WIDTH,Math.round(width)));}
  private readonly move=(event:PointerEvent)=>{
    const drag=this.drag;if(!drag||event.pointerId!==drag.pointer)return;
    event.preventDefault();drag.current=this.clamp(drag.width+(event.clientX-drag.x)*drag.direction);
    this.apply(drag.column.widthKey,drag.current);
  };
  private finish() {
    const drag=this.drag;this.drag=undefined;this.root.classList.remove('manual-order-resizing-column');
    if(drag)try{drag.column.handle?.releasePointerCapture(drag.pointer);}catch{/* Capture may already have ended. */}
    return drag;
  }
  private readonly up=(event:PointerEvent)=>{
    if(!this.drag||event.pointerId!==this.drag.pointer)return;
    const drag=this.finish()!;
    if(drag.current!==drag.width)this.persist(drag.key,drag.current);
    else if(this.deferred){this.deferred=false;this.changed();}
  };
  private readonly cancelPointer=(event:PointerEvent)=>{if(event.pointerId===this.drag?.pointer)this.cancel();};
  private readonly cancel=()=>{
    const drag=this.finish();if(!drag)return;
    for(const [column,original]of drag.originals){if(original)column.element.style.setProperty('--manual-order-column-width',original);else column.element.style.removeProperty('--manual-order-column-width');column.handle?.setAttribute('aria-valuenow',String(Math.round(column.element.getBoundingClientRect().width)||640));}
    this.preview();this.measure();
    this.deferred=false;this.changed();
  };
  private readonly key=(event:KeyboardEvent)=>{if(this.drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.cancel();}};
  private persist(key:string,width:number|undefined,focus=false) {
    const previous=readBoardWidths(this.get()),next=new Map(previous);
    const column=this.columns.get(key);
    const shared=column?.widthKey??key;
    for(const candidate of next.keys())if(candidate===shared||legacyWidthGroup(candidate)===shared||this.columns.get(candidate)?.widthKey===shared)next.delete(candidate);
    if(width!==undefined)next.set(shared,width);
    this.apply(shared,width);
    try{this.save(next.size?Object.fromEntries(next):null);this.widths=next;this.legacy=this.resolveLegacy(next);}
    catch(error){
      this.widths=previous;this.legacy=this.resolveLegacy(previous);
      for(const [key,column]of this.columns)if(column.widthKey===shared){const original=this.savedWidth(key,shared);if(original!==undefined)column.element.style.setProperty('--manual-order-column-width',`${original}px`);else column.element.style.removeProperty('--manual-order-column-width');column.handle?.setAttribute('aria-valuenow',String(Math.round(column.element.getBoundingClientRect().width)||original||640));}
      this.report(error);
    }
    this.preview();this.measure();this.deferred=false;this.changed();if(focus)this.columns.get(key)?.handle?.focus({preventScroll:true});
  }
  destroy() {
    this.finish();this.columns.clear();this.doc.removeEventListener('pointermove',this.move);this.doc.removeEventListener('pointerup',this.up);
    this.doc.removeEventListener('pointercancel',this.cancelPointer);this.doc.removeEventListener('keydown',this.key,true);this.doc.defaultView?.removeEventListener('blur',this.cancel);
  }
}
