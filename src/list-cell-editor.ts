import {Keymap} from 'obsidian';
import {type EditorOptions} from './cell-editor';
import {LinkSuggest} from './link-suggest';
import {wikilinkAt} from './link-syntax';
import {type CellValue} from './editing';
import {bindSelectedLinkDrag} from './link-drag';

interface ListOptions extends EditorOptions {initialItem?:number;onHeight?:(height:number)=>void}
interface Item {row:HTMLElement;input:HTMLTextAreaElement;remove:HTMLButtonElement;original:unknown;initial:string;existing:boolean;suggest?:LinkSuggest;removeDrag?:()=>void}

/** Individual list items, plus one empty row for adding another item. */
export class ListCellEditor {
  readonly element:HTMLElement;
  private host:HTMLElement;
  private error:HTMLElement;
  private items:Item[]=[];
  private closed=false;
  private pending?:Promise<boolean>;
  private closeAfter?:number;
  private committedFingerprint:string;
  private current?:Item;
  private selected=new Set<Item>();
  private anchor?:Item;
  private drag?:{item:Item;x:number;y:number;active:boolean};
  hasItemSelection() {return this.selected.size>0;}
  private paintSelection() {
    for(const item of this.items){const selected=this.selected.has(item);item.row.classList.toggle('is-item-selected',selected);item.row.setAttribute('aria-selected',String(selected));}
  }
  private selectRange(end:Item) {
    const start=this.items.indexOf(this.anchor??end),finish=this.items.indexOf(end);
    this.selected=new Set(this.items.slice(Math.min(start,finish),Math.max(start,finish)+1).filter(item=>item.existing||item.input.value.trim()));this.paintSelection();
  }
  private readonly itemDown=(event:PointerEvent)=>{
    if(event.button!==0||this.pending)return;
    const item=this.items.find(item=>item.row.contains(event.target as Node));
    if(!item||(event.target as Element).closest('button'))return;
    if(event.shiftKey){event.preventDefault();event.stopPropagation();this.anchor??=this.current??item;this.selectRange(item);this.focusItem(item);return;}
    // Keep Ctrl/Cmd-click on linked text available for opening that link.
    if((event.ctrlKey||event.metaKey)&&!(event.target as Element).closest('textarea')){
      event.preventDefault();event.stopPropagation();this.anchor=item;
      if(this.selected.has(item))this.selected.delete(item);else if(item.existing||item.input.value.trim())this.selected.add(item);
      this.paintSelection();this.focusItem(item);return;
    }
    this.selected.clear();this.paintSelection();this.anchor=item;
    this.drag={item,x:event.clientX,y:event.clientY,active:false};
  };
  private readonly itemMove=(event:PointerEvent)=>{
    const drag=this.drag;if(!drag)return;
    const item=this.items.find(item=>{const box=item.row.getBoundingClientRect();return event.clientY>=box.top&&event.clientY<=box.bottom;});
    if(!drag.active&&(!item||item===drag.item||Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<5))return;
    drag.active=true;event.preventDefault();
    if(item){this.selectRange(item);this.focusItem(item);}
    if(event.clientY<this.host.getBoundingClientRect().top+20)this.host.scrollTop-=20;
    if(event.clientY>this.host.getBoundingClientRect().bottom-20)this.host.scrollTop+=20;
  };
  private readonly itemUp=()=>{this.drag=undefined;};
  private pointerInside=false;
  private pointerReset?:ReturnType<typeof setTimeout>;
  private readonly outsidePointerDown=(event:PointerEvent)=>{
    this.pointerInside=this.options.cell.contains(event.target as Node);
    if(this.pointerReset)clearTimeout(this.pointerReset);
    this.pointerReset=setTimeout(()=>{this.pointerInside=false;},0);
    if(!this.closed&&!this.options.cell.contains(event.target as Node)&&!(event.target as Element).closest?.('.suggestion-container'))void this.save();
  };
  private readonly cellMouseDown=(event:MouseEvent)=>{
    if(this.closed||(event.target as Element).closest('textarea,button,a'))return;
    event.preventDefault();
    const item=this.items.find(item=>event.clientY<=item.row.getBoundingClientRect().bottom)??this.items.at(-1);
    if(item)this.focusItem(item,event.clientX<=item.input.getBoundingClientRect().left?0:item.input.value.length);
  };

