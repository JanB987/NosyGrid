import type {App} from 'obsidian';

export interface NativeListTarget {values:string[];setValues:(values:string[])=>unknown}
function object(value:unknown):Record<string,unknown>|undefined {return value&&typeof value==='object'?value as Record<string,unknown>:undefined;}
/** Isolate private widget access; resolve the exact DOM owner, never the active note. */
export function nativeListTarget(app:App,target:HTMLElement):NativeListTarget|undefined {
  const property=target.closest('.metadata-property[data-property-key]'),root=target.closest('.multi-select-container');
  if(!property||!root)return;
  let result:NativeListTarget|undefined;
  app.workspace.iterateAllLeaves(leaf=>{
    const editor=object(object(leaf.view)?.metadataEditor);
    if(!Array.isArray(editor?.rendered))return;
    for(const candidate of editor.rendered as unknown[]) {
      const row=object(candidate),rendered=object(row?.rendered),widget=object(rendered?.multiselect);
      if(row?.containerEl!==property||rendered?.type!=='multitext'||widget?.rootEl!==root||widget.inputEl!==target)continue;
      if(!Array.isArray(widget.values)||!widget.values.every((value:unknown)=>typeof value==='string')||typeof widget.setValues!=='function')continue;
      const values=widget.values,set=widget.setValues as (values:string[])=>unknown;
      result={values:[...values],setValues:next=>set.call(widget,next)};
    }
  });
  return result;
}
function draftSides(target:HTMLElement):{left:string;right:string}|undefined {
  const selection=target.ownerDocument.getSelection();
  if(!selection||selection.rangeCount!==1)return target.textContent?undefined:{left:'',right:''};
  const range=selection.getRangeAt(0);
  if(!target.contains(range.startContainer)||!target.contains(range.endContainer))return target.textContent?undefined:{left:'',right:''};
  const before=range.cloneRange(),after=range.cloneRange();before.selectNodeContents(target);before.setEnd(range.startContainer,range.startOffset);
  after.selectNodeContents(target);after.setStart(range.endContainer,range.endOffset);
  return {left:before.toString(),right:after.toString()};
}

/** Narrow compatibility adapter for Obsidian's undocumented metadata widgets. */
export class PropertyPaste {
  private copied?:{text:string;time:number};
  constructor(private readonly notice:(message:string)=>void,private readonly now:()=>number=Date.now,private readonly resolveList:(target:HTMLElement)=>NativeListTarget|undefined=()=>undefined) {}
  remember(text:string) {this.copied={text:text.replace(/\r\n/g,'\n'),time:this.now()};}
  clear() {this.copied=undefined;}
  bind(doc:Document):()=>void {
    const clear=()=>this.clear();
    const paste=(event:ClipboardEvent)=>this.paste(event);
    doc.addEventListener('copy',clear,true);doc.addEventListener('cut',clear,true);doc.addEventListener('paste',paste,true);
    return ()=>{doc.removeEventListener('copy',clear,true);doc.removeEventListener('cut',clear,true);doc.removeEventListener('paste',paste,true);};
  }
  private paste(event:ClipboardEvent) {
    if(event.defaultPrevented||!event.clipboardData||!this.copied)return;
    const text=event.clipboardData.getData('text/plain').replace(/\r\n/g,'\n');
    if(this.now()-this.copied.time>120000||text!==this.copied.text){this.clear();return;}
    const links=text.split('\n');if(links.length<2)return;
    const target=event.target as HTMLElement|null;
    const property=target?.closest?.<HTMLElement>('.metadata-property[data-property-key]');
    const value=target?.closest?.<HTMLElement>('.metadata-property-value[data-property-type]');
    if(!property||!value||!property.contains(value)||!target)return;
    const type=value.dataset.propertyType;
    if(type==='multitext'&&target.matches('.multi-select-input[contenteditable="true"]')) {
      event.preventDefault();event.stopImmediatePropagation();
      const widget=this.resolveList(target),sides=draftSides(target);
      if(!widget||!sides){this.notice('Could not access this List editor safely. Paste into the empty add-item field of an open note or its Properties pane.');return;}
      const original=target.textContent??'',items=[sides.left.trim(),...links,sides.right.trim()].filter(Boolean);
      try {
        // Clear only this input's draft before native rerender/blur can commit it twice.
        target.textContent='';widget.setValues([...widget.values,...items]);
        const win=target.ownerDocument.defaultView;if(win)target.dispatchEvent(new win.Event('input',{bubbles:true}));
      } catch(error){
        try{widget.setValues(widget.values);}catch{/* The native widget reports its own save errors. */}
        target.textContent=original;this.notice(`Could not paste links into the List property: ${String(error)}`);
      }
      return;
    }
    if(type!=='text'||!target.matches('.metadata-input-longtext[contenteditable="true"]'))return;
    event.preventDefault();event.stopImmediatePropagation();
    const selection=target.ownerDocument.getSelection();
    if(!selection||selection.rangeCount!==1) {this.notice('Could not determine the property caret. Copy and paste each link separately.');return;}
    const range=selection.getRangeAt(0);
    if(!target.contains(range.startContainer)||!target.contains(range.endContainer)) {this.notice('Could not determine the property caret. Copy and paste each link separately.');return;}
    const before=range.cloneRange(),after=range.cloneRange();
    before.selectNodeContents(target);before.setEnd(range.startContainer,range.startOffset);
    after.selectNodeContents(target);after.setStart(range.endContainer,range.endOffset);
    const left=before.toString(),right=after.toString();
    const insertion=(left&&!/\s$/.test(left)?' ':'')+links.join(' ')+(right&&!/^\s/.test(right)?' ':'');
    range.deleteContents();const node=target.ownerDocument.createTextNode(insertion);range.insertNode(node);
    range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
    const win=target.ownerDocument.defaultView;if(win)target.dispatchEvent(new win.Event('input',{bubbles:true}));
  }
}
