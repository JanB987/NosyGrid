export class Plugin { app=globalThis.testApp; registerBasesView(){return true;} addCommand(){} }
export class BasesView {
  cleanups=[];
  constructor(controller){this.app=controller.app;}
  register(callback){this.cleanups.push(callback);}
  unload(){for(const cleanup of this.cleanups)cleanup();this.cleanups=[];}
}
export class Notice { constructor(text){globalThis.notices.push(text);} }
export class Menu {
  items=[];
  addItem(callback){const item={title:'',disabled:false,checked:false,setTitle(value){this.title=value;return this;},setIcon(){return this;},setDisabled(value){this.disabled=value;return this;},setChecked(value){this.checked=value;return this;},onClick(callback){this.callback=callback;return this;}};callback(item);this.items.push(item);return this;}
  showAtMouseEvent(event){const doc=event.target?.ownerDocument??globalThis.testDocument??globalThis.document;if(!doc)return;doc.querySelector('.mock-menu')?.remove();const menu=doc.createElement('div');menu.className='mock-menu';menu.style.cssText='position:fixed;top:10px;left:10px;z-index:99999;background:#333;padding:10px';for(const item of this.items){const button=doc.createElement('button');button.textContent=item.title;button.disabled=item.disabled;button.onclick=()=>{menu.remove();item.callback?.();};menu.append(button);}doc.body.append(menu);}
}
export class Modal {}
export const Keymap={isModEvent:event=>!!(event.ctrlKey||event.metaKey)};
export const setIcon=(el,icon)=>{el.dataset.icon=icon;};
export { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
export function getFrontMatterInfo(text) {
  const match=text.match(/^---\n([\s\S]*?)\n---/);
  return {exists:!!match,frontmatter:match?.[1]??''};
}
export function parseLinktext(text) {const index=text.indexOf('#');return {path:index<0?text:text.slice(0,index),subpath:index<0?'':text.slice(index)};}
export function prepareFuzzySearch(query) {
  return text=>{let cursor=0;for(const char of query.toLowerCase()){cursor=text.toLowerCase().indexOf(char,cursor);if(cursor<0)return null;cursor++;}return {score:-text.length,matches:[]};};
}
export class LinkValue {
  static parseFromString(app,input,sourcePath) {
    const content=input.slice(2,-2),pipe=content.indexOf('|');
    const target=pipe<0?content:content.slice(0,pipe),label=pipe<0?content:content.slice(pipe+1);
    return {renderTo:el=>{el.createEl('a',{cls:'internal-link',text:label,attr:{'data-href':target}});}};
  }
}
