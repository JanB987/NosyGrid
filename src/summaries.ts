import {Menu,Modal,type App,type BasesPropertyId,type BasesEntry,type BasesQueryResult,type QueryController,type Value,type BasesViewConfig} from 'obsidian';
export const SUMMARIES_KEY='summaries';
export function readSummaries(raw:unknown):Record<string,string> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  return Object.fromEntries(Object.entries(raw).filter(([key,value])=>key.trim()&&typeof value==='string'&&value.trim()).map(([key,value])=>[/^(note|file|formula)\./.test(key)?key:`note.${key}`,(value as string).trim()]));
}
// Core summaries are reserved view fields, not custom options returned by get().
// These capability-checked accessors exist in Obsidian but are absent from its SDK declaration.
interface NativeSummaryConfig {
  getSummaryKey?:(property:BasesPropertyId)=>unknown;
  setSummaryKey?:(property:BasesPropertyId,key:string|null)=>void;
}
export function readViewSummaries(config:BasesViewConfig,properties:BasesPropertyId[]):Record<string,string> {
  const result=readSummaries(config.get(SUMMARIES_KEY)),native=config as BasesViewConfig&NativeSummaryConfig;
  if(typeof native.getSummaryKey!=='function')return result;
  for(const property of properties){const value:unknown=native.getSummaryKey(property);if(typeof value==='string'&&value.trim())result[property]=value.trim();else delete result[property];}
  return result;
}
export function setViewSummary(config:BasesViewConfig,property:BasesPropertyId,key:string|null) {
  const native=config as BasesViewConfig&NativeSummaryConfig;
  if(typeof native.setSummaryKey==='function'){native.setSummaryKey(property,key);return;}
  const next=readSummaries(config.get(SUMMARIES_KEY));if(key)next[property]=key;else delete next[property];
  config.set(SUMMARIES_KEY,Object.keys(next).length?next:null);
}
export function summaryOptions(type:string):string[] {
  const all=['Empty','Filled','Unique'];
  if(type==='number')return [...all,'Average','Max','Median','Min','Range','Stddev','Sum'];
  if(type==='date'||type==='datetime')return [...all,'Earliest','Latest','Range'];
  if(type==='checkbox'||type==='boolean')return [...all,'Checked','Unchecked'];
  return all;
}
export function summaryMenu(app:App,property:BasesPropertyId,label:string,type:string,current:string|undefined,event:MouseEvent,save:(key:string|null)=>void) {
  const menu=new Menu();
  for(const key of ['None',...summaryOptions(type),...(current&&!summaryOptions(type).includes(current)?[current]:[])])menu.addItem(item=>item.setTitle(key).setChecked(key===(current??'None')).onClick(()=>save(key==='None'?null:key)));
  menu.addItem(item=>item.setTitle('Use custom summary…').setIcon('square-function').onClick(()=>{
    class SummaryName extends Modal {
      onOpen(){this.contentEl.createEl('h3',{text:`Summarize ${label}`});this.contentEl.createEl('p',{text:'Enter the name of a custom summary already defined in this Base.'});const form=this.contentEl.createEl('form');const input=form.createEl('input',{attr:{type:'text','aria-label':'Custom summary name',placeholder:'Summary name'}});form.createEl('button',{text:'Apply',attr:{type:'submit'}});form.onsubmit=event=>{event.preventDefault();if(input.value.trim()){save(input.value.trim());this.close();}};input.focus();}
    }
    new SummaryName(app).open();
  }));menu.showAtMouseEvent(event);
}
interface Target {element:HTMLElement;paths:string[];kind:'group'|'total';stamp?:string}
export class Summaries {
  private targets:Target[]=[];
  constructor(private root:HTMLElement,private controller:QueryController,private app:App,private get:()=>Record<string,string>,private label:(property:BasesPropertyId)=>string,private open:(property:BasesPropertyId,event:MouseEvent)=>void){}
  begin(){this.targets=[];}
  group(header:HTMLElement,entries:BasesEntry[]) {this.targets.push({element:header.createDiv({cls:'manual-order-group-summary'}),paths:entries.map(entry=>entry.file.path),kind:'group'});}
  total(entries:BasesEntry[]) {this.targets.push({element:this.root.createDiv({cls:'manual-order-summary-total-host'}),paths:entries.map(entry=>entry.file.path),kind:'total'});}
  refresh(data:BasesQueryResult,columns:BasesPropertyId[]) {
    const configured=this.get(),active=columns.filter(property=>configured[property]),entries=new Map(data.data.map(entry=>[entry.file.path,entry]));
    for(const target of this.targets) {
      if(target.kind==='group')target.element.parentElement?.classList.toggle('has-summary',!!active.length);
      target.element.hidden=!active.length;if(!active.length){target.stamp=undefined;target.element.empty();continue;}
      const rows=[...new Set(target.paths)].flatMap(path=>entries.get(path)?[entries.get(path)!]:[]);
      const results=new Map<BasesPropertyId,{value:Value|undefined;text:string;error:string}>(active.map(property=>{
        try {const value=data.getSummaryValue(this.controller,rows,property,configured[property]);return [property,{value,text:value.toString(),error:''}] as const;}
        catch(error){return [property,{value:undefined,text:'—',error:String(error)}] as const;}
      }));
      const stamp=JSON.stringify([columns,active.map(property=>[property,this.label(property),configured[property],results.get(property)!.text,results.get(property)!.error])]);
      if(stamp===target.stamp)continue;target.stamp=stamp;target.element.empty();
      let host=target.element;
      if(target.kind==='total'){host=target.element.createEl('table',{cls:'manual-order-table manual-order-summary-total',attr:{'aria-label':'Total summaries'}}).createEl('tfoot').createEl('tr');host.createEl('th',{text:'Total',cls:'manual-order-summary-total-label'});}
      for(const property of target.kind==='total'?columns:active) {
        const cell=target.kind==='total'?host.createEl('td'):host;
        const chip=cell.createDiv({cls:'manual-order-summary-chip',attr:{role:'button',tabindex:'0','aria-label':`Summarize ${this.label(property)}`}});
        const key=configured[property],result=results.get(property);
        if(key&&result) {
          chip.setAttribute('aria-description',`${key}: ${result.text}`);
          chip.title=result.error||`${this.label(property)} · ${key}: ${result.text}`;
          chip.createSpan({cls:'manual-order-summary-label',text:`${this.label(property)} · ${key}: `});const value=chip.createSpan({cls:'manual-order-summary-value'});
          if(result.value)result.value.renderTo(value,this.app.renderContext);else value.setText(result.text);
        } else chip.createSpan({text:'Summarize…'});
        chip.onclick=event=>{if((event.target as Element).closest('a'))return;event.stopPropagation();this.open(property,event);};
        chip.onkeydown=event=>{if(event.target!==chip||!['Enter',' '].includes(event.key))return;event.preventDefault();event.stopPropagation();this.open(property,new MouseEvent('click',{clientX:chip.getBoundingClientRect().left,clientY:chip.getBoundingClientRect().bottom}));};
      }
    }
  }
}
