import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
await build({entryPoints:['src/group-move.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/group-move.mjs',external:['yaml'],alias:{obsidian:`${process.cwd()}/tests/obsidian-mock.mjs`}});
const {nativeGroupProperty,nativeGroupValue,rebaseGroupValue,groupIdentity}=await import(pathToFileURL(`${process.cwd()}/test-build/group-move.mjs`));
const target={path:'Groups/Project.md',basename:'Project'};
const app={vault:{getFileByPath:p=>p===target.path?target:null},metadataCache:{getFirstLinkpathDest:(text,source)=>path.posix.normalize(path.posix.join(path.posix.dirname(source),`${text}.md`))===target.path?target:null,fileToLinktext:(file,source)=>path.posix.relative(path.posix.dirname(source||'root.md'),file.path).replace(/\.md$/,'')}};

test('group values rebase links between folders without losing aliases, subpaths, prose or list types',()=>{
  const value=['Before [[Project#Heading|Alias]] after',0,false,null,'plain'];
  assert.deepEqual(rebaseGroupValue(value,app,'Groups/Note.md','Deep/Folder/Note.md'),['Before [[../../Groups/Project#Heading|Alias]] after',0,false,null,'plain']);
  assert.deepEqual(value,['Before [[Project#Heading|Alias]] after',0,false,null,'plain']);
});
test('group identity unifies source-relative link spellings and aliases but keeps primitive types',()=>{
  assert.equal(groupIdentity('[[Project|First]]',app,'Groups/Note.md'),groupIdentity('[[../../Groups/Project|Second]]',app,'Deep/Folder/Note.md'));
  assert.equal(groupIdentity(false,app,''),false);assert.equal(groupIdentity(0,app,''),0);assert.equal(groupIdentity(null,app,''),undefined);
});
test('native grouping compatibility accessor validates property IDs without guessing',()=>{
  assert.equal(nativeGroupProperty({groupBy:{property:'note.team'}}),'note.team');
  for(const config of [null,{}, {groupBy:{}},{groupBy:{property:'team'}}])assert.equal(nativeGroupProperty(config),undefined);
});
test('empty native group keys retain public numeric, boolean and list value types',()=>{
  class Numeric {static type='number';toString(){return '0';}}
  class Bool {static type='boolean';toString(){return 'false';}}
  class List {static type='list';length(){return 2;}get(i){return i?new Bool():new Numeric();}}
  assert.deepEqual(nativeGroupValue(new Numeric()),{exists:true,value:0});assert.deepEqual(nativeGroupValue(new Bool()),{exists:true,value:false});
  assert.deepEqual(nativeGroupValue(new List()),{exists:true,value:[0,false]});assert.equal(nativeGroupValue(undefined).exists,false);
});
