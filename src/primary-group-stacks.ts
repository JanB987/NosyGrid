import {MAX_BOARD_WIDTH,MIN_BOARD_WIDTH} from './board-layout';

export const PRIMARY_STACKS_KEY='manualPrimaryGroupStacks';
export interface PrimaryStackColumn {id:string;groups:string[];width?:number}
export interface PrimaryStackBoard {columns:PrimaryStackColumn[]}
export interface PrimaryStackLayouts {version:1;boards:Record<string,PrimaryStackBoard>}
export type PrimaryStackEdge='above'|'below'|'before-column'|'after-column';
const validWidth=(width:unknown):width is number=>typeof width==='number'&&Number.isFinite(width)&&width>=MIN_BOARD_WIDTH&&width<=MAX_BOARD_WIDTH;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function readPrimaryStackLayouts(raw:unknown):PrimaryStackLayouts {
  const boards:Record<string,PrimaryStackBoard>=Object.create(null) as Record<string,PrimaryStackBoard>;
  if(!object(raw)||raw.version!==1||!object(raw.boards))return {version:1,boards};
  for(const [scope,value]of Object.entries(raw.boards)) {
    if(!object(value)||!Array.isArray(value.columns))continue;
    const ids=new Set<string>(),groups=new Set<string>(),columns:PrimaryStackColumn[]=[];
    for(const item of value.columns) {
      if(!object(item)||typeof item.id!=='string'||!item.id||ids.has(item.id)||!Array.isArray(item.groups))continue;
      const members:string[]=[];
      for(const group of item.groups)if(typeof group==='string'&&group&&!groups.has(group)){groups.add(group);members.push(group);}
      if(!members.length)continue;
      ids.add(item.id);columns.push({id:item.id,groups:members,...(validWidth(item.width)?{width:item.width}:{})});
    }
    boards[scope]={columns};
  }
  return {version:1,boards};
}
export function reconcilePrimaryStackBoard(saved:PrimaryStackBoard|undefined,defaultOrder:string[],removedIds:Iterable<string>,legacyWidth:(id:string)=>number|undefined):PrimaryStackBoard {
  const removed=new Set(removedIds),seen=new Set<string>();
  const columns=(saved?.columns??[]).map(column=>({...column,groups:column.groups.filter(id=>!removed.has(id)&&!seen.has(id)&&!!seen.add(id))})).filter(column=>column.groups.length);
  const ids=new Set(columns.map(column=>column.id));
  for(const group of defaultOrder)if(!removed.has(group)&&!seen.has(group)) {
    seen.add(group);let id=JSON.stringify(['primary-stack',group]),suffix=0;while(ids.has(id))id=JSON.stringify(['primary-stack',group,++suffix]);ids.add(id);
    const width=saved?undefined:legacyWidth(group);columns.push({id,groups:[group],...(validWidth(width)?{width}:{})});
  }
  return {columns};
}
export function projectPrimaryStackBoard(board:PrimaryStackBoard,visibleIds:Iterable<string>):PrimaryStackBoard {
  const visible=new Set(visibleIds);return {columns:board.columns.map(column=>({...column,groups:column.groups.filter(id=>visible.has(id))})).filter(column=>column.groups.length)};
}
export function movePrimaryStackGroup(board:PrimaryStackBoard,sourceId:string,targetId:string,edge:PrimaryStackEdge,split:{id:string;width?:number}):PrimaryStackBoard {
  const source=board.columns.findIndex(column=>column.groups.includes(sourceId)),target=board.columns.findIndex(column=>column.groups.includes(targetId));
  if(source<0||target<0||(sourceId===targetId&&(edge==='above'||edge==='below')))return board;
  const side=edge==='before-column'||edge==='after-column';
  if(sourceId===targetId&&(!side||board.columns[source].groups.length===1))return board;
  const columns=board.columns.map(column=>({...column,groups:[...column.groups]})),from=columns[source],singleton=from.groups.length===1;
  from.groups=from.groups.filter(id=>id!==sourceId);if(!from.groups.length)columns.splice(source,1);
  if(side) {
    const targetColumn=sourceId===targetId?from:columns.find(column=>column.groups.includes(targetId));
    if(!targetColumn)return board;
    const index=columns.indexOf(targetColumn)+(edge==='after-column'?1:0);
    const newColumn=singleton?{...from,groups:[sourceId]}:{id:split.id,groups:[sourceId],...(validWidth(split.width)?{width:split.width}:{})};
    columns.splice(index,0,newColumn);
  } else {
    const dest=columns.find(column=>column.groups.includes(targetId));if(!dest)return board;
    dest.groups.splice(dest.groups.indexOf(targetId)+(edge==='below'?1:0),0,sourceId);
  }
  const next={columns};return JSON.stringify(next)===JSON.stringify(board)?board:next;
}
export function setPrimaryStackWidth(board:PrimaryStackBoard,columnId:string,width:number|undefined):PrimaryStackBoard {
  if(width!==undefined&&!validWidth(width))return board;
  const column=board.columns.find(item=>item.id===columnId);if(!column||column.width===width)return board;
  return {columns:board.columns.map(item=>{if(item!==column)return item;const copy={...item};if(width===undefined)delete copy.width;else copy.width=width;return copy;})};
}
export function reorderPrimarySingletons(board:PrimaryStackBoard,orderedIds:string[]):PrimaryStackBoard {
  if(board.columns.some(column=>column.groups.length!==1))return board;
  const byGroup=new Map(board.columns.map(column=>[column.groups[0],column])),seen=new Set<string>(),columns:PrimaryStackColumn[]=[];
  for(const id of orderedIds){const column=byGroup.get(id);if(column&&!seen.has(id)){seen.add(id);columns.push(column);}}
  for(const column of board.columns)if(!seen.has(column.groups[0]))columns.push(column);
  return columns.every((column,index)=>column===board.columns[index])?board:{columns};
}
