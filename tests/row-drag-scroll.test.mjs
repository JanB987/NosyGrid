import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
await build({entryPoints:['src/row-drag-scroll.ts'],outfile:'test-build/row-drag-scroll.mjs',format:'esm'});
const {RowDragScroll}=await import(pathToFileURL(`${process.cwd()}/test-build/row-drag-scroll.mjs`));
function dimensions(element) {Object.defineProperties(element,{scrollWidth:{value:2000,configurable:true},clientWidth:{value:600,configurable:true},scrollHeight:{value:1500,configurable:true},clientHeight:{value:500,configurable:true}});}
function setup(board=true) {
  const dom=new JSDOM(`<div id="root"><div ${board?'class="manual-order-group-board"':''}><div data-group-scroll-key="A"></div></div></div>`),root=dom.window.document.getElementById('root'),body=root.querySelector('[data-group-scroll-key]');dimensions(root);dimensions(body);root.scrollLeft=160;root.scrollTop=80;body.scrollLeft=70;body.scrollTop=10;
  return {dom,root,body,lock:new RowDragScroll(root)};
}
test('board and column scroll stay fixed throughout a row drag and release normally afterward',()=>{
  const ctx=setup();ctx.lock.lock();ctx.root.scrollLeft=300;ctx.root.scrollTop=120;ctx.body.scrollLeft=200;ctx.body.scrollTop=40;ctx.body.dispatchEvent(new ctx.dom.window.Event('scroll'));
  assert.equal(ctx.root.scrollLeft,160);assert.equal(ctx.root.scrollTop,80);assert.equal(ctx.body.scrollLeft,70);assert.equal(ctx.body.scrollTop,10);
  ctx.lock.unlock();ctx.root.scrollLeft=280;ctx.root.dispatchEvent(new ctx.dom.window.Event('scroll'));assert.equal(ctx.root.scrollLeft,280);ctx.lock.destroy();
});
test('replacement group bodies restore the starting scroll by group identity after a move redraw',()=>{
  const ctx=setup();ctx.lock.lock();ctx.body.remove();const replacement=ctx.dom.window.document.createElement('div');replacement.dataset.groupScrollKey='A';dimensions(replacement);ctx.root.append(replacement);ctx.root.scrollLeft=0;ctx.lock.restore();assert.equal(replacement.scrollLeft,70);assert.equal(replacement.scrollTop,10);assert.equal(ctx.root.scrollLeft,160);ctx.lock.destroy();
});
test('horizontal grouping retains its existing scrolling behavior',()=>{
  const ctx=setup(false);ctx.lock.lock();ctx.root.scrollLeft=300;ctx.root.dispatchEvent(new ctx.dom.window.Event('scroll'));assert.equal(ctx.root.scrollLeft,300);ctx.lock.destroy();
});
test('scroll restoration clamps to remaining content when a group disappears',()=>{
  const ctx=setup();ctx.lock.lock();Object.defineProperty(ctx.root,'scrollWidth',{value:650,configurable:true});ctx.root.scrollLeft=0;ctx.lock.restore();assert.equal(ctx.root.scrollLeft,50);ctx.lock.destroy();
});
