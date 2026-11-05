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
test('schema changes reset paths while missing vault evidence preserves retained groups',()=>{
  const saved=retainGroups([node('A')],null,'schema',()=>undefined).memory;
  assert.equal(retainGroups([],saved,'other',bindings=>bindings).groups.length,0);
  assert.equal(retainGroups([],saved,'schema',()=>undefined).groups.length,1);
});
test('retention reconstructs nested empty ancestors and ignores invalid memory records',()=>{
  const saved=retainGroups([node('A',[node('child')])],null,'schema',()=>undefined).memory;
  saved.groups.push(null,{key:'cycle',parent:'cycle',label:'cycle',bindings:[binding('bad')]});
  const retained=retainGroups([],saved,'schema',bindings=>bindings);
  assert.equal(retained.groups[0].children[0].key,'child');assert.equal(retained.groups[0].rows.length,0);
  assert.equal(retained.memory.groups.length,2);
});
test('computed values are retained while unidentified native paths remain unsupported',()=>{
  const computed={...node('formula'),bindings:[{...binding('x'),property:'formula.value'}]};
  const unknown={...node('unknown'),unknownNative:true};
  assert.equal(retainGroups([computed,unknown],null,'schema',bindings=>bindings).memory.groups.length,1);
});


const semantic=group=>JSON.stringify([group.property??group.bindings.at(-1)?.property,group.bindings.at(-1)?.value.value]);
const rowKey=row=>row.path;
const group=(key,value,rows=[],children=[],property='note.status')=>({key,label:String(value),property,bindings:[{property,sourcePath:'Note.md',value:{exists:true,value}}],rows,children,nativeId:key});
test('migrates a retained native List key to the live Link key without losing rows or empty values',()=>{
  const old='["native","List","[[Example]]"]',current='["native","Link","[[Example]]"]';
  const saved=retainGroups([group(old,'[[Example]]'),group('empty','[[Another]]')],null,'schema',()=>undefined).memory;
  const live=group(current,'[[Example]]',[{path:'A.md'}]);
  const result=retainGroups([live],saved,'schema',x=>x,semantic,rowKey);
  assert.deepEqual(result.groups.map(g=>g.key),[current,'empty']);assert.deepEqual(result.groups[0].rows.map(r=>r.path),['A.md']);
  assert.equal(result.migratedKeys.get(old),current);assert.equal(result.memory.groups.some(g=>g.key===old),false);
  const reopened=retainGroups([group(current,'[[Example]]',[{path:'A.md'}])],result.memory,'schema',x=>x,semantic,rowKey);
  assert.deepEqual(reopened.memory,result.memory);assert.equal(reopened.migratedKeys.size,0);
});
test('merges live rows and nested children while preserving distinct ancestor scopes and list values',()=>{
  const a='["native","List","x"]',b='["native","Link","x"]';
  const left=group(a,'x',[{path:'A'},{path:'shared'}],[group(JSON.stringify([...JSON.parse(a),'note.child','string:c']),'c',[{path:'A'}],[],'note.child')]);
  const right=group(b,'x',[{path:'B'},{path:'shared'}],[group(JSON.stringify([...JSON.parse(b),'note.child','string:c']),'c',[{path:'B'}],[],'note.child')]);
  const merged=retainGroups([left,right],null,'schema',()=>undefined,semantic,rowKey);
  assert.deepEqual(merged.groups[0].rows.map(r=>r.path),['A','shared','B']);
  assert.deepEqual(merged.groups[0].children[0].rows.map(r=>r.path),['A','B']);
  const parents=[group('p1','P1',[],[group('child1','same')]),group('p2','P2',[],[group('child2','same')]),group('list',['x','y']),group('singleton',['x']),group('scalar','x')];
  const scoped=retainGroups(parents,null,'schema',()=>undefined,semantic,rowKey);
  assert.equal(scoped.groups.length,5);assert.equal(scoped.groups[0].children.length,1);assert.equal(scoped.groups[1].children.length,1);
});
