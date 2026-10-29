interface Point {key:string;cell:HTMLTableCellElement;row:number;column:number}
interface Gesture {pointer:number;x:number;y:number;anchor:string;shift:boolean;dragging:boolean;lastX:number;lastY:number}
const INTERACTIVE='a,[role=link],[role=button],[role=separator],button,input,textarea,select,[contenteditable=true],.manual-order-editor';
const keyOf=(cell:HTMLElement)=>JSON.stringify([cell.dataset.path,cell.dataset.property]);

/** Presentation-only, rectangular selection. Editing starts only after a non-drag click. */
export class CellSelection {
  private rows:Point[][]=[];
  private points=new Map<string,Point>();
  private selected=new Set<string>();
  private anchor?:string;
  private end?:string;
  private gesture?:Gesture;
  private suppressClick=false;
  private frame?:number;
  private focusAfterRender?:string;
  private settingFocus=false;
  private rangeStamp?:string;
  private doc:Document;

  constructor(private root:HTMLElement) {
    this.doc=root.ownerDocument;
    root.addEventListener('pointerdown',this.down,true);root.addEventListener('click',this.click,true);
    root.addEventListener('keydown',this.keydown,true);root.addEventListener('focusin',this.focusin);
    root.addEventListener('dragstart',this.nativeDrag,true);
    this.doc.addEventListener('pointermove',this.move,{capture:true,passive:false});
    this.doc.addEventListener('pointerup',this.up,true);this.doc.addEventListener('pointercancel',this.cancel,true);
    this.doc.addEventListener('pointerdown',this.outside,true);
    this.doc.defaultView?.addEventListener('blur',this.cancel);
  }

  beforeRender() {
    const cell=this.doc.activeElement;
    this.focusAfterRender=cell?.matches('td[data-property]')&&this.root.contains(cell)?keyOf(cell as HTMLElement):undefined;
  }
  refresh() {
    this.rangeStamp=undefined;
    this.rows=[];this.points.clear();
    for(const row of this.root.querySelectorAll<HTMLTableRowElement>('.manual-order-table > tbody > tr')) {
      const cells=[...row.querySelectorAll<HTMLTableCellElement>(':scope > td[data-property]')];
      if(!cells.length)continue;
      const points=cells.map((cell,column)=>({key:keyOf(cell),cell,row:this.rows.length,column}));this.rows.push(points);
      for(const point of points){this.points.set(point.key,point);point.cell.setAttribute('role','gridcell');point.cell.tabIndex=0;}
    }
    this.selected=new Set([...this.selected].filter(key=>this.points.has(key)));
    const anchor=this.anchor?this.points.get(this.anchor):undefined;
    if(anchor)this.selected=new Set([...this.selected].filter(key=>this.scope(this.points.get(key)!)===this.scope(anchor)));
    if(this.anchor&&!this.points.has(this.anchor))this.anchor=this.selected.values().next().value;
    if(this.end&&(!this.points.has(this.end)||!this.selected.has(this.end)))this.end=this.anchor;
    if(this.gesture&&!this.points.has(this.gesture.anchor))this.stop();
    this.paint();
    if(this.focusAfterRender)this.focus(this.points.get(this.focusAfterRender));
    this.focusAfterRender=undefined;
  }

  selectCell(cell:HTMLElement) {
    const key=keyOf(cell);if(!this.points.has(key))return;
    this.rangeStamp=undefined;this.anchor=key;this.end=key;this.selected=new Set([key]);this.paint();
  }
  clear() {this.stop();this.rangeStamp=undefined;this.selected.clear();this.anchor=undefined;this.end=undefined;this.paint();}

  getRange():{path:string;property:string}[][] {
    const selected=[...this.points.values()].filter(point=>this.selected.has(point.key));if(!selected.length)return [];
    const top=Math.min(...selected.map(p=>p.row)),bottom=Math.max(...selected.map(p=>p.row));
    const left=Math.min(...selected.map(p=>p.column)),right=Math.max(...selected.map(p=>p.column));
    const result:{path:string;property:string}[][]=[];
    for(let r=top;r<=bottom;r++) {
      const row:{path:string;property:string}[]=[];
      for(let c=left;c<=right;c++) {
        const point=this.rows[r]?.[c];if(!point||!this.selected.has(point.key))throw new Error('Select one rectangular range before pasting.');
        row.push({path:point.cell.dataset.path!,property:point.cell.dataset.property!});
      }
      result.push(row);
    }
    return result;
  }

