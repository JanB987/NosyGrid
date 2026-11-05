import type {Value} from 'obsidian';
import type {RowGroup} from './grouping';
import type {GroupBinding} from './group-move';

export const RETAINED_GROUPS_KEY='manualKnownGroups';
export interface DisplayGroup<T> extends RowGroup<T> {
  children:DisplayGroup<T>[];bindings:GroupBinding[];nativeId?:string;unknownNative?:boolean;nativeValue?:Value;
}
interface RememberedGroup {key:string;parent?:string;label:string;property?:RowGroup<unknown>['property'];bindings:GroupBinding[];nativeId?:string}
interface GroupMemory {signature:string;groups:RememberedGroup[]}

/** Remember previously seen group paths even after their last note changes or disappears. */
export function retainGroups<T>(live:DisplayGroup<T>[],saved:unknown,signature:string,find:(bindings:GroupBinding[])=>GroupBinding[]|undefined,identity?:(group:DisplayGroup<T>)=>string|undefined,rowKey?:(row:T)=>string) {
  const memory=saved as GroupMemory|undefined;
  const previous=memory?.signature===signature&&Array.isArray(memory.groups)?memory.groups.filter(record=>record&&typeof record.key==='string'&&typeof record.label==='string'&&(record.parent===undefined||typeof record.parent==='string')&&record.parent!==record.key):[];
  const nodes=new Map<string,DisplayGroup<T>>(),records=new Map<string,RememberedGroup>();
  const visit=(group:DisplayGroup<T>,parent?:string)=>{
    nodes.set(group.key,group);
    if(!group.unknownNative&&group.bindings.length) {
      records.set(group.key,{key:group.key,parent,label:group.label,property:group.property,nativeId:group.nativeId,bindings:group.bindings.map(({property,value,sourcePath})=>({property,value,sourcePath}))});
    }
    for(const child of group.children)visit(child,group.key);
  };
  for(const group of live)visit(group);
  const liveKeys=new Set(nodes.keys());
  for(const record of previous) {
    if(!record||typeof record.key!=='string'||typeof record.label!=='string'||nodes.has(record.key)||!Array.isArray(record.bindings)||!record.bindings.length)continue;
    if(!record.bindings.every(binding=>binding&&typeof binding.property==='string'&&/^(note|file|formula)\..+/.test(binding.property)&&typeof binding.sourcePath==='string'&&typeof binding.value?.exists==='boolean'))continue;
    const bindings=find(record.bindings)??record.bindings;
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
  const migratedKeys=new Map<string,string>();
  // Work within sibling sets so equal values under different parents remain distinct.
  const rewritePrefix=(key:string,from:string,to:string):string=>{
    try {
      const parts:unknown=JSON.parse(key),old:unknown=JSON.parse(from),next:unknown=JSON.parse(to);
      if(!Array.isArray(parts)||!Array.isArray(old)||!Array.isArray(next)||old.length>parts.length||!old.every((part,index)=>part===parts[index]))return key;
      return JSON.stringify([...(next as unknown[]),...(parts as unknown[]).slice(old.length)]);
    } catch {return key;}
  };
  const reparent=(group:DisplayGroup<T>,oldParent:string,newParent:string,oldNative?:string,newNative?:string)=>{
    const old=group.key;group.key=rewritePrefix(old,oldParent,newParent);
    if(old!==group.key){migratedKeys.set(old,group.key);if(liveKeys.has(old))liveKeys.add(group.key);}
    if(oldNative&&group.nativeId===oldNative)group.nativeId=newNative;
    for(const child of group.children)reparent(child,oldParent,newParent,oldNative,newNative);
  };
  const normalize=(siblings:DisplayGroup<T>[])=>{
    if(identity) {
      const buckets=new Map<string,DisplayGroup<T>[]>();
      for(const group of siblings){const id=identity(group);if(id!==undefined){const bucket=buckets.get(id)??[];bucket.push(group);buckets.set(id,bucket);}}
      for(const bucket of buckets.values()) {
        if(bucket.length<2)continue;
        const winner=bucket.find(group=>liveKeys.has(group.key))??bucket[0];
        for(const other of bucket) {
          if(other===winner)continue;
          const old=other.key;migratedKeys.set(old,winner.key);
          const seen=new Set(winner.rows.map(row=>rowKey?rowKey(row):row));
          for(const row of other.rows){const key=rowKey?rowKey(row):row;if(!seen.has(key)){winner.rows.push(row);seen.add(key);}}
          for(const child of other.children){reparent(child,old,winner.key,other.nativeId,winner.nativeId);winner.children.push(child);}
          siblings.splice(siblings.indexOf(other),1);
        }
      }
    }
    for(const group of siblings)normalize(group.children);
  };
  normalize(result);
  const ordered:RememberedGroup[]=[];
  const collect=(group:DisplayGroup<T>,parent?:string)=>{
    if(!group.unknownNative&&group.bindings.length)ordered.push({key:group.key,parent,label:group.label,property:group.property,nativeId:group.nativeId,bindings:group.bindings.map(({property,value,sourcePath})=>({property,value,sourcePath}))});
    for(const child of group.children)collect(child,group.key);
  };
  for(const group of result)collect(group);
  return {groups:result,memory:ordered.length?{signature,groups:ordered}:null,migratedKeys};
}
