import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/retained-groups.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/retained-groups.mjs'});
const {retainGroups}=await import(pathToFileURL(`${process.cwd()}/test-build/retained-groups.mjs`));
const binding=value=>({property:'note.team',sourcePath:'Note.md',value:{exists:true,value}});
const node=(key,children=[])=>({key,label:key,property:'note.team',bindings:[binding(key)],rows:[key],children});
test('empty known siblings keep their position and never import vault rows',()=>{
  const saved=retainGroups([node('A'),node('B'),node('C')],null,'schema',()=>undefined).memory;
  const retained=retainGroups([node('B')],saved,'schema',bindings=>bindings);
  assert.deepEqual(retained.groups.map(group=>group.key),['A','B','C']);assert.deepEqual(retained.groups.map(group=>group.rows.length),[0,1,0]);
});
test('schema changes and missing vault evidence remove retained groups',()=>{
  const saved=retainGroups([node('A')],null,'schema',()=>undefined).memory;
  assert.equal(retainGroups([],saved,'other',bindings=>bindings).groups.length,0);
  assert.equal(retainGroups([],saved,'schema',()=>undefined).groups.length,0);
});
test('retention reconstructs nested empty ancestors and ignores invalid memory records',()=>{
  const saved=retainGroups([node('A',[node('child')])],null,'schema',()=>undefined).memory;
  saved.groups.push(null,{key:'cycle',parent:'cycle',label:'cycle',bindings:[binding('bad')]});
  const retained=retainGroups([],saved,'schema',bindings=>bindings);
  assert.equal(retained.groups[0].children[0].key,'child');assert.equal(retained.groups[0].rows.length,0);
  assert.equal(retained.memory.groups.length,2);
});
test('computed and unknown native paths are not retained without verifiable vault properties',()=>{
  const computed={...node('formula'),bindings:[{...binding('x'),property:'formula.value'}]};
  const unknown={...node('unknown'),unknownNative:true};
  assert.equal(retainGroups([computed,unknown],null,'schema',bindings=>bindings).memory,null);
});
