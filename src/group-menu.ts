import type {BasesPropertyId} from 'obsidian';
import type {GroupRule} from './grouping';

/** View-owned menu: the native Bases grouping menu has no public extension API. */
export function renderGroupMenu(host:HTMLElement,rules:GroupRule[],properties:BasesPropertyId[],label:(property:BasesPropertyId)=>string,change:(rules:GroupRule[])=>void,native=false,afterRule?:(host:HTMLElement,rule:GroupRule)=>void) {
  host.createDiv({text:native?'Nested group by':'Group rows',cls:'manual-order-group-menu-title'});
  host.createDiv({text:'Levels run from outermost to innermost. Native Bases groups stay outermost.',cls:'manual-order-hint'});
  rules.forEach((rule,index)=>{
    const row=host.createDiv({cls:'manual-order-group-rule'});
    row.createSpan({text:String(index+1)});
    const property=row.createEl('select',{attr:{'aria-label':`Group level ${index+1} property`}});
    for(const id of properties.filter(id=>id===rule.property||!rules.some(rule=>rule.property===id)))property.createEl('option',{text:label(id),attr:{value:id}});
    property.value=rule.property;property.onchange=()=>change(rules.map((rule,i)=>i===index?{...rule,property:property.value as BasesPropertyId}:rule));
    const direction=row.createEl('select',{attr:{'aria-label':`Group level ${index+1} direction`}});
    direction.createEl('option',{text:'A → Z',attr:{value:'asc'}});direction.createEl('option',{text:'Z → A',attr:{value:'desc'}});
    direction.value=rule.direction;direction.onchange=()=>change(rules.map((rule,i)=>i===index?{...rule,direction:direction.value==='desc'?'desc':'asc'}:rule));
    const layout=row.createEl('select',{attr:{'aria-label':`Group level ${index+1} layout`}});
    layout.createEl('option',{text:'Horizontal',attr:{value:'horizontal'}});layout.createEl('option',{text:'Vertical',attr:{value:'vertical'}});
    layout.value=rule.layout==='vertical'?'vertical':'horizontal';
    layout.onchange=()=>change(rules.map((rule,i)=>{
      if(i!==index)return rule;
      const rest={property:rule.property,direction:rule.direction};
      return layout.value==='vertical'?{...rest,layout:'vertical'}:rest;
    }));
    const up=row.createEl('button',{text:'↑',attr:{'aria-label':`Move group level ${index+1} up`}});up.disabled=index===0;
    up.onclick=()=>{const next=[...rules];[next[index-1],next[index]]=[next[index],next[index-1]];change(next);};
    const remove=row.createEl('button',{text:'×',attr:{'aria-label':`Remove group level ${index+1}`}});remove.onclick=()=>change(rules.filter((_,i)=>i!==index));
    afterRule?.(host,rule);
  });
  const available=properties.filter(id=>!rules.some(rule=>rule.property===id));
  const row=host.createDiv({cls:'manual-order-group-rule'});
  const property=row.createEl('select',{attr:{'aria-label':'New grouping property'}});
  for(const id of available)property.createEl('option',{text:label(id),attr:{value:id}});
  const add=row.createEl('button',{text:native?'Add group by':'Add group'});add.disabled=!available.length;
  add.onclick=()=>{if(property.value)change([...rules,{property:property.value as BasesPropertyId,direction:'asc'}]);};
}
