import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
await build({entryPoints:['src/order.ts'],outfile:'test-build/order.mjs',format:'esm',platform:'node'});
const {sortRows,planMove,numericRank,propertyName,applyChanges}=await import(pathToFileURL(`${process.cwd()}/test-build/order.mjs`));
const rows=[1,2,3].map(rank=>({path:`note ${rank}`,rank}));

test('requested example rewrites only notes 1 and 2',()=>{
  assert.deepEqual(planMove(rows,'note 2','note 1',false,'asc'),[
    {path:'note 2',before:2,after:1},{path:'note 1',before:1,after:2}
  ]);
});
test('descending keeps highest value at the top',()=>{
  const sorted=sortRows(rows,'desc');
  assert.deepEqual(sorted.map(r=>r.path),['note 3','note 2','note 1']);
  assert.deepEqual(planMove(sorted,'note 1','note 3',false,'desc'),[
    {path:'note 1',before:1,after:3},{path:'note 3',before:3,after:2},{path:'note 2',before:2,after:1}
  ]);
});
test('moving down handles the removed source index',()=>{
  assert.deepEqual(planMove(rows,'note 1','note 3',true,'asc').map(c=>[c.path,c.after]),[['note 2',1],['note 3',2],['note 1',3]]);
});
test('no-op drops never normalize or write values',()=>{
  assert.deepEqual(planMove(rows,'note 1','note 1',true,'asc'),[]);
  assert.deepEqual(planMove(rows,'note 1','note 2',false,'asc'),[]);
});
test('empty and duplicate ranks use deterministic file ordering',()=>{
  const input=[{path:'z',rank:undefined},{path:'b',rank:2},{path:'a',rank:2},{path:'c',rank:undefined}];
  assert.deepEqual(sortRows(input,'desc').map(r=>r.path),['a','b','c','z']);
  assert.deepEqual(planMove(sortRows(input,'asc'),'z','a',false,'asc').map(c=>c.after),[1,3,4]);
});
test('non-numeric values and non-note properties are rejected',()=>{
  for (const value of ['1','high',true,[],{},NaN,Infinity]) assert.throws(()=>numericRank(value));
  for (const value of ['', 'file.name','formula.priority','__proto__']) assert.throws(()=>propertyName(value));
  assert.equal(propertyName('note.priority'),'priority');
  assert.equal(numericRank(0),0);
});
test('failed batch restores completed writes',async()=>{
  const data=new Map(rows.map(r=>[r.path,r.rank]));
  const changes=planMove(rows,'note 2','note 1',false,'asc');
  await assert.rejects(applyChanges(changes,async c=>{
    if(c.path==='note 1') throw new Error('disk failure');
    assert.equal(data.get(c.path),c.before); data.set(c.path,c.after);
  }),/disk failure/);
  assert.deepEqual([...data],rows.map(r=>[r.path,r.rank]));
});
test('rollback conflicts report notes requiring attention',async()=>{
  let call=0;
  await assert.rejects(applyChanges(planMove(rows,'note 2','note 1',false,'asc'),async()=>{
    if(++call>1) throw new Error('conflict');
  }),/rollback could not restore: note 2/);
});
test('undo restores the original order',async()=>{
  const data=new Map(rows.map(r=>[r.path,r.rank]));
  const changes=planMove(rows,'note 2','note 1',false,'asc');
  const write=async c=>{assert.equal(data.get(c.path),c.before);data.set(c.path,c.after);};
  await applyChanges(changes,write);
  await applyChanges(changes.map(c=>({path:c.path,before:c.after,after:c.before})),write);
  assert.deepEqual([...data],rows.map(r=>[r.path,r.rank]));
});
test('all source/target positions in both directions produce consecutive ranks',()=>{
  for(const direction of ['asc','desc']) for(let count=2;count<=12;count++) {
    const input=sortRows(Array.from({length:count},(_,i)=>({path:String(i),rank:i+1})),direction);
    for(const source of input) for(const target of input) for(const below of [true,false]) {
      const changes=planMove(input,source.path,target.path,below,direction);
      const values=new Map(input.map(r=>[r.path,r.rank]));
      for(const change of changes) values.set(change.path,change.after);
      const actual=sortRows(input.map(r=>({...r,rank:values.get(r.path)})),direction).map(r=>r.path);
      const expected=input.map(r=>r.path);
      if(source!==target) {
        expected.splice(expected.indexOf(source.path),1);
        expected.splice(expected.indexOf(target.path)+(below?1:0),0,source.path);
      }
      assert.deepEqual(actual,expected);
    }
  }
});
