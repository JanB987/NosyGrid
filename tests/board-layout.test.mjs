import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
await build({entryPoints:['src/board-layout.ts'],outfile:'test-build/board-layout.mjs',format:'esm'});
const {BoardLayout,readBoardWidths,linkedBoardWidthKey,MIN_BOARD_WIDTH,MAX_BOARD_WIDTH}=await import(pathToFileURL(`${process.cwd()}/test-build/board-layout.mjs`));
function setup(initial=null,fail=false) {
  const dom=new JSDOM('<div id="root"><div id="column"></div></div>'),doc=dom.window.document,root=doc.getElementById('root'),column=doc.getElementById('column');
  dom.window.HTMLElement.prototype.createDiv=function(options={}){const el=doc.createElement('div');el.className=options.cls??'';for(const [key,value]of Object.entries(options.attr??{}))el.setAttribute(key,value);this.append(el);return el;};
  column.getBoundingClientRect=()=>({width:parseFloat(column.style.getPropertyValue('--manual-order-column-width'))||640});
  let saved=initial,writes=0,changes=0;const errors=[];
  const layout=new BoardLayout(root,()=>saved,value=>{if(fail)throw new Error('save failed');saved=value;writes++;},()=>changes++,error=>errors.push(String(error)));
  layout.begin();layout.column(column,'group',false,'Project');
  const handle=column.querySelector('[role=separator]');
  const pointer=(type,x=0,target=handle)=>{const event=new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x});Object.defineProperty(event,'pointerId',{value:1});target.dispatchEvent(event);return event;};
  return {dom,root,column,layout,handle,pointer,errors,get saved(){return saved;},get writes(){return writes;},get changes(){return changes;}};
}
test('only finite supported explicit widths are restored',()=>{
  assert.deepEqual([...readBoardWidths({a:480,b:10,c:Infinity,d:'400',e:MAX_BOARD_WIDTH+1})],[['a',480]]);assert.equal(readBoardWidths([]).size,0);
});
test('resizing previews live, clamps width and writes once on release while preserving other groups',()=>{
  const ctx=setup({other:700});ctx.pointer('pointerdown',100);ctx.pointer('pointermove',-1000,ctx.dom.window.document);
  assert.equal(ctx.layout.active,true);assert.equal(ctx.writes,0);assert.equal(ctx.column.style.getPropertyValue('--manual-order-column-width'),`${MIN_BOARD_WIDTH}px`);
  ctx.pointer('pointerup',-1000,ctx.dom.window.document);assert.deepEqual(ctx.saved,{other:700,group:MIN_BOARD_WIDTH});assert.equal(ctx.writes,1);assert.equal(ctx.layout.active,false);ctx.layout.destroy();
});
test('Escape and pointer cancellation restore the original width without writing',()=>{
  for(const method of ['escape','pointercancel']) {
    const ctx=setup({group:500});ctx.pointer('pointerdown',100);ctx.pointer('pointermove',300,ctx.dom.window.document);
    if(method==='escape')ctx.dom.window.document.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));else ctx.pointer('pointercancel',300,ctx.dom.window.document);
    assert.equal(ctx.column.style.getPropertyValue('--manual-order-column-width'),'500px');assert.equal(ctx.writes,0);assert.equal(ctx.layout.active,false);ctx.layout.destroy();
  }
});
test('keyboard adjustments persist and double-click returns to responsive defaults',()=>{
  const ctx=setup();ctx.handle.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(ctx.saved.group,656);
  ctx.handle.dispatchEvent(new ctx.dom.window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));assert.equal(ctx.saved,null);ctx.layout.destroy();
});
test('failed width saves restore the existing size and report the error',()=>{
  const ctx=setup({group:500},true);ctx.pointer('pointerdown',100);ctx.pointer('pointermove',300,ctx.dom.window.document);ctx.pointer('pointerup',300,ctx.dom.window.document);
  assert.equal(ctx.column.style.getPropertyValue('--manual-order-column-width'),'500px');assert.match(ctx.errors[0],/save failed/);assert.equal(ctx.writes,0);ctx.layout.destroy();
});
test('collapsed rails retain the saved expanded width and have no resize handle',()=>{
  const ctx=setup({group:520});ctx.column.replaceChildren();ctx.layout.begin();ctx.layout.column(ctx.column,'group',true,'Project');assert.equal(ctx.column.classList.contains('is-board-collapsed'),true);assert.equal(ctx.column.querySelector('[role=separator]'),null);assert.equal(ctx.column.style.getPropertyValue('--manual-order-column-width'),'520px');assert.equal(ctx.writes,0);ctx.layout.destroy();
});

