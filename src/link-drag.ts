import {parseLinktext,type App} from 'obsidian';
import {isRecord} from './validation';
import {splitWikilinks} from './link-syntax';
import {type CellValue} from './editing';

export const LINK_DRAG_TYPE='application/x-manual-order-bases-link';
export interface DraggedLink {version:1;sourcePath:string;link:string;resolvedPath?:string}

function singleLink(text:string) {
  const parts=splitWikilinks(text);
  return parts.length===1 && parts[0].target && parts[0].text===text?parts[0]:undefined;
}
export function hasLinkDrag(data:DataTransfer|null):boolean {return !!data && Array.from(data.types??[]).includes(LINK_DRAG_TYPE);}

export function linkDragPayload(app:App,sourcePath:string,text:string):DraggedLink|undefined {
  const link=text.trim(),part=singleLink(link);if(!part)return;
  const parsed=parseLinktext(part.target!);
  const file=parsed.path?app.metadataCache.getFirstLinkpathDest(parsed.path,sourcePath):app.vault.getFileByPath(sourcePath);
  return {version:1,sourcePath,link,resolvedPath:file?.path};
}
export function writeLinkDrag(data:DataTransfer,app:App,sourcePath:string,text:string):boolean {
  const payload=linkDragPayload(app,sourcePath,text);if(!payload)return false;
  const link=payload.link;
  data.setData(LINK_DRAG_TYPE,JSON.stringify(payload));data.setData('text/plain',link);data.effectAllowed='copy';return true;
}
export function readLinkDrag(data:DataTransfer|null):DraggedLink|undefined {
  if(!hasLinkDrag(data))return;
  try {
    const raw=data!.getData(LINK_DRAG_TYPE);if(raw.length>65536)return;
    const value:unknown=JSON.parse(raw);
    if(!isRecord(value)||value.version!==1 || typeof value.sourcePath!=='string' || /[\r\n\0]/.test(value.sourcePath) || typeof value.link!=='string' || !singleLink(value.link))return;
    if(value.resolvedPath!==undefined && typeof value.resolvedPath!=='string')return;
    return {version:1,sourcePath:value.sourcePath,link:value.link,resolvedPath:value.resolvedPath};
  } catch {return;}
}

export function linkForDestination(app:App,payload:DraggedLink,destinationPath:string):string {
  const part=singleLink(payload.link);if(!part)throw new Error('The dragged link is invalid.');
  const {path,subpath}=parseLinktext(part.target!);
  const file=payload.resolvedPath?app.vault.getFileByPath(payload.resolvedPath)
    :path?app.metadataCache.getFirstLinkpathDest(path,payload.sourcePath):app.vault.getFileByPath(payload.sourcePath);
  if(payload.resolvedPath && !file)throw new Error('The linked file moved or was deleted during the drag. Please try again.');
  let target=file?app.metadataCache.fileToLinktext(file,destinationPath,true):path;
  if(!file && /^\.\.?\//.test(path)) {
    const segments=payload.sourcePath.split('/').slice(0,-1);
    for(const segment of path.split('/')) {
      if(segment==='..') {if(!segments.length)throw new Error('The link points outside the vault.');segments.pop();}
      else if(segment && segment!=='.')segments.push(segment);
    }
    target=segments.join('/');
  }
  const content=payload.link.slice(2,-2),pipe=content.indexOf('|');
  return `[[${target}${subpath}${pipe<0?'':content.slice(pipe)}]]`;
}

export function appendTextLink(value:unknown,link:string):string {
  if(value===null||value===undefined||value==='')return link;
  if(typeof value!=='string')throw new Error('This Text property contains a non-text value. Choose a Text or List cell.');
  return value+(/\s$/.test(value)?'':' ')+link;
}
export function appendLinkValue(value:unknown,type:'text'|'list',link:string):CellValue {
  if(type==='text')return {exists:true,value:appendTextLink(value,link)};
  const items:unknown[]=Array.isArray(value)?value:value==null?[]:[value];
  return {exists:true,value:[...items,link]};
}

export function clearLinkDropTargets(doc:Document) {doc.querySelectorAll('.manual-order-link-drop-target').forEach(cell=>cell.classList.remove('manual-order-link-drop-target'));}
export function makeLinkDraggable(element:HTMLElement,app:App,sourcePath:string,link:string) {
  element.draggable=true;
  element.addEventListener('dragstart',event=>{
    if(event.dataTransfer && writeLinkDrag(event.dataTransfer,app,sourcePath,link))event.stopImmediatePropagation();
  },true);
  element.addEventListener('dragend',()=>clearLinkDropTargets(element.ownerDocument));
}
export function bindSelectedLinkDrag(input:HTMLInputElement|HTMLTextAreaElement,app:App,sourcePath:string):()=>void {
  const start=(event:Event)=>{
    const drag=event as DragEvent;
    if(!drag.dataTransfer || input.selectionStart===null || input.selectionEnd===null)return;
    const text=input.value.slice(input.selectionStart,input.selectionEnd);
    if(text && writeLinkDrag(drag.dataTransfer,app,sourcePath,text))event.stopImmediatePropagation();
  };
  const end=()=>clearLinkDropTargets(input.ownerDocument);
  input.addEventListener('dragstart',start);input.addEventListener('dragend',end);
  return ()=>{input.removeEventListener('dragstart',start);input.removeEventListener('dragend',end);};
}
