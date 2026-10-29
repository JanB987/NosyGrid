import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/board-order.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/board-order.mjs',external:['yaml'],alias:{obsidian:`${process.cwd()}/tests/obsidian-mock.mjs`}});
const {readBoardOrders,applyBoardOrder,moveBoardSlot}=await import(pathToFileURL(`${process.cwd()}/test-build/board-order.mjs`));
test('manual group orders ignore invalid values and deduplicate slots',()=>{
  assert.deepEqual([...readBoardOrders({a:['Ready','Ready',1,'Waiting'],b:false,c:[]})],[['a',['Ready','Waiting']]]);assert.equal(readBoardOrders(null).size,0);
});
test('stored positions override sorting while unseen values append in their default order',()=>{
  assert.deepEqual(applyBoardOrder(['A','B','C','D'],['C','missing','A']),['C','A','B','D']);assert.deepEqual(applyBoardOrder(['A','B']),['A','B']);
});
test('before/after moves preserve every value exactly once across all positions',()=>{
  const values=['A','B','C','D'];for(const source of values)for(const target of values)for(const after of [false,true]) {
    const result=moveBoardSlot(values,source,target,after);assert.deepEqual(new Set(result),new Set(values));assert.equal(result.length,values.length);
    if(source===target)assert.deepEqual(result,values);else assert.equal(result.indexOf(source),result.indexOf(target)+(after?1:-1));
  }
  assert.deepEqual(moveBoardSlot(values,'missing','A',false),values);
});
