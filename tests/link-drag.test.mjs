import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/link-drag.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/link-drag.mjs',external:['yaml'],alias:{obsidian:`${process.cwd()}/tests/obsidian-mock.mjs`}});
const {linkForDestination,appendLinkValue,appendTextLink,readLinkDrag,writeNoteLinksDrag,readNoteLinksDrag,startNativeFileDrag}=await import(pathToFileURL(`${process.cwd()}/test-build/link-drag.mjs`));
const shared={path:'Source/Shared.md',basename:'Shared'};
const app={vault:{getFileByPath:path=>path===shared.path?shared:null},metadataCache:{getFirstLinkpathDest:()=>shared,fileToLinktext:(file,destination)=>{assert.equal(destination,'Other/Target.md');return 'Source/Shared';}}};
test('relative and duplicate-name targets retain their identity, heading and alias',()=>{
  const payload={version:1,sourcePath:'Source/Origin.md',link:'[[Shared#Heading|Display name]]',resolvedPath:shared.path};
  assert.equal(linkForDestination(app,payload,'Other/Target.md'),'[[Source/Shared#Heading|Display name]]');
});
test('a self-heading becomes a link to the original source note when copied elsewhere',()=>{
  const payload={version:1,sourcePath:shared.path,link:'[[#Heading]]',resolvedPath:shared.path};
  assert.equal(linkForDestination(app,payload,'Other/Target.md'),'[[Source/Shared#Heading]]');
});
test('a file that disappears during the drag is not silently changed to another target',()=>{
  assert.throws(()=>linkForDestination(app,{version:1,sourcePath:'Source/Origin.md',link:'[[Shared]]',resolvedPath:'Missing.md'},'Other/Target.md'),/moved or was deleted/);
});
test('explicit relative unresolved links are rebased without creating files',()=>{
  const unresolved={vault:{getFileByPath:()=>null},metadataCache:{getFirstLinkpathDest:()=>null}};
  assert.equal(linkForDestination(unresolved,{version:1,sourcePath:'Folder/Source.md',link:'[[./Future#Heading|Alias]]'},'Elsewhere/Target.md'),'[[Folder/Future#Heading|Alias]]');
});
test('target content is retained exactly when appending text and list values',()=>{
  assert.equal(appendTextLink('text\n','[[Note]]'),'text\n[[Note]]');
  assert.equal(appendTextLink(null,'[[Note]]'),'[[Note]]');
  assert.deepEqual(appendLinkValue([0,false,null,'one'],'list','[[Note]]').value,[0,false,null,'one','[[Note]]']);
  assert.throws(()=>appendTextLink(7,'[[Note]]'),/non-text/);
});
test('only a valid single-wikilink payload is accepted',()=>{
  for(const link of ['ordinary text','[[one]] [[two]]','[[unterminated']) {
    assert.equal(readLinkDrag({types:['application/x-manual-order-bases-link'],getData:()=>JSON.stringify({version:1,sourcePath:'Source.md',link})}),undefined);
  }
});


test('file drags use the native single and multiple file interfaces when available',()=>{
  const calls=[],manager={dragFile:(event,file)=>{calls.push(['one',file.path]);return {file};},dragFiles:(event,files)=>{calls.push(['many',files.map(file=>file.path)]);return {files};},onDragStart:(event,drag)=>calls.push(['start',drag])};
  const event={dataTransfer:{}},files=[shared,{path:'Other/Second.md'}];
  assert.equal(startNativeFileDrag({dragManager:manager},event,[shared]),true);
  assert.equal(startNativeFileDrag({dragManager:manager},event,files),true);
  assert.deepEqual(calls.map(call=>call[0]),['one','start','many','start']);
  assert.deepEqual(calls[2][1],['Source/Shared.md','Other/Second.md']);
  assert.equal(startNativeFileDrag({},event,files),false);
  assert.equal(startNativeFileDrag({dragManager:{dragFile(){}}},event,files),false);
});
test('multi-note payloads preserve order and reject malformed or mismatched paths',()=>{
  const values=new Map(),data={get types(){return [...values.keys()]},setData:(k,v)=>values.set(k,v),getData:k=>values.get(k)};
  writeNoteLinksDrag(data,[shared,{path:'Other/Second.md'}]);
  assert.equal(data.getData('text/plain'),'[[Source/Shared.md]]\n[[Other/Second.md]]');
  assert.deepEqual(readNoteLinksDrag(data).map(link=>link.resolvedPath),['Source/Shared.md','Other/Second.md']);
  data.setData('application/x-nosygrid-note-links',JSON.stringify([{version:1,sourcePath:'A.md',resolvedPath:'B.md',link:'[[A.md]]'}]));
  assert.equal(readNoteLinksDrag(data),undefined);
});
