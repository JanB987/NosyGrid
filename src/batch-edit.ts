import {type App,type TFile} from 'obsidian';
import {editableProperty,readCells,renameTarget,sameValue,writeCell,type CellSnapshot,type CellValue} from './editing';

export interface CellChange {before:CellSnapshot;after:CellValue}
export interface CellEdit {before:CellSnapshot;after:CellSnapshot}

/** Validate the entire operation first, write once per note, and roll back completed units on failure. */
export async function applyCellBatch(app:App,input:CellChange[]):Promise<CellEdit[]> {
  const changes=input.filter(change=>!sameValue(change.before,change.after));
  const keys=new Set<string>(),renames=new Map<TFile,CellChange>(),targets=new Set<string>();
  const notes=new Map<TFile,CellChange[]>();
  const byFile=new Map<TFile,CellChange[]>(),current=new Map<string,CellSnapshot>();
  for(const change of changes){const group=byFile.get(change.before.file)??[];group.push(change);byFile.set(change.before.file,group);}
  for(const [file,group] of byFile)for(const snapshot of await readCells(app,file,group.map(change=>change.before.property)))current.set(JSON.stringify([snapshot.path,snapshot.property]),snapshot);
  for(const change of changes) {
    const {before}=change,key=JSON.stringify([before.path,before.property]);
    if(keys.has(key))throw new Error('The paste contains the same cell more than once.');keys.add(key);
    if(!editableProperty(before.property,before.file.extension))throw new Error(`${before.property} is read-only.`);
    if(before.file.path!==before.path||app.vault.getFileByPath(before.path)!==before.file)throw new Error(`${before.path} moved or was deleted.`);
    const latest=current.get(key);
    if(!latest||!sameValue(before,latest))throw new Error(`${before.file.basename}: ${before.property} changed. Paste again using the current values.`);
    if(before.property.startsWith('file.')) {
      if(renames.has(before.file))throw new Error('Paste into only one filename, path, or folder column per row at a time.');
      const target=renameTarget(before,change.after.value),occupied=app.vault.getAbstractFileByPath(target);
      if(target!==before.path&&occupied)throw new Error(`The destination already exists: ${target}`);
      if(targets.has(target.toLowerCase()))throw new Error('Two pasted filenames would use the same destination.');targets.add(target.toLowerCase());
      const folder=target.includes('/')?target.slice(0,target.lastIndexOf('/')):'';
      if(folder&&!app.vault.getFolderByPath(folder))throw new Error(`The folder does not exist: ${folder}`);
      renames.set(before.file,change);
    } else {
      const group=notes.get(before.file)??[];group.push(change);notes.set(before.file,group);
    }
  }
  const completed:{edits:CellEdit[];rollback:()=>Promise<void>}[]=[];
  const writeNote=async(group:CellChange[])=>{
    const {file,path}=group[0].before;
    await app.fileManager.processFrontMatter(file,fm=>{
      if(file.path!==path||app.vault.getFileByPath(path)!==file)throw new Error(`${path} moved during the paste.`);
      for(const change of group) {
        const key=change.before.property.slice(5);
        if(!sameValue(change.before,{exists:Object.hasOwn(fm,key),value:fm[key]}))throw new Error(`${file.basename}: ${key} changed during the paste.`);
      }
      for(const change of group) {
        const key=change.before.property.slice(5);
        if(change.after.exists)Object.defineProperty(fm,key,{value:change.after.value,writable:true,enumerable:true,configurable:true});else delete fm[key];
      }
    });
  };
  try {
    for(const group of notes.values()) {
      await writeNote(group);
      const edits=group.map(({before,after})=>({before,after:{...before,...after}}));
      completed.push({edits,rollback:()=>writeNote(edits.map(edit=>({before:edit.after,after:edit.before})))});
    }
    for(const change of renames.values()) {
      const after=await writeCell(app,change.before,change.after),edit={before:change.before,after};
      completed.push({edits:[edit],rollback:async()=>{await writeCell(app,after,change.before);}});
    }
  } catch(error) {
    const failed:string[]=[];
    for(const unit of [...completed].reverse()) {
      try {await unit.rollback();}catch{failed.push(...unit.edits.map(edit=>`${edit.before.file.path}: ${edit.before.property}`));}
    }
    if(failed.length)throw new Error(`Paste failed. These cells could not be restored because they changed or could not be written: ${failed.join(', ')}. ${String(error)}`);
    throw error;
  }
  const edits=completed.flatMap(unit=>unit.edits);
  for(const edit of edits)if(edit.after.property.startsWith('note.'))edit.after.path=edit.after.file.path;
  return edits;
}
