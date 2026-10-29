import type {Value} from 'obsidian';
import type {RowGroup} from './grouping';
import type {GroupBinding} from './group-move';

export const RETAINED_GROUPS_KEY='manualKnownGroups';
export interface DisplayGroup<T> extends RowGroup<T> {
  children:DisplayGroup<T>[];bindings:GroupBinding[];nativeId?:string;unknownNative?:boolean;nativeValue?:Value;
}
interface RememberedGroup {key:string;parent?:string;label:string;property?:RowGroup<unknown>['property'];bindings:GroupBinding[];nativeId?:string}
interface GroupMemory {signature:string;groups:RememberedGroup[]}

/** Keep only previously seen groups, with live vault evidence for each empty full path. */
export function retainGroups<T>(live:DisplayGroup<T>[],saved:unknown,signature:string,find:(bindings:GroupBinding[])=>GroupBinding[]|undefined) {
  const memory=saved as GroupMemory|undefined;
  const previous=memory?.signature===signature&&Array.isArray(memory.groups)?memory.groups.filter(record=>record&&typeof record.key==='string'&&typeof record.label==='string'&&(record.parent===undefined||typeof record.parent==='string')&&record.parent!==record.key):[];
  const nodes=new Map<string,DisplayGroup<T>>(),records=new Map<string,RememberedGroup>();
  const visit=(group:DisplayGroup<T>,parent?:string)=>{
    nodes.set(group.key,group);
    if(!group.unknownNative&&group.bindings.length&&group.bindings.every(binding=>!binding.property.startsWith('formula.'))) {
      records.set(group.key,{key:group.key,parent,label:group.label,property:group.property,nativeId:group.nativeId,bindings:group.bindings.map(({property,value,sourcePath})=>({property,value,sourcePath}))});
    }
    for(const child of group.children)visit(child,group.key);
  };
  for(const group of live)visit(group);
  const liveKeys=new Set(nodes.keys());
  for(const record of previous) {
    if(!record||typeof record.key!=='string'||typeof record.label!=='string'||nodes.has(record.key)||!Array.isArray(record.bindings)||!record.bindings.length)continue;
    if(!record.bindings.every(binding=>binding&&typeof binding.property==='string'&&/^(note|file)\..+/.test(binding.property)&&typeof binding.sourcePath==='string'&&typeof binding.value?.exists==='boolean'))continue;
    const bindings=find(record.bindings);if(!bindings)continue;
    nodes.set(record.key,{key:record.key,label:record.label,property:record.property,rows:[],children:[],bindings,nativeId:record.nativeId});
    records.set(record.key,{...record,bindings:bindings.map(({property,value,sourcePath})=>({property,value,sourcePath}))});
  }
  const result=[...live];
  // Insert retained siblings at their former positions where possible.
  for(let i=0;i<previous.length;i++) {
    const record=previous[i],node=nodes.get(record?.key);if(!node||!records.has(record.key)||liveKeys.has(record.key)||records.get(record.key)?.parent!==record.parent)continue;
    const siblings=record.parent?nodes.get(record.parent)?.children:result;
    if(!siblings){nodes.delete(record.key);records.delete(record.key);continue;}
    if(siblings.some(group=>group.key===node.key))continue;
    const following=previous.slice(i+1).find(next=>next.parent===record.parent&&siblings.some(group=>group.key===next.key));
    const index=following?siblings.findIndex(group=>group.key===following.key):siblings.length;
    siblings.splice(index,0,node);
  }
  const ordered:RememberedGroup[]=[];
  const collect=(group:DisplayGroup<T>)=>{const record=records.get(group.key);if(record)ordered.push(record);for(const child of group.children)collect(child);};
  for(const group of result)collect(group);
  return {groups:result,memory:ordered.length?{signature,groups:ordered}:null};
}
