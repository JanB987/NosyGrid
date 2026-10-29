import {setIcon} from 'obsidian';
import type {ValueSection,ValueSettings} from './group-values';

export function renderValueMenu(host:HTMLElement,section:ValueSection,settings:ValueSettings,label:string,render:(host:HTMLElement,item:ValueSection['items'][number])=>void,save:(next:ValueSettings,reorder?:boolean)=>void,parse:(text:string)=>unknown,report:(error:unknown)=>void,colors?:{get:(id:string)=>string|undefined;set:(id:string,color:string|null)=>void}) {
  const details=host.createEl('details',{cls:'manual-order-group-values'});
  details.createEl('summary',{text:`${label} — group values`});
  let dragged:string|undefined;
  const reorder=(source:string,target:string,after=false)=>{
    const ids=section.items.map(item=>item.id),next=ids.filter(id=>id!==source);next.splice(next.indexOf(target)+(after?1:0),0,source);save({...settings,order:next},true);
  };
  section.items.forEach((item,index)=>{
    const row=details.createDiv({cls:'manual-order-group-value-option'});row.dataset.valueId=item.id;
    if(section.vertical!==false) {
    const grip=row.createEl('button',{cls:'manual-order-value-grip',attr:{'aria-label':`Move group ${item.label}`,title:'Drag to reorder. Alt + Up/Down also moves this group.'}});setIcon(grip,'grip-vertical');grip.draggable=true;
    grip.ondragstart=event=>{dragged=item.id;event.stopPropagation();event.dataTransfer?.setData('application/x-manual-order-menu-value',item.id);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';};
    grip.ondragend=()=>{dragged=undefined;details.querySelectorAll('.is-value-drop').forEach(el=>el.classList.remove('is-value-drop'));};
    row.ondragover=event=>{if(!dragged||dragged===item.id)return;event.preventDefault();event.stopPropagation();row.classList.add('is-value-drop');};
    row.ondragleave=()=>row.classList.remove('is-value-drop');
    row.ondrop=event=>{if(!dragged||dragged===item.id)return;event.preventDefault();event.stopPropagation();const source=dragged;dragged=undefined;const box=row.getBoundingClientRect();reorder(source,item.id,event.clientY>box.top+box.height/2);};
    grip.onkeydown=event=>{if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const down=event.key==='ArrowDown',target=section.items[index+(down?1:-1)];if(target)reorder(item.id,target.id,down);};
    const check=row.createEl('input',{attr:{type:'checkbox','aria-label':`Show group ${item.label}`}});check.checked=!settings.hidden.includes(item.id);
    check.onchange=()=>save({...settings,hidden:check.checked?settings.hidden.filter(id=>id!==item.id):[...settings.hidden,item.id]});
    }
    render(row.createSpan({cls:'manual-order-value-label'}),item);row.createSpan({text:String(item.count),cls:'manual-order-group-count'});
    if(colors) {
      const current=colors.get(item.id),picker=row.createEl('input',{cls:'manual-order-group-color-picker',attr:{type:'color','aria-label':`Color for group ${item.label}`,title:'Choose group color'}});picker.value=current??'#808080';
      picker.title=current?`Group color: ${current}`:'No color assigned. Choose a group color.';
      picker.onchange=()=>colors.set(item.id,picker.value);
      const clear=row.createEl('button',{cls:'manual-order-clear-group-color',attr:{'aria-label':`Clear color for group ${item.label}`,title:'Clear group color'}});setIcon(clear,'rotate-ccw');clear.disabled=!current;clear.onclick=()=>colors.set(item.id,null);
    }
  });
  if(section.vertical===false)return;
  const controls=details.createDiv({cls:'manual-order-group-value-actions'});
  const show=controls.createEl('button',{text:'Show all'});show.onclick=()=>save({...settings,hidden:[]});
  const hide=controls.createEl('button',{text:'Hide all'});hide.onclick=()=>save({...settings,hidden:section.items.map(item=>item.id)});
  if(section.property.startsWith('note.')) {
    const form=details.createEl('form',{cls:'manual-order-add-group-value'});
    const input=form.createEl('input',{attr:{type:'text',placeholder:'New group value','aria-label':`New ${label} group value`}});
    form.createEl('button',{text:'Add group',attr:{type:'submit'}});
    form.onsubmit=event=>{event.preventDefault();event.stopPropagation();if(!input.value.trim())return;try{save({...settings,added:[...settings.added,parse(input.value)]});}catch(error){report(error);}};
  }
}
