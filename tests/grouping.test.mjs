import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/grouping.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/grouping.mjs'});
const {readGroupRules,groupRows}=await import(pathToFileURL(`${process.cwd()}/test-build/grouping.mjs`));
const rules=[{property:'note.team',direction:'asc'},{property:'note.status',direction:'desc'}];
const value=(row,property)=>row[property.slice(5)];

test('nested grouping partitions each note exactly once and sorts each level independently',()=>{
  const rows=[{team:'B',status:1},{team:'A',status:2},{team:'A',status:10},{team:'A',status:2}];
  const groups=groupRows(rows,rules,value);
  assert.deepEqual(groups.map(group=>group.label),['A','B']);assert.deepEqual(groups[0].children.map(group=>group.label),['10','2']);
  assert.equal(groups[0].rows.length,3);assert.equal(groups[0].children[1].rows.length,2);
  assert.deepEqual(new Set(groups.flatMap(group=>group.children.flatMap(child=>child.rows))),new Set(rows));
});
test('group keys distinguish primitive types, preserve list identity, and scope identical child labels by parent',()=>{
  const rows=[{team:false,status:'x'},{team:0,status:'x'},{team:'0',status:'x'},{team:['a','b'],status:'x'},{team:['b','a'],status:'x'},{team:{a:1,b:2},status:'x'},{team:{b:2,a:1},status:'x'}];
  const groups=groupRows(rows,rules,value);assert.equal(groups.length,6);
  assert.equal(new Set(groups.map(group=>group.key)).size,6);assert.equal(new Set(groups.flatMap(group=>group.children.map(child=>child.key))).size,6);
  assert.equal(groups.find(group=>group.rows.length===2).rows.length,2);
});
test('missing values group together and keys survive input order changes',()=>{
  const rows=[{team:null},{},{team:''},{team:'A'}],groups=groupRows(rows,rules,value);
  assert.equal(groups.find(group=>group.label==='No value').rows.length,3);
  assert.deepEqual(groupRows([...rows].reverse(),rules,value).map(group=>group.key),groups.map(group=>group.key));
  assert.deepEqual(groupRows(rows,[],value),[]);assert.deepEqual(groupRows([],rules,value),[]);
});
test('invalid or duplicate group rules are ignored and defaults are safe',()=>{
  assert.deepEqual(readGroupRules(null),[]);
  assert.deepEqual(readGroupRules([null,{}, {property:'bad'}, {property:'note.team',direction:'wrong'}, {property:'note.team',direction:'desc'}, {property:'formula.total',direction:'desc'}]),[{property:'note.team',direction:'asc'},{property:'formula.total',direction:'desc'}]);
});

test('grouping rules preserve vertical layout per property and default other values to horizontal',()=>{
  assert.deepEqual(readGroupRules([{property:'note.team',direction:'asc',layout:'vertical'},{property:'note.stage',direction:'desc',layout:'horizontal'},{property:'note.unknown',layout:'invalid'}]),[{property:'note.team',direction:'asc',layout:'vertical'},{property:'note.stage',direction:'desc'},{property:'note.unknown',direction:'asc'}]);
});
