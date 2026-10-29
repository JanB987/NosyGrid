import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/editing.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/editing.mjs',external:['yaml'],alias:{obsidian:`${process.cwd()}/tests/obsidian-mock.mjs`}});
const {parseEditorValue,inferType,renameTarget,editableProperty,sameValue,parsePropertyTypes}=await import(pathToFileURL(`${process.cwd()}/test-build/editing.mjs`));

test('numbers support negatives, decimals and exponent notation without string coercion',()=>{
  for(const [input,value] of [['0',0],['-1.5',-1.5],['1e3',1000]]) assert.deepEqual(parseEditorValue(input,'number'),{exists:true,value});
  for(const text of ['Infinity','NaN','0xff','1,5']) assert.throws(()=>parseEditorValue(text,'number'));
  assert.equal(parseEditorValue('001','text').value,'001');
  assert.equal(parseEditorValue('false','text').value,'false');
});
test('dates validate the calendar, including leap days, before saving',()=>{
  assert.equal(parseEditorValue('2024-02-29','date').value,'2024-02-29');
  for(const text of ['2025-02-29','2026-02-31','2026-13-01']) assert.throws(()=>parseEditorValue(text,'date'));
  assert.equal(parseEditorValue('2026-10-28T09:30:15','datetime').value,'2026-10-28T09:30:15');
  assert.throws(()=>parseEditorValue('2026-10-28T25:30','datetime'));
});
test('structured values, null and empty keys stay distinct',()=>{
  assert.deepEqual(parseEditorValue('nested:\n  enabled: true\n  count: 0','yaml').value,{nested:{enabled:true,count:0}});
  assert.equal(parseEditorValue('null','yaml').value,null);
  assert.deepEqual(parseEditorValue('','text'),{exists:false,value:undefined});
  assert.equal(sameValue({exists:false,value:undefined},{exists:true,value:null}),false);
  assert.equal(sameValue({exists:true,value:{a:1,b:false}},{exists:true,value:{b:false,a:1}}),true);
  assert.equal(inferType(['a','b'],'tags'),'list');
  assert.equal(inferType([1,'b'],'tags'),'yaml');
});
test('file moves stay within the vault and retain file type',()=>{
  const file={path:'Folder/Original.md',name:'Original.md',basename:'Original',extension:'md'};
  const snapshot={file,path:file.path,property:'file.path',exists:true,value:file.path};
  assert.equal(renameTarget(snapshot,'Existing/Renamed.md'),'Existing/Renamed.md');
  for(const path of ['../outside.md','/absolute.md','C:/outside.md','Folder//empty.md','Folder/new.txt']) assert.throws(()=>renameTarget(snapshot,path));
  assert.equal(renameTarget({...snapshot,property:'file.basename'},'Renamed'),'Folder/Renamed.md');
  assert.equal(renameTarget({...snapshot,property:'file.folder'},''),'Original.md');
});
test('calculated properties and unsafe note keys are never editable',()=>{
  for(const property of ['formula.total','file.size','file.ctime','file.ext','note.__proto__']) assert.equal(editableProperty(property,'md'),false);
  assert.equal(editableProperty('note.title','png'),false);
  assert.equal(editableProperty('note.title','md'),true);
  assert.equal(editableProperty('file.name','png'),true);
});

test('Obsidian property definitions map list variants and ignore unknown types',()=>{
  const parsed=parsePropertyTypes(JSON.stringify({types:{score:'number',status:'text',done:'checkbox',links:'multitext',tags:'tags',aliases:'aliases',unknown:'unrecognized'}}));
  assert.equal(parsed.get('score'),'number');assert.equal(parsed.get('links'),'list');
  assert.equal(parsed.get('tags'),'list');assert.equal(parsed.get('aliases'),'list');
  assert.equal(parsed.has('unknown'),false);
});
