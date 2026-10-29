export interface WikiContext { start:number; end:number; query:string; content:string }
export interface WikiPart { text:string; target?:string; label?:string }

function escaped(text:string,index:number):boolean {
  let count=0;while(index>0 && text[--index]==='\\') count++;
  return count%2===1;
}

/** Only the token under the caret is searched/replaced, never a neighbouring link. */
export function activeWikilink(text:string,caret:number,end=caret):WikiContext|undefined {
  if(caret!==end) return;
  const start=text.lastIndexOf('[[',caret-1);
  if(start<0 || caret<start+2 || escaped(text,start)) return;
  const before=text.slice(start+2,caret);
  if(/[\r\n\[\]]/.test(before) || before.includes('|')) return;
  const close=text.indexOf(']]',start+2);
  const boundary=text.slice(caret).search(/[\r\n]|\[\[/);
  const hasClose=close>=caret && (boundary<0 || close<caret+boundary);
  return {start,end:hasClose?close+2:caret,query:before,content:text.slice(start+2,hasClose?close:caret)};
}

export function replaceWikilink(text:string,context:WikiContext,target:string,alias?:string):{value:string;caret:number} {
  const pipe=context.content.indexOf('|');
  const originalAlias=pipe<0?'':context.content.slice(pipe+1);
  const path=pipe<0?context.content:context.content.slice(0,pipe);
  const hash=path.indexOf('#');
  const subpath=!target.includes('#') && hash>=0 ? path.slice(hash) : '';
  const display=originalAlias||alias;
  const inserted=`[[${target}${subpath}${display?`|${display}`:''}]]`;
  return {value:text.slice(0,context.start)+inserted+text.slice(context.end),caret:context.start+inserted.length};
}

/** Preserve all surrounding text, including multiple links in the same list item. */
export function splitWikilinks(text:string):WikiPart[] {
  const result:WikiPart[]=[];
  const pattern=/\[\[([^\[\]\r\n]+)\]\]/g;
  let offset=0;
  for(const match of text.matchAll(pattern)) {
    const start=match.index!;
    if(escaped(text,start)) continue;
    const pipe=match[1].indexOf('|');
    const target=(pipe<0?match[1]:match[1].slice(0,pipe)).trim();
    if(!target) continue;
    if(start>offset) result.push({text:text.slice(offset,start)});
    const label=pipe<0?target:match[1].slice(pipe+1);
    result.push({text:match[0],target,label});offset=start+match[0].length;
  }
  if(offset<text.length || !result.length) result.push({text:text.slice(offset)});
  return result;
}

/** Locate a complete link in the raw text editor, including an alias or subpath. */
export function wikilinkAt(text:string,position:number):WikiPart|undefined {
  let offset=0;
  for(const part of splitWikilinks(text)) {
    const end=offset+part.text.length;
    if(part.target && position>=offset && position<end)return part;
    offset=end;
  }
}
