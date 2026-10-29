import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/link-syntax.ts'],outfile:'test-build/link-syntax.mjs',format:'esm'});
await build({entryPoints:['src/link-suggest.ts'],outfile:'test-build/link-suggest.mjs',bundle:true,platform:'node',format:'esm',external:['yaml'],alias:{obsidian:`${process.cwd()}/tests/obsidian-mock.mjs`}});
const {activeWikilink,replaceWikilink,splitWikilinks,wikilinkAt}=await import(pathToFileURL(`${process.cwd()}/test-build/link-syntax.mjs`));
const {findLinkSuggestions}=await import(pathToFileURL(`${process.cwd()}/test-build/link-suggest.mjs`));

test('only the active token is completed in prose and multiline list values',()=>{
  const value='Before [[One]] after\n[[Tw]] and [[Three]]';
  const context=activeWikilink(value,value.indexOf('Tw')+2);
  assert.equal(context.query,'Tw');
  assert.equal(replaceWikilink(value,context,'Two').value,'Before [[One]] after\n[[Two]] and [[Three]]');
  assert.equal(activeWikilink('[[One]]',7),undefined);
  assert.equal(activeWikilink('[[One|alias',11),undefined);
  assert.equal(activeWikilink('\\[[One',6),undefined);
  assert.equal(activeWikilink('[[a\nb',6),undefined);
  assert.equal(activeWikilink('[[One',5,2),undefined);
});
test('replacement preserves surrounding text, aliases and existing subpaths',()=>{
  const value='See [[Old#Heading|Display name]] next';
  const context=activeWikilink(value,'See [[Ol'.length);
  assert.equal(replaceWikilink(value,context,'New').value,'See [[New#Heading|Display name]] next');
  assert.equal(replaceWikilink(value,context,'New#Different').value,'See [[New#Different|Display name]] next');
  assert.equal(replaceWikilink('[[Test',activeWikilink('[[Test',6),'Target','Alias').value,'[[Target|Alias]]');
});
test('all complete links are split without converting surrounding text to Markdown',()=>{
  const value='**plain** [[One|First]] and [[Two#Heading]] and \\[[Literal]] <script>';
  const parts=splitWikilinks(value);
  assert.deepEqual(parts.filter(p=>p.target).map(p=>[p.target,p.label]),[['One','First'],['Two#Heading','Two#Heading']]);
  assert.equal(parts.map(p=>p.text).join(''),value);
});
const files=[{path:'First/Shared.md',basename:'Shared'},{path:'Second/Shared.md',basename:'Shared'}];
const app={vault:{getFiles:()=>files,getFileByPath:()=>files[0]},metadataCache:{fileToLinktext:file=>file.path.replace(/\.md$/,''),getFirstLinkpathDest:()=>files[0],getFileCache:()=>({frontmatter:{aliases:['Other Name']},headings:[{heading:'Introduction'},{heading:'Results'}],blocks:{block1:{},block2:{}}})}};
test('duplicate names use public source-relative link generation',()=>{
  assert.deepEqual(findLinkSuggestions(app,'Source.md','Shared').map(item=>item.target),['First/Shared','Second/Shared']);
});
test('headings and blocks come from public cached metadata',()=>{
  assert.deepEqual(findLinkSuggestions(app,'Source.md','Shared#Res').map(item=>item.target),['First/Shared#Results']);
  assert.deepEqual(findLinkSuggestions(app,'Source.md','#^block2').map(item=>item.target),['#^block2']);
});
test('unresolved targets insert a link without creating a note',()=>{
  const result=findLinkSuggestions(app,'Source.md','No existing note matches');
  assert.equal(result[0].target,'No existing note matches');assert.match(result[0].detail,/created when opened/);
});

test('raw editor link lookup distinguishes neighbouring links, prose, and escaped tokens',()=>{
  const value='See [[One|First]] then [[Two#Heading]] and \\[[Literal]]';
  assert.equal(wikilinkAt(value,value.indexOf('First')).target,'One');
  assert.equal(wikilinkAt(value,value.indexOf('Heading')).target,'Two#Heading');
  assert.equal(wikilinkAt(value,value.indexOf('then')),undefined);
  assert.equal(wikilinkAt(value,value.indexOf('Literal')),undefined);
});