  constructor(private options:ListOptions) {
    const {cell,snapshot}=options;
    const color=cell.ownerDocument.defaultView?.getComputedStyle(cell).color;
    cell.classList.add('is-editing','is-list-editing');
    this.element=cell.createDiv({cls:'manual-order-editor manual-order-list-editor'});
    if(color)this.element.style.color=color;
    this.host=this.element.createDiv({cls:'manual-order-list-editor-items'});
    this.error=this.element.createDiv({cls:'manual-order-editor-error',attr:{role:'alert'}});this.error.hidden=true;
    const values=Array.isArray(snapshot.value)?snapshot.value:snapshot.value==null||snapshot.value===''?[]:[snapshot.value];
    for(const value of values)this.add(value,this.items.length,true);
    this.add('');this.committedFingerprint=JSON.stringify(this.values());
    this.element.onclick=event=>event.stopPropagation();
    this.host.addEventListener('pointerdown',this.itemDown);
    cell.ownerDocument.addEventListener('pointermove',this.itemMove,{passive:false});
    cell.ownerDocument.addEventListener('pointerup',this.itemUp);
    cell.addEventListener('mousedown',this.cellMouseDown);
    cell.ownerDocument.addEventListener('pointerdown',this.outsidePointerDown);
    this.element.addEventListener('focusout',event=>{
      // Pointer gestures inside the cell can transiently move host focus. They
      // must never end editing. Outside clicks are handled independently above.
      const next=event.relatedTarget as Node|null;
      if(!this.closed&&!this.pointerInside&&next&&!cell.contains(next)&&!(next as Element).closest?.('.suggestion-container'))void this.save();
    });
    this.updateHeight();
  }

