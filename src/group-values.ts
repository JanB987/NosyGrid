import type {BasesPropertyId} from 'obsidian';
import type {DisplayGroup} from './retained-groups';

export const GROUP_VALUES_KEY='manualGroupValues';
export interface ValueSettings {hidden:string[];added:unknown[];order:string[]}
export interface ValueItem {id:string;label:string;count:number;value:unknown;source:string}
export interface ValueSection {property:BasesPropertyId;items:ValueItem[];scopes:string[];vertical?:boolean}
export function readValueSettings(raw:unknown):Record<string,ValueSettings> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  return Object.fromEntries(Object.entries(raw).filter(([key,value])=>/^(note|file|formula)\..+/.test(key)&&value&&typeof value==='object').map(([key,value])=>{
    const item=value as Partial<ValueSettings>,strings=(value:unknown)=>Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==='string'))]:[];
    return [key,{hidden:strings(item.hidden),order:strings(item.order),added:Array.isArray(item.added)?item.added:[]}];
  }));
}

/** Explicitly added values are view-local destinations, even before any note uses them. */
export function addGroupValues<T>(groups:DisplayGroup<T>[],settings:Record<string,ValueSettings>,vertical:(group:DisplayGroup<T>)=>boolean,identity:(group:DisplayGroup<T>)=>string,create:(template:DisplayGroup<T>,value:unknown)=>DisplayGroup<T>):void {
  if(!groups.length)return;
  const template=groups[0],property=template.property??template.bindings[0]?.property;
  if(vertical(template)&&property) {
    const seen=new Set<string>();
    // A manually added destination may acquire a native/live key after notes arrive.
    for(let i=0;i<groups.length;) {const id=identity(groups[i]);if(seen.has(id))groups.splice(i,1);else{seen.add(id);i++;}}
    for(const value of settings[property]?.added??[]) {const group=create(template,value),id=identity(group);if(!seen.has(id)){seen.add(id);groups.push(group);}}
  }
  for(const group of groups)addGroupValues(group.children,settings,vertical,identity,create);
}
