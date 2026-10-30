import type {BasesPropertyId} from 'obsidian';

export const GROUP_VALUES_KEY='manualGroupValues';
export interface ValueSettings {hidden:string[];added:unknown[];order:string[];known?:unknown[];removed?:string[]}
export interface ValueItem {id:string;label:string;count:number;value:unknown;source:string}
export interface ValueSection {property:BasesPropertyId;items:ValueItem[];scopes:string[];vertical?:boolean}
export function readValueSettings(raw:unknown):Record<string,ValueSettings> {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  return Object.fromEntries(Object.entries(raw).filter(([key,value])=>/^(note|file|formula)\..+/.test(key)&&value&&typeof value==='object').map(([key,value])=>{
    const item=value as Partial<ValueSettings>,strings=(value:unknown)=>Array.isArray(value)?[...new Set(value.filter((id):id is string=>typeof id==='string'))]:[];
    return [key,{hidden:strings(item.hidden),order:strings(item.order),added:Array.isArray(item.added)?item.added:[],known:Array.isArray(item.known)?item.known:[],removed:strings(item.removed)}];
  }));
}