const readyKey=linkedBoardWidthKey('note.stage','string:Ready'),waitingKey=linkedBoardWidthKey('note.stage','string:Waiting');
const legacyKey=(parent,value='Ready')=>JSON.stringify(['note.team',`string:${parent}`,'note.stage',`string:${value}`]);
function linked(initial=null,fail=false) {
  const ctx=setup(initial,fail);ctx.column.replaceChildren();ctx.layout.begin();
  const add=(parent,widthKey=readyKey,closed=false)=>{const element=parent==='A'?ctx.column:ctx.root.createDiv();element.getBoundingClientRect=()=>({width:parseFloat(element.style.getPropertyValue('--manual-order-column-width'))||640});ctx.layout.column(element,legacyKey(parent,widthKey===waitingKey?'Waiting':'Ready'),closed,parent,widthKey);return element;};
  const a=add('A'),b=add('B'),waiting=add('B',waitingKey),rail=add('C',readyKey,true);
  return {...ctx,a,b,waiting,rail,add,base:ctx};
}

test('matching values resize together during preview, including collapsed matches, while other values stay independent',()=>{
  const ctx=linked(),handle=ctx.a.querySelector('[role=separator]');ctx.pointer('pointerdown',100,handle);ctx.pointer('pointermove',0,ctx.dom.window.document);
  assert.equal(ctx.a.style.getPropertyValue('--manual-order-column-width'),'540px');assert.equal(ctx.b.style.getPropertyValue('--manual-order-column-width'),'540px');assert.equal(ctx.rail.style.getPropertyValue('--manual-order-column-width'),'540px');assert.equal(ctx.rail.classList.contains('is-board-collapsed'),true);assert.equal(ctx.waiting.style.getPropertyValue('--manual-order-column-width'),'');assert.equal(ctx.base.writes,0);
  ctx.pointer('pointerup',0,ctx.dom.window.document);assert.deepEqual(ctx.base.saved,{[readyKey]:540});assert.equal(ctx.add('D').style.getPropertyValue('--manual-order-column-width'),'540px');ctx.layout.destroy();
});

test('cancelling a linked resize restores every matching column without saving',()=>{
  const ctx=linked({[readyKey]:480});ctx.pointer('pointerdown',100,ctx.a.querySelector('[role=separator]'));ctx.pointer('pointermove',300,ctx.dom.window.document);ctx.dom.window.document.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  for(const element of [ctx.a,ctx.b,ctx.rail])assert.equal(element.style.getPropertyValue('--manual-order-column-width'),'480px');assert.equal(ctx.base.writes,0);ctx.layout.destroy();
});

test('legacy widths resolve consistently and a linked resize migrates all parent-specific entries',()=>{
  const ctx=linked({[legacyKey('A')]:480,[legacyKey('B')]:620,[legacyKey('B','Waiting')]:700});assert.equal(ctx.a.style.getPropertyValue('--manual-order-column-width'),'480px');assert.equal(ctx.b.style.getPropertyValue('--manual-order-column-width'),'480px');
  ctx.b.querySelector('[role=separator]').dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  assert.equal(ctx.base.saved[readyKey],496);assert.equal(ctx.base.saved[legacyKey('A')],undefined);assert.equal(ctx.base.saved[legacyKey('B')],undefined);assert.equal(ctx.base.saved[legacyKey('B','Waiting')],700);
  ctx.a.querySelector('[role=separator]').dispatchEvent(new ctx.dom.window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));assert.equal(ctx.base.saved[readyKey],undefined);for(const element of [ctx.a,ctx.b,ctx.rail])assert.equal(element.style.getPropertyValue('--manual-order-column-width'),'');ctx.layout.destroy();
});

test('failed shared-width saves roll back all matching previews',()=>{
  const ctx=linked({[readyKey]:500},true);ctx.pointer('pointerdown',100,ctx.a.querySelector('[role=separator]'));ctx.pointer('pointermove',300,ctx.dom.window.document);ctx.pointer('pointerup',300,ctx.dom.window.document);
  for(const element of [ctx.a,ctx.b,ctx.rail])assert.equal(element.style.getPropertyValue('--manual-order-column-width'),'500px');assert.equal(ctx.base.writes,0);assert.match(ctx.errors[0],/save failed/);ctx.layout.destroy();
});
