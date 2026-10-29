import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/link-drag.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/link-drag.mjs',external:['yaml'],alias:{obsidian:`${process.cwd()}/tests/obsidian-mock.mjs`}});
const {linkForDestination,appendLinkValue,appendTextLink,readLinkDrag}=await import(pathToFileURL(`${process.cwd()}/test-build/link-drag.mjs`));
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
