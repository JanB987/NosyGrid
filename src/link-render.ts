import {LinkValue,Keymap,Menu,type App} from 'obsidian';
import {splitWikilinks} from './link-syntax';
import {makeLinkDraggable} from './link-drag';

/** Use Bases' native link value renderer for each link, without rendering arbitrary Markdown. */
export function renderPropertyLinks(cell:HTMLElement,value:unknown,app:App,sourcePath:string):boolean {
  const values=Array.isArray(value)?value:[value];
  if(!values.some(item=>typeof item==='string' && splitWikilinks(item).some(part=>part.target)))return false;
  values.forEach((item,index)=>{
    if(index)cell.createSpan({cls:'manual-order-list-separator',text:', '});
    const host=cell.createSpan({cls:'manual-order-property-value'});
    for(const part of splitWikilinks(item==null?'':String(item))) {
      if(!part.target) {host.append(part.text);continue;}
      const slot=host.createSpan();
      slot.dataset.manualOrderRawLink=part.text;
      const native=LinkValue.parseFromString(app,part.text,sourcePath);
      native?.renderTo(slot,app.renderContext);
      const link=slot.querySelector<HTMLElement>('.internal-link')??slot.createEl('a',{cls:'internal-link',text:part.label??part.target});
      link.setAttribute('href',part.target);link.setAttribute('data-href',part.target);link.setAttribute('role','link');link.tabIndex=0;
      makeLinkDraggable(link,app,sourcePath,part.text);
      // Capture to avoid also invoking native renderer handlers, while using public
      // workspace endpoints for source-relative opening, hover and context menus.
      link.addEventListener('click',event=>{
        if(event.button!==0)return;
        event.preventDefault();event.stopImmediatePropagation();
        void app.workspace.openLinkText(part.target!,sourcePath,Keymap.isModEvent(event));
      },true);
      link.addEventListener('auxclick',event=>{
        if(event.button!==1)return;
        event.preventDefault();event.stopImmediatePropagation();void app.workspace.openLinkText(part.target!,sourcePath,'tab');
      },true);
      link.addEventListener('mouseover',event=>{
        if(event.relatedTarget && link.contains(event.relatedTarget as Node))return;
        event.stopImmediatePropagation();
        app.workspace.trigger('hover-link',{event,source:'manual-order-bases',hoverParent:app.renderContext,targetEl:link,linktext:part.target,sourcePath});
      },true);
      link.addEventListener('contextmenu',event=>{
        const menu=new Menu();
        if(app.workspace.handleLinkContextMenu(menu,part.target!,sourcePath)) {
          event.preventDefault();event.stopImmediatePropagation();menu.showAtMouseEvent(event);
        }
      },true);
      link.addEventListener('keydown',event=>{
        if(event.key!=='Enter')return;
        event.preventDefault();event.stopImmediatePropagation();void app.workspace.openLinkText(part.target!,sourcePath,Keymap.isModEvent(event));
      },true);
    }
  });
  return true;
}
