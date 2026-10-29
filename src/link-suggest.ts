import {prepareFuzzySearch, parseLinktext, type App, type TFile} from 'obsidian';
import {fileProperties} from './validation';
import {activeWikilink,replaceWikilink} from './link-syntax';

export interface LinkSuggestion { label:string; detail:string; target:string; alias?:string }

export function findLinkSuggestions(app:App,sourcePath:string,query:string):LinkSuggestion[] {
  const {path,subpath}=parseLinktext(query);
  if(subpath) {
    const file=path ? app.metadataCache.getFirstLinkpathDest(path,sourcePath) : app.vault.getFileByPath(sourcePath);
    if(!file) return [];
    const cache=app.metadataCache.getFileCache(file);
    const block=subpath.startsWith('#^');
    const search=(block?subpath.slice(2):subpath.slice(1)).toLowerCase();
    const values=block?Object.keys(cache?.blocks??{}):(cache?.headings??[]).map(h=>h.heading);
    return [...new Set(values)].filter(value=>value.toLowerCase().includes(search)).slice(0,50).map(value=>({
      label:block?`^${value}`:value,detail:file.path,target:`${path?app.metadataCache.fileToLinktext(file,sourcePath,true):''}#${block?'^':''}${value}`,
    }));
  }
  const search=query.trim()?prepareFuzzySearch(query.trim()):undefined;
  const files=app.vault.getFiles?.()??app.vault.getMarkdownFiles();
  const matches:{file:TFile;label:string;alias?:string;score:number}[]=[];
  for(const file of files) {
    const aliases=fileProperties(app,file).aliases;
    const names=[{label:file.basename,alias:undefined as string|undefined},...(Array.isArray(aliases)?aliases as unknown[]:typeof aliases==='string'?[aliases]:[])
      .filter((alias:unknown):alias is string=>typeof alias==='string').map((alias:string)=>({label:alias,alias}))];
    let best:typeof matches[number]|undefined;
    for(const name of names) {
      const match=search?.(name.alias??file.path);
      if(search && !match) continue;
      const candidate={file,...name,score:match?.score??0};
      if(!best || candidate.score>best.score) best=candidate;
    }
    if(best) matches.push(best);
  }
  const result:LinkSuggestion[]=matches.sort((a,b)=>b.score-a.score||a.file.path.localeCompare(b.file.path)).slice(0,50).map(({file,label,alias})=>({label,alias,detail:file.path,target:app.metadataCache.fileToLinktext(file,sourcePath,true)}));
  if(!result.length && query.trim() && !/[[\]\r\n|]/.test(query)) result.push({label:query.trim(),detail:'New note · created when opened',target:query.trim()});
  return result;
}

let nextPopupId=0;
export class LinkSuggest {
  private popup?:HTMLElement;
  private items:LinkSuggestion[]=[];
  private selected=0;
  private dismissed='';
  private composing=false;
  private readonly id=`manual-order-link-suggest-${++nextPopupId}`;
  private readonly inputHandler=(event:Event)=>{this.dismissed='';if(!(event as InputEvent).isComposing)this.update();};
  private readonly caretHandler=()=>{if(this.input.ownerDocument.activeElement===this.input)this.update();};
  private readonly blurHandler=()=>this.close();
  private readonly compositionStart=()=>{this.composing=true;this.close();};
  private readonly compositionEnd=()=>{this.composing=false;this.dismissed='';this.update();};
  private readonly positionHandler=()=>this.position();

  constructor(private app:App,private input:HTMLInputElement|HTMLTextAreaElement,private sourcePath:string) {
    input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
    input.addEventListener('input',this.inputHandler);input.addEventListener('click',this.caretHandler);
    input.addEventListener('blur',this.blurHandler);input.addEventListener('compositionstart',this.compositionStart);input.addEventListener('compositionend',this.compositionEnd);
    input.ownerDocument.addEventListener('selectionchange',this.caretHandler);
    input.ownerDocument.addEventListener('scroll',this.positionHandler,true);
    input.ownerDocument.defaultView?.addEventListener('resize',this.positionHandler);
  }

