import { getFrontMatterInfo, parseYaml, stringifyYaml, type App, type TFile, type BasesPropertyId } from 'obsidian';

export type EditorType = 'text' | 'number' | 'checkbox' | 'date' | 'datetime' | 'list' | 'yaml';
export interface CellValue { exists: boolean; value: unknown }
export interface CellSnapshot extends CellValue { file: TFile; path: string; property: BasesPropertyId }
const fileFields = new Set(['file.name', 'file.basename', 'file.path', 'file.folder']);

/** Obsidian's property-name → type mapping, read without modifying vault settings. */
export function parsePropertyTypes(json: string): Map<string,EditorType> {
  const types: Record<string,EditorType> = {text:'text',number:'number',checkbox:'checkbox',date:'date',datetime:'datetime',multitext:'list',list:'list',tags:'list',aliases:'list'};
  const parsed:unknown=JSON.parse(json);
  const result=new Map<string,EditorType>();
  if(!parsed || typeof parsed!=='object' || !('types' in parsed) || !parsed.types || typeof parsed.types!=='object') return result;
  for(const [name,type] of Object.entries(parsed.types)) if(typeof type==='string' && Object.hasOwn(types,type)) result.set(name,types[type]);
  return result;
}

export function editableProperty(property: BasesPropertyId, extension: string): boolean {
  if (fileFields.has(property)) return true;
  return extension === 'md' && property.startsWith('note.') &&
    !!property.slice(5) && !['__proto__', 'prototype', 'constructor'].includes(property.slice(5));
}

export function inferType(value: unknown, name: string): EditorType {
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) return value.every(v=>typeof v==='string') ? 'list' : 'yaml';
  if (value !== null && typeof value === 'object') return 'yaml';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(value)) return 'datetime';
    return 'text';
  }
  if (['tags','aliases','cssclasses'].includes(name)) return 'list';
  return 'text';
}

export function formatValue(value: unknown, type: EditorType): string {
  if (value == null) return '';
  if (type === 'yaml') return stringifyYaml(value).trimEnd();
  if (type === 'list') return Array.isArray(value) ? value.join('\n') : String(value);
  if (type === 'datetime') return String(value).replace(' ', 'T');
  return String(value);
}

function validDate(text: string): boolean {
  const date = text.slice(0,10);
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===date;
}

export function parseEditorValue(text: string, type: EditorType, checked = false): CellValue {
  if (type === 'checkbox') return {exists:true,value:checked};
  if (!text.trim()) return {exists:false,value:undefined};
  let value: unknown = text;
  if (type === 'number') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()) || !Number.isFinite(Number(text))) {
      throw new Error('Enter a finite number.');
    }
    value = Number(text);
  } else if (type === 'date' || type === 'datetime') {
    const pattern = type === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
    if (!pattern.test(text) || !validDate(text) || (type==='datetime' && (Number(text.slice(11,13))>23 || Number(text.slice(14,16))>59 || Number(text.slice(17,19)||0)>59))) {
      throw new Error(`Enter a valid ${type === 'date' ? 'date' : 'date and time'}.`);
    }
  } else if (type === 'list') value = text.split(/\r?\n/).map(item=>item.trim()).filter(Boolean);
  else if (type === 'yaml') value = parseYaml(text);
  return {exists:true,value};
}

// Preserve the distinction between a missing key, null, false, zero and an empty string.
export function sameValue(a: CellValue, b: CellValue): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
    return value;
  };
  return a.exists === b.exists && JSON.stringify(canonical(a.value)) === JSON.stringify(canonical(b.value));
}

function fileValue(file: TFile, property: BasesPropertyId): string {
  if (property === 'file.path') return file.path;
  if (property === 'file.folder') return file.path.includes('/') ? file.path.slice(0,file.path.lastIndexOf('/')) : '';
  return property==='file.basename' ? file.basename : file.name;
}