  renamePath(oldPath:string,newPath:string) {
    const rename=(key:string)=>{const [path,property]=JSON.parse(key);return JSON.stringify([path===oldPath?newPath:path,property]);};
    this.selected=new Set([...this.selected].map(rename));if(this.anchor)this.anchor=rename(this.anchor);if(this.end)this.end=rename(this.end);
    for(const point of [...this.points.values()])if(point.cell.dataset.path===oldPath) {
      this.points.delete(point.key);point.cell.dataset.path=newPath;point.key=rename(point.key);this.points.set(point.key,point);
    }
    this.rangeStamp=undefined;
  }

  private point(target:EventTarget|null):Point|undefined {
    const cell=(target as Element|null)?.closest?.('td[data-property]') as HTMLElement|null;
    return cell&&this.root.contains(cell)?this.points.get(keyOf(cell)):undefined;
  }
  private scope(point:Point) {return point.cell.closest('.manual-order-board-column');}
  private readonly down=(event:PointerEvent)=>{
    this.suppressClick=false;
    if(event.button!==0||event.isPrimary===false||event.pointerType==='touch'||(event.target as Element).closest(INTERACTIVE))return;
    const point=this.point(event.target);if(!point)return;
    event.preventDefault();
    let anchor=event.shiftKey&&this.anchor&&this.points.has(this.anchor)?this.anchor:point.key;
    if(this.scope(this.points.get(anchor)!)!==this.scope(point))anchor=point.key;
    this.anchor=anchor;this.range(anchor,point.key);
    this.gesture={pointer:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,anchor,shift:event.shiftKey,dragging:false};
  };
  private readonly move=(event:PointerEvent)=>{
    const gesture=this.gesture;if(!gesture||event.pointerId!==gesture.pointer)return;
    gesture.lastX=event.clientX;gesture.lastY=event.clientY;
    if(!gesture.dragging&&Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)<5)return;
    if(!gesture.dragging) {
      gesture.dragging=true;this.root.classList.add('manual-order-selecting');
      this.doc.getSelection()?.removeAllRanges();
      try{this.root.setPointerCapture(event.pointerId);}catch{/* Document events also cover browsers without capture. */}
    }
    event.preventDefault();this.updateEnd();this.scheduleScroll();
  };
  private readonly up=(event:PointerEvent)=>{
    if(!this.gesture||event.pointerId!==this.gesture.pointer)return;
    const selecting=this.gesture.dragging||this.gesture.shift;
    if(selecting){event.preventDefault();this.suppressClick=true;}
    const end=this.end?this.points.get(this.end):undefined;
    this.stop();if(selecting || (end&&!end.cell.classList.contains('manual-order-editable')))this.focus(end);
  };
  private readonly cancel=()=>this.stop();
  private readonly outside=(event:PointerEvent)=>{if(!this.root.contains(event.target as Node))this.clear();};
  private readonly click=(event:MouseEvent)=>{
    if(this.suppressClick&&event.detail!==0){this.suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}
  };
  private readonly nativeDrag=(event:DragEvent)=>{if(this.gesture){event.preventDefault();event.stopImmediatePropagation();}};
  private readonly focusin=(event:FocusEvent)=>{
    if(this.settingFocus||this.gesture||event.target!==(event.target as Element)?.closest?.('td[data-property]'))return;
    const point=this.point(event.target);if(point)this.selectCell(point.cell);
  };
  private readonly keydown=(event:KeyboardEvent)=>{
    if((event.target as Element).closest(INTERACTIVE))return;
    if(event.key==='Escape'&&this.selected.size){event.preventDefault();event.stopPropagation();this.clear();return;}
    if(!event.shiftKey||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
    const point=(this.end?this.points.get(this.end):undefined)??this.point(event.target);if(!point)return;
    const scopedRows=this.rows.filter(row=>this.scope(row[0])===this.scope(point));
    const row=Math.max(scopedRows[0][0].row,Math.min(scopedRows.at(-1)![0].row,point.row+(event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0)));
    const column=Math.max(0,Math.min(this.rows[row].length-1,point.column+(event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0)));
    const target=this.rows[row][column];this.anchor??=point.key;this.range(this.anchor,target.key);
    event.preventDefault();event.stopPropagation();this.focus(target);
  };

  private range(anchorKey:string,endKey:string) {
    const stamp=JSON.stringify([anchorKey,endKey]);if(stamp===this.rangeStamp)return;this.rangeStamp=stamp;
    const anchor=this.points.get(anchorKey),end=this.points.get(endKey);if(!anchor||!end)return;
    this.end=endKey;this.selected.clear();
    for(let row=Math.min(anchor.row,end.row);row<=Math.max(anchor.row,end.row);row++) {
      for(let col=Math.min(anchor.column,end.column);col<=Math.max(anchor.column,end.column);col++) {
        const point=this.rows[row][col];if(point)this.selected.add(point.key);
      }
    }
    this.paint();
  }
  private paint() {
    for(const point of this.points.values()) {
      const selected=this.selected.has(point.key);
      point.cell.classList.toggle('manual-order-cell-selected',selected);point.cell.setAttribute('aria-selected',String(selected));
      point.cell.classList.toggle('manual-order-selection-anchor',selected&&point.key===this.anchor);
    }
    this.root.dataset.selectedCellCount=String(this.selected.size);
  }
  private focus(point:Point|undefined) {
    if(!point)return;this.settingFocus=true;try{point.cell.focus({preventScroll:true});}finally{this.settingFocus=false;}
  }

  private at(x:number,y:number):Point|undefined {
    const anchor=this.anchor?this.points.get(this.anchor):undefined;
    const direct=this.point(this.doc.elementFromPoint?.(x,y));if(direct&&(!anchor||this.scope(direct)===this.scope(anchor)))return direct;
    const rows=anchor?this.rows.filter(row=>this.scope(row[0])===this.scope(anchor)):this.rows;
    if(!rows.length)return;
    let low=0,high=rows.length-1;
    while(low<high){const mid=Math.floor((low+high)/2);if(y>rows[mid][0].cell.getBoundingClientRect().bottom)low=mid+1;else high=mid;}
    const row=rows[low];return row.find(point=>x<=point.cell.getBoundingClientRect().right)??row.at(-1);
  }
  private updateEnd() {
    const gesture=this.gesture;if(!gesture)return;
    const point=this.at(gesture.lastX,gesture.lastY);if(point)this.range(gesture.anchor,point.key);
  }
  private scheduleScroll() {
    if(this.frame!==undefined||!this.doc.defaultView?.requestAnimationFrame)return;
    this.frame=this.doc.defaultView.requestAnimationFrame(()=>{
      this.frame=undefined;const gesture=this.gesture;if(!gesture?.dragging)return;
      const bounds=this.root.getBoundingClientRect();
      const anchor=this.anchor?this.points.get(this.anchor):undefined;
      const horizontal=anchor?.cell.closest<HTMLElement>('[data-group-scroll-key]')??this.root;
      const horizontalBounds=horizontal.getBoundingClientRect();
      const speed=(value:number,start:number,end:number)=>value<start+28?-Math.min(24,(start+28-value)/2):value>end-28?Math.min(24,(value-end+28)/2):0;
      const dx=horizontal.scrollWidth>horizontal.clientWidth?speed(gesture.lastX,horizontalBounds.left,horizontalBounds.right):0;
      const dy=this.root.scrollHeight>this.root.clientHeight?speed(gesture.lastY,bounds.top,bounds.bottom):0;
      if(dx||dy){horizontal.scrollLeft+=dx;this.root.scrollTop+=dy;this.updateEnd();this.scheduleScroll();}
    });
  }
  private stop() {
    const pointer=this.gesture?.pointer;this.gesture=undefined;this.root.classList.remove('manual-order-selecting');
    if(pointer!==undefined)try{this.root.releasePointerCapture(pointer);}catch{/* Pointer may already be released. */}
    if(this.frame!==undefined)this.doc.defaultView?.cancelAnimationFrame(this.frame);this.frame=undefined;
  }
  destroy() {
    this.stop();this.root.removeEventListener('pointerdown',this.down,true);this.root.removeEventListener('click',this.click,true);
    this.root.removeEventListener('keydown',this.keydown,true);this.root.removeEventListener('focusin',this.focusin);this.root.removeEventListener('dragstart',this.nativeDrag,true);
    this.doc.removeEventListener('pointermove',this.move,true);this.doc.removeEventListener('pointerup',this.up,true);this.doc.removeEventListener('pointercancel',this.cancel,true);
    this.doc.removeEventListener('pointerdown',this.outside,true);this.doc.defaultView?.removeEventListener('blur',this.cancel);
  }
}
