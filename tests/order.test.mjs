import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
await build({entryPoints:['src/order.ts'],outfile:'test-build/order.mjs',format:'esm',platform:'node'});
const {sortRows,planMove,planOrder,rankPrecision,numericRank,propertyName,applyChanges}=await import(pathToFileURL(`${process.cwd()}/test-build/order.mjs`));
const rows=[1,2,3].map(rank=>({path:`note ${rank}`,rank}));

test('moving before the first note changes only the moved note',()=>{
  assert.deepEqual(planMove(rows,'note 2','note 1',false,'asc'),[
    {path:'note 2',before:2,after:0}
  ]);
});
test('descending keeps highest value at the top',()=>{
  const sorted=sortRows(rows,'desc');
  assert.deepEqual(sorted.map(r=>r.path),['note 3','note 2','note 1']);
  assert.deepEqual(planMove(sorted,'note 1','note 3',false,'desc'),[
    {path:'note 1',before:1,after:4}
  ]);
});
test('moving down handles the removed source index',()=>{
  assert.deepEqual(planMove(rows,'note 1','note 3',true,'asc').map(c=>[c.path,c.after]),[['note 1',4]]);
});
test('no-op drops never normalize or write values',()=>{
  assert.deepEqual(planMove(rows,'note 1','note 1',true,'asc'),[]);
  assert.deepEqual(planMove(rows,'note 1','note 2',false,'asc'),[]);
});
test('empty and duplicate ranks use deterministic file ordering',()=>{
  const input=[{path:'z',rank:undefined},{path:'b',rank:2},{path:'a',rank:2},{path:'c',rank:undefined}];
  assert.deepEqual(sortRows(input,'desc').map(r=>r.path),['a','b','c','z']);
  assert.deepEqual(planMove(sortRows(input,'asc'),'z','a',false,'asc').map(c=>c.after),[1]);
});
test('non-numeric values and non-note properties are rejected',()=>{
  for (const value of ['1','high',true,[],{},NaN,Infinity]) assert.throws(()=>numericRank(value));
  for (const value of ['', 'file.name','formula.priority','__proto__']) assert.throws(()=>propertyName(value));
  assert.equal(propertyName('note.priority'),'priority');
  assert.equal(numericRank(0),0);
});
test('failed batch restores completed writes',async()=>{
  const data=new Map(rows.map(r=>[r.path,r.rank]));
  const changes=[{path:'note 2',before:2,after:0},{path:'note 1',before:1,after:0.5}];
  await assert.rejects(applyChanges(changes,async c=>{
    if(c.path==='note 1') throw new Error('disk failure');
    assert.equal(data.get(c.path),c.before); data.set(c.path,c.after);
  }),/disk failure/);
  assert.deepEqual([...data],rows.map(r=>[r.path,r.rank]));
});
test('rollback conflicts report notes requiring attention',async()=>{
  let call=0;
  await assert.rejects(applyChanges([{path:'note 2',before:2,after:0},{path:'note 1',before:1,after:0.5}],async()=>{
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
test('all source/target positions in both directions produce the requested order',()=>{
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


test('fractional insertion changes only the moved row at the chosen precision',()=>{
  const input=[{path:'a',rank:1},{path:'b',rank:2},{path:'c',rank:3}];
  assert.deepEqual(planMove(input,'c','b',false,'asc',1),[{path:'c',before:3,after:1.5}]);
  input[1].rank=1.1;
  assert.deepEqual(planMove(input,'c','b',false,'asc',2),[{path:'c',before:3,after:1.05}]);
  assert.deepEqual(planMove(sortRows(input,'desc'),'c','a',false,'desc',2),[{path:'c',before:3,after:1.05}]);
});
test('exhausted gaps rebalance the smallest local range and leave distant notes untouched',()=>{
  const input=[{path:'a',rank:0},{path:'b',rank:1},{path:'c',rank:1.01},{path:'d',rank:5},{path:'e',rank:10}];
  const changes=planMove(input,'e','c',false,'asc',2);
  assert.equal(changes.length,2);assert.ok(changes.some(change=>change.path==='e'));assert.ok(!changes.some(change=>['a','d'].includes(change.path)));
  const values=new Map(changes.map(change=>[change.path,change.after]));
  assert.deepEqual(sortRows(input.map(row=>({...row,rank:values.get(row.path)??row.rank})),'asc').map(row=>row.path),['a','b','e','c','d']);
});
test('multi-row blocks receive distinct fractional ranks while anchors retain theirs',()=>{
  const next=[{path:'a',rank:1},{path:'x',rank:10},{path:'y',rank:11},{path:'b',rank:2}];
  assert.deepEqual(planOrder(next,['x','y'],'asc',2),[{path:'x',before:10,after:1.33},{path:'y',before:11,after:1.66}]);
  const integer=planOrder(next,['x','y'],'asc',0);assert.ok(integer.every(change=>Number.isInteger(change.after)));
});
test('decimal arithmetic handles negatives, exponents and higher-precision existing anchors',()=>{
  for(const [a,b,precision] of [[-1.2,-1.1,2],[0.000001,0.000003,6],[1.001,1.099,2]]) {
    const input=[{path:'a',rank:a},{path:'b',rank:b},{path:'x',rank:5}];
    const changes=planMove(input,'x','b',false,'asc',precision);assert.equal(changes.length,1);
    assert.ok(changes[0].after>a&&changes[0].after<b);assert.ok(changes[0].after.toString().split('.')[1].length<=precision);
  }
  assert.equal(planMove([{path:'a',rank:0.1},{path:'b',rank:0.2},{path:'x',rank:1}],'x','b',false,'asc',2)[0].after,0.15);
});
test('precision settings validate and fractional moves retain their requested order across empty and tied ranks',()=>{
  for(const value of [undefined,null,-1,7,1.5,'invalid'])assert.equal(rankPrecision(value),2);
  assert.equal(rankPrecision('0'),0);assert.equal(rankPrecision('6'),6);
  for(const direction of ['asc','desc'])for(const precision of [0,1,2,6]) {
    const input=sortRows([{path:'a',rank:undefined},{path:'b',rank:1.001},{path:'c',rank:1.001},{path:'d',rank:-0.5},{path:'e',rank:undefined}],direction);
    for(const source of input)for(const target of input)for(const below of [false,true]) {
      const changes=planMove(input,source.path,target.path,below,direction,precision),values=new Map(changes.map(change=>[change.path,change.after]));
      const expected=input.map(row=>row.path);if(source!==target){expected.splice(expected.indexOf(source.path),1);expected.splice(expected.indexOf(target.path)+(below?1:0),0,source.path);}
      assert.deepEqual(sortRows(input.map(row=>({...row,rank:values.has(row.path)?values.get(row.path):row.rank})),direction).map(row=>row.path),expected);
    }
  }
});

test('large exactly representable ranks do not require rewriting their anchors',()=>{
  const input=[{path:'a',rank:1e15},{path:'b',rank:1e15+2},{path:'x',rank:1e15+10}];
  assert.deepEqual(planMove(input,'x','b',false,'asc',2),[{path:'x',before:1e15+10,after:1e15+1}]);
});
