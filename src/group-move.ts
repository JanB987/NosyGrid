import type {App,BasesPropertyId,Value,ListValue} from 'obsidian';
import {splitWikilinks} from './link-syntax';
import {linkForDestination,linkDragPayload} from './link-drag';
import type {CellValue} from './editing';

export interface GroupBinding {property:BasesPropertyId;value:CellValue;sourcePath:string;original?:CellValue}
export const ROW_DRAG_TYPE='application/x-manual-order-bases-rows';

/** Native grouping has no public accessor. Keep this read-only compatibility access isolated. */
export function nativeGroupProperty(config:unknown):BasesPropertyId|undefined {
  const property=(config as {groupBy?:{property?:unknown}})?.groupBy?.property;
  return typeof property==='string'&&/^(note|file|formula)\..+/.test(property)?property as BasesPropertyId:undefined;
}

export function nativeGroupScope(config:unknown):unknown {
  const native=config as {groupBy?:{direction?:unknown};groupOrder?:unknown};
  return [nativeGroupProperty(config),native?.groupBy?.direction,Array.isArray(native?.groupOrder)?native.groupOrder:null];
}

/** Rebase complete wiki tokens, preserving prose, aliases, headings and primitive/list types. */
export function rebaseGroupValue(value:unknown,app:App,source:string,destination:string):unknown {
  if(Array.isArray(value))return value.map(item=>rebaseGroupValue(item,app,source,destination));
  if(typeof value!=='string')return structuredClone(value);
  return splitWikilinks(value).map(part=>{
    if(!part.target||source===destination)return part.text;
    // Reuse the same public link resolution as cell-to-cell link dragging.
    const payload=linkDragPayload(app,source,part.text);return payload?linkForDestination(app,payload,destination):part.text;
  }).join('');
}

/** Comparable group identity ignores aliases and source-relative spelling of note links. */
export function groupIdentity(value:unknown,app:App,source:string):unknown {
  if(value===null||value===undefined||value==='')return undefined;
  if(Array.isArray(value))return value.map(item=>groupIdentity(item,app,source));
  if(typeof value!=='string')return value;
  return splitWikilinks(value).map(part=>{
    if(!part.target)return part.text;
    const raw=rebaseGroupValue(part.text,app,source,'') as string;
    const content=raw.slice(2,-2);return `[[${content.split('|')[0]}]]`;
  }).join('');
}

/** Empty native groups have no representative note; public Values still supply their typed key. */
export function nativeGroupValue(value:Value|undefined):CellValue {
  const type=value?(value.constructor as typeof Value).type:undefined;
  if(!value||type==='null')return {exists:false,value:undefined};
  if(type==='list') {
    const list=value as ListValue;
    return {exists:true,value:Array.from({length:list.length()},(_,i)=>{const item=nativeGroupValue(list.get(i));return item.exists?item.value:null;})};
  }
  const raw=value.toString();
  if(!raw)return {exists:false,value:undefined};
  if(type==='number')return {exists:true,value:Number(raw)};
  if(type==='boolean')return {exists:true,value:raw==='true'};
  return {exists:true,value:raw};
}
