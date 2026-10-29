import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
await build({entryPoints:['src/row-layout.ts'],outfile:'test-build/row-layout.mjs',format:'esm'});
const {readRowHeights,RowLayout}=await import(pathToFileURL(`${process.cwd()}/test-build/row-layout.mjs`));

test('only finite non-default heights are restored from view settings',()=>{
  assert.deepEqual([...readRowHeights({'a.md':48,'b.md':100,'c.md':-1,'d.md':'200','e.md':Infinity,'f.md':null})],[['b.md',100]]);
  assert.equal(readRowHeights(null).size,0);assert.equal(readRowHeights([]).size,0);
});
test('height changes preserve other rows and collapse removes the default entry',()=>{
  const dom=new JSDOM('<table><tbody><tr></tr><tr></tr></tbody></table>');const root=dom.window.document.body;
  let state={'a.md':100,'b.md':150};const saved=[];
  const layout=new RowLayout(root,()=>state,value=>{state=value;saved.push(value);},error=>{throw error;});
  layout.begin();const rows=root.querySelectorAll('tr');layout.row(rows[0],'a.md');layout.row(rows[1],'b.md');
  layout.setHeight('a.md',200);assert.deepEqual(state,{'a.md':200,'b.md':150});
  layout.setHeight('a.md',48);assert.deepEqual(state,{'b.md':150});assert.equal(rows[0].style.getPropertyValue('--manual-order-row-height'),'48px');
  layout.setHeight('b.md',48);assert.equal(state,null);assert.equal(saved.length,3);layout.destroy();
});
test('a failed settings save restores the previous row height',()=>{
  const dom=new JSDOM('<table><tbody><tr></tr></tbody></table>');let reported;
  const layout=new RowLayout(dom.window.document.body,()=>({'a.md':100}),()=>{throw new Error('read-only Base');},error=>{reported=error;});
  layout.begin();const row=dom.window.document.querySelector('tr');layout.row(row,'a.md');layout.setHeight('a.md',200);
  assert.equal(row.style.getPropertyValue('--manual-order-row-height'),'100px');assert.match(reported.message,/read-only Base/);layout.destroy();
});