  private signature() {return `${this.input.selectionStart}:${this.input.value}`;}
  update() {
    if(this.input.readOnly) {this.close();return;}
    if(this.composing || this.dismissed===this.signature())return;
    const context=activeWikilink(this.input.value,this.input.selectionStart??0,this.input.selectionEnd??0);
    if(!context) {this.close();return;}
    this.items=findLinkSuggestions(this.app,this.sourcePath,context.query);this.selected=0;
    this.popup?.remove();
    this.popup=this.input.ownerDocument.body.createDiv();
    this.popup.className='suggestion-container manual-order-link-suggestions';this.popup.id=this.id;this.popup.setAttribute('role','listbox');
    this.popup.setAttribute('aria-label','Internal link suggestions');
    this.popup.onmousedown=event=>{if(event.button===0)event.preventDefault();};
    this.items.forEach((item,index)=>{
      const row=this.popup!.createDiv({cls:'suggestion-item'});row.id=`${this.id}-${index}`;row.setAttribute('role','option');
      row.createDiv({cls:'suggestion-title',text:item.label});row.createDiv({cls:'suggestion-note',text:item.detail});
      row.onmouseenter=()=>{this.selected=index;this.highlight();};
      row.onclick=event=>{event.preventDefault();event.stopPropagation();this.choose(index);};
    });
    if(!this.items.length)this.popup.createDiv({cls:'suggestion-empty',text:'No matching headings or blocks'});
    this.input.ownerDocument.body.append(this.popup);
    this.input.setAttribute('aria-controls',this.id);this.input.setAttribute('aria-expanded','true');
    this.position();this.highlight();
  }

  handleKey(event:KeyboardEvent):boolean {
    if(event.isComposing || this.composing || !this.popup)return false;
    if(event.key==='Escape') this.dismiss();
    else if(event.key==='ArrowDown'||event.key==='ArrowUp') {
      if(this.items.length)this.selected=(this.selected+(event.key==='ArrowDown'?1:-1)+this.items.length)%this.items.length;
      this.highlight();
    } else if((event.key==='Enter'||event.key==='Tab') && !event.shiftKey && this.items.length)this.choose(this.selected);
    else return false;
    event.preventDefault();event.stopPropagation();return true;
  }

  private choose(index:number) {
    const context=activeWikilink(this.input.value,this.input.selectionStart??0,this.input.selectionEnd??0);
    const item=this.items[index];if(!context||!item)return;
    const next=replaceWikilink(this.input.value,context,item.target,item.alias);
    this.close();this.input.value=next.value;this.input.focus();this.input.setSelectionRange(next.caret,next.caret);
    const EventClass=this.input.ownerDocument.defaultView!.Event;
    this.input.dispatchEvent(new EventClass('input',{bubbles:true}));
  }

  private highlight() {
    this.popup?.querySelectorAll<HTMLElement>('[role=option]').forEach((row,index)=>{
      row.classList.toggle('is-selected',index===this.selected);row.setAttribute('aria-selected',String(index===this.selected));
      if(index===this.selected)row.scrollIntoView?.({block:'nearest'});
    });
    if(this.items.length)this.input.setAttribute('aria-activedescendant',`${this.id}-${this.selected}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  private position() {
    if(!this.popup)return;
    const rect=this.input.getBoundingClientRect(),win=this.input.ownerDocument.defaultView!;
    const width=Math.min(360,Math.max(180,win.innerWidth-16));
    this.popup.style.width=`${width}px`;
    this.popup.style.left=`${Math.max(8,Math.min(rect.left,win.innerWidth-width-8))}px`;
    this.popup.style.top=`${rect.bottom+this.popup.offsetHeight+8<=win.innerHeight?rect.bottom+3:Math.max(8,rect.top-this.popup.offsetHeight-3)}px`;
  }

  close() {
    this.popup?.remove();this.popup=undefined;
    this.input.setAttribute('aria-expanded','false');this.input.removeAttribute('aria-activedescendant');this.input.removeAttribute('aria-controls');
  }

  dismiss() {this.dismissed=this.signature();this.close();}

  destroy() {
    this.close();this.input.removeEventListener('input',this.inputHandler);this.input.removeEventListener('click',this.caretHandler);this.input.removeEventListener('blur',this.blurHandler);
    this.input.removeEventListener('compositionstart',this.compositionStart);this.input.removeEventListener('compositionend',this.compositionEnd);
    this.input.ownerDocument.removeEventListener('selectionchange',this.caretHandler);this.input.ownerDocument.removeEventListener('scroll',this.positionHandler,true);
    this.input.ownerDocument.defaultView?.removeEventListener('resize',this.positionHandler);
  }
}
