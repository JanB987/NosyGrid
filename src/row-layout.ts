export const DEFAULT_ROW_HEIGHT=48;
export const ROW_HEIGHT_KEY='manualRowHeights';
const CONTROL_HEIGHT=12;

export function readRowHeights(value:unknown):Map<string,number> {
  if(!value || typeof value!=='object' || Array.isArray(value))return new Map();
  return new Map(Object.entries(value).filter((entry):entry is [string,number]=>
    typeof entry[1]==='number' && Number.isFinite(entry[1]) && entry[1]>DEFAULT_ROW_HEIGHT && entry[1]<=1000000));
}

interface ListCell {content:HTMLElement;viewport:HTMLElement;list:HTMLUListElement;button:HTMLButtonElement;property:string;expand:boolean}
interface Row {element:HTMLTableRowElement;path:string;lists:ListCell[]}

/** Row sizing is presentation state in the Base view, never note frontmatter. */
export class RowLayout {
  private heights=new Map<string,number>();
  private rows=new Map<string,Row>();
  private observer?:ResizeObserver;

  constructor(private root:HTMLElement,private get:()=>unknown,private save:(value:Record<string,number>|null)=>void,private report:(error:unknown)=>void) {}

  begin() {
    this.observer?.disconnect();this.rows.clear();this.heights=readRowHeights(this.get());
    const Observer=this.root.ownerDocument.defaultView?.ResizeObserver;
    if(Observer)this.observer=new Observer(()=>this.measure());
  }

  row(element:HTMLTableRowElement,path:string) {
    element.dataset.rowPath=path;
    element.style.setProperty('--manual-order-row-height',`${this.heights.get(path)??DEFAULT_ROW_HEIGHT}px`);
    this.rows.set(path,{element,path,lists:[]});
  }

  forgetCell(cell:HTMLElement) {
    const row=this.rows.get(cell.closest<HTMLTableRowElement>('tr')?.dataset.rowPath??'');if(!row)return;
    row.lists=row.lists.filter(list=>{
      if(!cell.contains(list.content))return true;
      this.observer?.unobserve(list.content);this.observer?.unobserve(list.list);return false;
    });
  }

  syncHeights() {
    const next=readRowHeights(this.get()),previous=this.heights;this.heights=next;
    for(const path of this.rows.keys())if(previous.get(path)!==next.get(path))this.apply(path);
  }

  list(content:HTMLElement,value:unknown,property:string,render:(item:HTMLElement,value:unknown)=>void) {
    const row=this.rows.get(content.closest<HTMLTableRowElement>('tr')!.dataset.rowPath!);
    if(!row)return;
    content.classList.add('manual-order-list-cell');
    content.closest('td')!.classList.add('manual-order-list-td');
    const viewport=content.createDiv({cls:'manual-order-list-viewport'});
    const list=viewport.createEl('ul',{cls:'manual-order-list-items'});
    const values=Array.isArray(value)?value:value===undefined||value===null||value===''?[]:[value];
    for(const value of values)render(list.createEl('li'),value);
    const button=content.createEl('button',{cls:'manual-order-list-toggle',attr:{type:'button'}});
    button.hidden=true;
    button.createSpan({cls:'manual-order-list-toggle-mark',text:'⌄'});
    const cell:ListCell={content,viewport,list,button,property,expand:true};row.lists.push(cell);
    // Retain focus in an existing editor, so expanding/collapsing never blur-saves it.
    button.onmousedown=event=>event.preventDefault();
    button.onclick=event=>{
      event.preventDefault();event.stopPropagation();
      const style=content.ownerDocument.defaultView!.getComputedStyle(content);
      const padding=(parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0);
      const height=cell.expand?Math.max(this.heights.get(row.path)??DEFAULT_ROW_HEIGHT,Math.ceil(this.naturalHeight(cell)+padding+CONTROL_HEIGHT+1)):DEFAULT_ROW_HEIGHT;
      this.setHeight(row.path,height);
    };
    this.observer?.observe(content);this.observer?.observe(list);
  }

  measure() {
    for(const row of this.rows.values())for(const cell of row.lists) {
      const expanded=this.heights.has(row.path);
      const style=cell.content.ownerDocument.defaultView!.getComputedStyle(cell.content);
      const fullHeight=cell.content.clientHeight-(parseFloat(style.paddingTop)||0)-(parseFloat(style.paddingBottom)||0);
      const natural=this.naturalHeight(cell);
      const overflow=fullHeight>0?natural>fullHeight+0.5:cell.list.children.length>1;
      const show=overflow || expanded;
      cell.button.hidden=!show;cell.content.classList.toggle('has-list-toggle',show);
      cell.content.closest('td')!.classList.toggle('has-list-toggle',show);
      cell.expand=fullHeight>0?natural>fullHeight-(show?CONTROL_HEIGHT:0)+0.5:!expanded;
      const collapse=expanded && !cell.expand;
      cell.button.setAttribute('aria-expanded',String(collapse));
      cell.button.setAttribute('aria-label',`${collapse?'Collapse row':'Show all items'}: ${cell.property.replace(/^note\./,'')}`);
      cell.button.title=collapse?'Restore default row height':'Expand row to show all items';
      cell.button.firstElementChild!.textContent=collapse?'⌃':'⌄';
      // Overflowed items should not put invisible links into keyboard navigation.
      if(cell.viewport.clientHeight) {
        const bottom=cell.viewport.getBoundingClientRect().bottom;
        for(const item of cell.list.children) {
          const hidden=item.getBoundingClientRect().top>=bottom;
          item.setAttribute('aria-hidden',String(hidden));
          item.querySelectorAll<HTMLElement>('a,[role=link]').forEach(link=>link.tabIndex=hidden?-1:0);
        }
      }
    }
  }

  private naturalHeight(cell:ListCell) {
    const items=cell.content.closest('td')?.querySelector<HTMLElement>('.manual-order-list-editor-items');
    if(items)return items.scrollHeight;
    const input=cell.content.closest('td')?.querySelector<HTMLTextAreaElement>('.manual-order-editor-input');
    return input?.scrollHeight || cell.list.scrollHeight;
  }

  expandForEditor(path:string,height:number) {
    if(height>(this.heights.get(path)??DEFAULT_ROW_HEIGHT))this.setHeight(path,Math.ceil(height));
  }

  private setHeight(path:string,height:number) {
    const previous=this.heights;
    const next=readRowHeights(this.get());
    if(height>DEFAULT_ROW_HEIGHT)next.set(path,height);else next.delete(path);
    this.heights=next;this.apply(path);this.measure();
    try {this.save(next.size?Object.fromEntries(next):null);}
    catch(error) {this.heights=previous;this.apply(path);this.measure();this.report(error);}
  }

  private apply(path:string) {
    this.rows.get(path)?.element.style.setProperty('--manual-order-row-height',`${this.heights.get(path)??DEFAULT_ROW_HEIGHT}px`);
  }

  rename(oldPath:string,newPath:string) {
    const heights=readRowHeights(this.get()),height=heights.get(oldPath);
    if(height===undefined)return;
    heights.delete(oldPath);heights.set(newPath,height);this.heights=heights;
    try {this.save(Object.fromEntries(heights));}catch(error){this.report(error);}
  }

  destroy() {this.observer?.disconnect();this.rows.clear();}
}