  private add(value:unknown,index=this.items.length,existing=false):Item {
    const initial=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);
    const row=this.host.createDiv({cls:'manual-order-list-edit-item'});
    row.createSpan({cls:'manual-order-list-edit-bullet',text:'•'});
    const input=row.createEl('textarea',{cls:'manual-order-editor-input manual-order-list-item-input',attr:{rows:'1','aria-label':`Item in ${this.options.snapshot.property}`}});
    input.value=initial;
    input.placeholder='Add an item…';
    const remove=row.createEl('button',{cls:'manual-order-list-remove',text:'×',attr:{type:'button','aria-label':'Remove list item',title:'Remove item'}});
    const item:Item={row,input,remove,original:value,initial,existing};
    this.items.splice(index,0,item);
    if(index<this.host.children.length-1)this.host.insertBefore(row,this.host.children[index]);
    if(this.options.app) {item.suggest=new LinkSuggest(this.options.app,input,this.options.snapshot.path);item.removeDrag=bindSelectedLinkDrag(input,this.options.app,this.options.snapshot.path);}
    input.onfocus=()=>{this.current=item;};
    input.oninput=()=>{
      this.selected.clear();this.paintSelection();
      this.error.hidden=true;input.removeAttribute('aria-invalid');remove.hidden=!input.value.trim()&&!item.existing;
      this.normalizeLines();this.resize(item);this.updateHeight();this.options.onInput?.();
    };
    input.addEventListener('click',event=>{
      if(this.closed||this.pending||!this.options.app||!Keymap.isModEvent(event)||input.selectionStart!==input.selectionEnd)return;
      const link=wikilinkAt(input.value,input.selectionStart);
      if(!link?.target)return;
      event.preventDefault();event.stopImmediatePropagation();item.suggest?.dismiss();
      void this.options.app.workspace.openLinkText(link.target,this.options.snapshot.path,Keymap.isModEvent(event));
    },true);
    input.onkeydown=event=>{
      if(event.shiftKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')) {
        event.preventDefault();event.stopPropagation();this.anchor??=item;
        const next=this.items[Math.max(0,Math.min(this.items.length-1,this.items.indexOf(item)+(event.key==='ArrowUp'?-1:1)))];
        this.selectRange(next);this.focusItem(next);return;
      }
      if(this.selected.size&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a') {
        event.preventDefault();event.stopPropagation();this.selected=new Set(this.items.filter(item=>item.existing||item.input.value.trim()));this.paintSelection();return;
      }
      if(event.key==='Escape'&&this.selected.size){event.preventDefault();event.stopPropagation();this.selected.clear();this.paintSelection();return;}
      if(event.isComposing||item.suggest?.handleKey(event))return;
      if(event.key==='Escape') {event.preventDefault();event.stopPropagation();this.cancel();}
      else if(event.key==='Enter') {
        event.preventDefault();event.stopPropagation();
        if(this.pending)return;
        if(!input.value.trim())void this.save();
        else void this.commit(false).then(ok=>{
          if(!ok||this.closed)return;
          const index=this.items.indexOf(item),next=this.items[index+1];
          this.focusItem(next && !next.input.value.trim()?next:this.add('',index+1));this.updateHeight();
        });
      } else if(event.key==='Tab') {
        event.preventDefault();event.stopPropagation();void this.save(event.shiftKey?-1:1);
      } else if((event.key==='ArrowUp'||event.key==='ArrowDown') && !event.shiftKey) {
        const next=this.items[this.items.indexOf(item)+(event.key==='ArrowUp'?-1:1)];
        if(next && (event.key==='ArrowUp'?input.selectionStart===0:input.selectionEnd===input.value.length)) {
          event.preventDefault();event.stopPropagation();this.focusItem(next,Math.min(input.selectionStart,next.input.value.length));
        }
      }
    };
    row.onmousedown=event=>{
      if(event.target===row || (event.target as HTMLElement).classList.contains('manual-order-list-edit-bullet')) {
        event.preventDefault();this.focusItem(item,event.target===row?input.value.length:0);
      }
    };
    remove.onmousedown=event=>event.preventDefault();
    remove.onclick=event=>{
      event.preventDefault();event.stopPropagation();if(this.pending||this.closed)return;
      const index=this.items.indexOf(item);item.suggest?.destroy();item.removeDrag?.();this.items.splice(index,1);row.remove();
      if(!this.items.length)this.add('');
      this.focusItem(this.items[Math.min(index,this.items.length-1)]);this.updateHeight();
      void this.commit(false);
    };
    remove.hidden=!initial.trim()&&!existing;this.resize(item);return item;
  }

  private resize(item:Item) {item.input.style.height='auto';item.input.style.height=`${Math.max(20,item.input.scrollHeight)}px`;}
  private normalizeLines() {
    for(const item of [...this.items]) {
      if(!/[\r\n]/.test(item.input.value)||item.input.value===item.initial)continue;
      const position=item.input.selectionStart,parts=item.input.value.split(/\r?\n/),prefix=item.input.value.slice(0,position).split(/\r?\n/);
      const inputs=[item];let index=this.items.indexOf(item);
      item.input.value=parts[0];item.remove.hidden=!parts[0].trim()&&!item.existing;this.resize(item);
      for(const part of parts.slice(1)) {const next=this.add('',++index);next.input.value=part;next.remove.hidden=!part.trim();this.resize(next);inputs.push(next);}
      if(this.current===item)this.focusItem(inputs[Math.min(prefix.length-1,inputs.length-1)],prefix.at(-1)!.length);
    }
  }
  private updateHeight() {
    const natural=this.host.scrollHeight;
    if(natural)this.options.onHeight?.(natural+15+(this.items.length>1?12:0));
  }

  private values():unknown[] {
    return this.items.flatMap(item=>{
      if(!item.input.value.trim())return item.existing&&item.input.value===item.initial?[item.original]:[];
      if(item.input.value===item.initial)return [item.original];
      return item.input.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
    });
  }

  copyText():string {return this.selected.size?this.items.filter(item=>this.selected.has(item)).map(item=>item.input.value).join('\n'):this.values().map(String).join('\n');}

  focus(position?:number) {
    const index=this.options.initialItem;
    this.focusItem(index!==undefined&&this.items[index]?this.items[index]:this.items.at(-1)!,position);
  }
  private focusItem(item:Item,position=item.input.value.length) {
    this.current=item;item.input.focus();item.input.setSelectionRange(position,position);
  }

  save(navigation=0,explicit?:CellValue):Promise<boolean> {return this.commit(true,navigation,explicit);}
  async addLink(link:string):Promise<boolean> {
    if(this.pending)await this.pending;
    if(this.closed)return false;
    const last=this.items.at(-1);
    const item=last && !last.input.value.trim()&&!last.existing?last:this.add('');
    item.input.value=link;item.remove.hidden=false;this.resize(item);this.focusItem(item);this.updateHeight();
    const ok=await this.commit(false);
    if(ok&&!this.closed) {if(this.items.at(-1)?.input.value.trim())this.add('');this.updateHeight();}
    return ok;
  }
  private commit(close:boolean,navigation=0,explicit?:CellValue):Promise<boolean> {
    if(this.closed)return Promise.resolve(true);
    if(close)this.closeAfter=navigation;
    if(this.pending)return this.pending;
    const run=async()=>{
      try {
        this.normalizeLines();this.updateHeight();
        const values=this.values(),fingerprint=JSON.stringify(values);
        if(explicit || fingerprint!==this.committedFingerprint) {
          this.setReadOnly(true);this.items.forEach(item=>item.suggest?.close());
          await this.options.save(explicit??{exists:values.length>0,value:values.length?values:undefined});
          this.committedFingerprint=fingerprint;
          for(const item of this.items)if(item.input.value.trim()) {item.original=item.input.value===item.initial?item.original:item.input.value;item.initial=item.input.value;item.existing=true;}
        }
        this.setReadOnly(false);
        if(this.closeAfter!==undefined) {const next=this.closeAfter;this.dispose();this.options.close(next);}
        return true;
      } catch(error) {
        this.closeAfter=undefined;this.setReadOnly(false);this.error.hidden=false;
        this.error.setText(error instanceof Error?error.message:String(error));
        this.current?.input.setAttribute('aria-invalid','true');this.current?.input.focus();return false;
      }
    };
    this.pending=run().finally(()=>{this.pending=undefined;});return this.pending;
  }
  private setReadOnly(value:boolean) {for(const item of this.items){item.input.readOnly=value;item.remove.disabled=value;}}
  cancel() {if(!this.pending&&!this.closed){this.dispose();this.options.close(0);}}
  dispose() {this.closed=true;if(this.pointerReset)clearTimeout(this.pointerReset);this.host.removeEventListener('pointerdown',this.itemDown);this.options.cell.ownerDocument.removeEventListener('pointermove',this.itemMove);this.options.cell.ownerDocument.removeEventListener('pointerup',this.itemUp);this.options.cell.removeEventListener('mousedown',this.cellMouseDown);this.options.cell.ownerDocument.removeEventListener('pointerdown',this.outsidePointerDown);this.items.forEach(item=>{item.suggest?.destroy();item.removeDrag?.();});}
}
