import type {BasesPropertyId} from 'obsidian';
import {isRecord} from './validation';

export const GROUPS_KEY='manualGroups';
export const COLLAPSED_KEY='manualCollapsedGroups';
export const NATIVE_LAYOUT_KEY='manualNativeGroupLayout';
export type GroupLayout='horizontal'|'vertical';
export interface GroupRule {property:BasesPropertyId;direction:'asc'|'desc';layout?:GroupLayout}
export interface RowGroup<T> {key:string;label:string;property?:BasesPropertyId;rows:T[];children:RowGroup<T>[]}

export function readGroupRules(value:unknown):GroupRule[] {
  if(!Array.isArray(value))return [];
  const seen=new Set<string>();
  const rules:unknown[]=value;
  return rules.flatMap(rule=>{
    if(!isRecord(rule)||typeof rule.property!=='string'||! /^(note|file|formula)\..+/.test(rule.property)||seen.has(rule.property))return [];
    seen.add(rule.property);return [{property:rule.property as BasesPropertyId,direction:rule.direction==='desc'?'desc' as const:'asc' as const,...(rule.layout==='vertical'?{layout:'vertical' as const}:{})}];
  });
}

export function groupValueKey(value:unknown):string {
  if(value===undefined||value===null||value==='')return 'empty';
  if(Array.isArray(value))return `list:${JSON.stringify(value.map(groupValueKey))}`;
  if(typeof value==='object')return `object:${JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,groupValueKey(value)]))}`;
  return `${typeof value}:${String(value)}`;
}

/** Partition once per level; each note belongs to exactly one leaf, including list-valued keys. */
export function groupRows<T>(rows:T[],rules:GroupRule[],value:(row:T,property:BasesPropertyId)=>unknown,parent:string[]=[],identity?:(row:T,property:BasesPropertyId,value:unknown)=>unknown):RowGroup<T>[] {
  if(!rules.length)return [];
  const [rule,...rest]=rules,buckets=new Map<string,{value:unknown;rows:T[]}>();
  for(const row of rows){const raw=value(row,rule.property),key=groupValueKey(identity?identity(row,rule.property,raw):raw);let bucket=buckets.get(key);if(!bucket){bucket={value:raw,rows:[]};buckets.set(key,bucket);}bucket.rows.push(row);}
  return [...buckets.entries()].sort(([a,left],[b,right])=>{
    const order=typeof left.value==='number'&&typeof right.value==='number'?left.value-right.value:a.localeCompare(b,undefined,{numeric:true});
    return rule.direction==='desc'?-order:order;
  }).map(([token,bucket])=>{
    const path=[...parent,rule.property,token],key=JSON.stringify(path);
    const label=token==='empty'?'No value':Array.isArray(bucket.value)?bucket.value.map(String).join(', '):typeof bucket.value==='object'?JSON.stringify(bucket.value):String(bucket.value);
    return {key,label,property:rule.property,rows:bucket.rows,children:groupRows(bucket.rows,rest,value,path,identity)};
  });
}
