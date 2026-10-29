import type {App,TFile} from 'obsidian';

export function isRecord(value:unknown):value is Record<string,unknown> {
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
export function expectRecord(value:unknown):Record<string,unknown> {
  if(!isRecord(value))throw new Error('Frontmatter must be a property map.');
  return value;
}
export function fileProperties(app:App,file:TFile):Record<string,unknown> {
  const value:unknown=app.metadataCache.getFileCache(file)?.frontmatter;
  return isRecord(value)?value:{};
}
export function boardProperty(scope:string):string|undefined {
  const value:unknown=JSON.parse(scope);
  if(!Array.isArray(value))return;
  const parts:unknown[]=value;
  return typeof parts[1]==='string'?parts[1]:undefined;
}