export async function readCell(app: App, file: TFile, property: BasesPropertyId): Promise<CellSnapshot> {
  return (await readCells(app,file,[property]))[0];
}

export async function readCells(app:App,file:TFile,properties:BasesPropertyId[]):Promise<CellSnapshot[]> {
  for(const property of properties)if(!editableProperty(property,file.extension))throw new Error(`${property} is read-only.`);
  const path = file.path;
  let fm:Record<string,unknown>={};
  if(properties.some(property=>property.startsWith('note.'))) {
    const text=await app.vault.read(file);if(file.path!==path)throw new Error('The file moved while reading properties. Try again.');
    const info=getFrontMatterInfo(text);fm=info.exists?parseYaml(info.frontmatter)??{}:{};
    if(typeof fm!=='object'||Array.isArray(fm))throw new Error('Frontmatter must be a property map.');
  }
  return properties.map(property=>property.startsWith('file.')?{file,path,property,exists:true,value:fileValue(file,property)}:
    {file,path,property,exists:Object.hasOwn(fm,property.slice(5)),value:fm[property.slice(5)]});
}

export function renameTarget(snapshot: CellSnapshot, value: unknown): string {
  const text = String(value ?? '').trim();
  const file = snapshot.file;
  const folder = snapshot.path.includes('/') ? snapshot.path.slice(0,snapshot.path.lastIndexOf('/')) : '';
  let target: string;
  if (snapshot.property==='file.path') target = text;
  else if (snapshot.property==='file.folder') target = text ? `${text}/${file.name}` : file.name;
  else {
    if (!text || /[/\\]/.test(text)) throw new Error('Enter a file name without a folder path.');
    target = (folder ? `${folder}/` : '') + (snapshot.property==='file.basename' ? `${text}.${file.extension}` : text);
  }
  if (!target || /[\\:*?"<>|\x00-\x1f]/.test(target) || target.split('/').some(part=>!part || part==='.' || part==='..' || /[. ]$/.test(part))) {
    throw new Error('Enter a valid vault-relative path.');
  }
  if (!target.toLowerCase().endsWith(`.${file.extension.toLowerCase()}`)) throw new Error(`Keep the .${file.extension} extension. Use the File name editor to rename the file.`);
  return target;
}

export async function writeCell(app: App, snapshot: CellSnapshot, next: CellValue): Promise<CellSnapshot> {
  const {file,path,property} = snapshot;
  if (file.path!==path || app.vault.getFileByPath(path)!==file) throw new Error('The file was moved or deleted. Reopen the cell.');
  if (!editableProperty(property,file.extension)) throw new Error('This property is read-only.');
  if (property.startsWith('file.')) {
    if (!sameValue(snapshot,{exists:true,value:fileValue(file,property)})) throw new Error('The file changed. Reopen the cell.');
    const target = renameTarget(snapshot,next.value);
    if (target!==path) {
      if (app.vault.getAbstractFileByPath(target)) throw new Error('A file already exists at that path.');
      const folder = target.includes('/') ? target.slice(0,target.lastIndexOf('/')) : '';
      if (folder && !app.vault.getFolderByPath(folder)) throw new Error('Choose an existing folder.');
      await app.fileManager.renameFile(file,target);
    }
    return {file,path:file.path,property,exists:true,value:fileValue(file,property)};
  }
  const key = property.slice(5);
  await app.fileManager.processFrontMatter(file, fm => {
    if(file.path!==path) throw new Error('The file moved while saving. Reopen the cell.');
    if (!sameValue(snapshot,{exists:Object.hasOwn(fm,key),value:fm[key]})) throw new Error('This property changed elsewhere. Your input is kept; copy it or cancel and reopen the cell.');
    if (next.exists) Object.defineProperty(fm,key,{value:next.value,writable:true,enumerable:true,configurable:true});
    else delete fm[key];
  });
  return {file,path,property,...next};
}
