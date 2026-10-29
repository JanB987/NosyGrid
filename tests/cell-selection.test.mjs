import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
await build({entryPoints:['src/cell-selection.ts'],outfile:'test-build/cell-selection.mjs',format:'esm'});
const {CellSelection}=await import(pathToFileURL(`${process.cwd()}/test-build/cell-selection.mjs`));

function fixture() {
  const dom=new JSDOM('<div id="root"></div><button id="outside">Outside</button>');const root=dom.window.document.getElementById('root');
  const build=()=>{
    root.innerHTML=Array.from({length:2},(_,group)=>`<table class="manual-order-table"><tbody>${Array.from({length:2},(_,r)=>`<tr><td><button>Grip</button></td>${Array.from({length:3},(_,c)=>`<td data-path="Note ${group*2+r}.md" data-property="note.p${c}">${r}:${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('');
    [...root.querySelectorAll('td[data-property]')].forEach((cell,index)=>{
      const row=Math.floor(index/3),column=index%3;cell.getBoundingClientRect=()=>({left:column*100,right:(column+1)*100,top:row*40,bottom:(row+1)*40,width:100,height:40});
    });
  };build();const selection=new CellSelection(root);selection.refresh();
  const cell=(r,c)=>root.querySelector(`td[data-path="Note ${r}.md"][data-property="note.p${c}"]`);
  const pointer=(target,type,r,c,extra={})=>{
    const event=new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:c*100+25,clientY:r*40+20,...extra});
    Object.defineProperty(event,'pointerId',{value:1});Object.defineProperty(event,'pointerType',{value:'mouse'});target.dispatchEvent(event);return event;
  };
  return {dom,root,selection,cell,pointer,build};
}
test('drag selects a rectangle across grouped tables and suppresses editing click',()=>{
  const ctx=fixture();ctx.pointer(ctx.cell(0,0),'pointerdown',0,0);ctx.pointer(ctx.cell(3,1),'pointermove',3,1);ctx.pointer(ctx.cell(3,1),'pointerup',3,1);
  assert.equal(ctx.root.querySelectorAll('[aria-selected=true]').length,8);assert.equal(ctx.root.dataset.selectedCellCount,'8');
  const click=new ctx.dom.window.MouseEvent('click',{bubbles:true,cancelable:true,detail:1});ctx.cell(3,1).dispatchEvent(click);assert.equal(click.defaultPrevented,true);
  ctx.selection.destroy();
});
test('reverse dragging selects the same rectangular range',()=>{
  const ctx=fixture();ctx.pointer(ctx.cell(2,2),'pointerdown',2,2);ctx.pointer(ctx.cell(0,1),'pointermove',0,1);ctx.pointer(ctx.cell(0,1),'pointerup',0,1);
  assert.equal(ctx.root.querySelectorAll('[aria-selected=true]').length,6);assert.equal(ctx.cell(0,0).getAttribute('aria-selected'),'false');ctx.selection.destroy();
});
test('plain clicks remain available for editing; Shift-click extends; Escape clears',()=>{
  const ctx=fixture();ctx.pointer(ctx.cell(0,0),'pointerdown',0,0);ctx.pointer(ctx.cell(0,0),'pointerup',0,0);
  const click=new ctx.dom.window.MouseEvent('click',{bubbles:true,cancelable:true,detail:1});ctx.cell(0,0).dispatchEvent(click);assert.equal(click.defaultPrevented,false);
  ctx.pointer(ctx.cell(2,1),'pointerdown',2,1,{shiftKey:true});ctx.pointer(ctx.cell(2,1),'pointerup',2,1,{shiftKey:true});assert.equal(ctx.root.dataset.selectedCellCount,'6');
  ctx.cell(2,1).dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(ctx.root.dataset.selectedCellCount,'0');ctx.selection.destroy();
});
test('links, row handles, checkboxes and editor inputs keep native pointer gestures',()=>{
  const ctx=fixture();
  for(const html of ['<a href="#">Link</a>','<button>Control</button>','<input type="checkbox">','<textarea>Draft</textarea>']) {
    ctx.cell(0,0).innerHTML=html;const event=ctx.pointer(ctx.cell(0,0).firstElementChild,'pointerdown',0,0);assert.equal(event.defaultPrevented,false);assert.equal(ctx.root.dataset.selectedCellCount,'0');
  }
  ctx.selection.destroy();
});
test('selection survives rendering by note/property identity and loses filtered-out cells',()=>{
  const ctx=fixture();ctx.pointer(ctx.cell(0,0),'pointerdown',0,0);ctx.pointer(ctx.cell(1,1),'pointermove',1,1);ctx.pointer(ctx.cell(1,1),'pointerup',1,1);
  ctx.selection.beforeRender();ctx.build();ctx.selection.refresh();assert.equal(ctx.root.dataset.selectedCellCount,'4');
  ctx.cell(1,0).closest('tr').remove();ctx.selection.refresh();assert.equal(ctx.root.dataset.selectedCellCount,'2');ctx.selection.destroy();
});
test('Shift-arrow extends selection and outside clicks clear it',()=>{
  const ctx=fixture();ctx.cell(0,0).focus();
  ctx.cell(0,0).dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true}));
  ctx.cell(1,0).dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true}));assert.equal(ctx.root.dataset.selectedCellCount,'4');
  ctx.pointer(ctx.dom.window.document.getElementById('outside'),'pointerdown',0,0);assert.equal(ctx.root.dataset.selectedCellCount,'0');ctx.selection.destroy();
});

function boardColumns(ctx,separate=true) {
  const board=ctx.dom.window.document.createElement('div');board.className='manual-order-group-board';
  const tables=[...ctx.root.querySelectorAll('table')];ctx.root.append(board);
  if(separate)for(const table of tables){const column=ctx.dom.window.document.createElement('div');column.className='manual-order-board-column';board.append(column);column.append(table);}
  else {const column=ctx.dom.window.document.createElement('div');column.className='manual-order-board-column';board.append(column);for(const table of tables)column.append(table);}
  ctx.selection.refresh();
}

test('board cell drag selection stays in its originating column',()=>{
  const ctx=fixture();boardColumns(ctx);ctx.pointer(ctx.cell(0,0),'pointerdown',0,0);ctx.pointer(ctx.cell(3,1),'pointermove',3,1);ctx.pointer(ctx.cell(3,1),'pointerup',3,1);
  assert.equal(ctx.root.dataset.selectedCellCount,'4');assert.equal(ctx.cell(2,0).getAttribute('aria-selected'),'false');assert.equal(ctx.selection.getRange().length,2);ctx.selection.destroy();
});

test('Shift-click starts a new cell selection in another board column and Shift-arrow cannot cross its boundary',()=>{
  const ctx=fixture();boardColumns(ctx);ctx.selection.selectCell(ctx.cell(0,0));ctx.pointer(ctx.cell(2,1),'pointerdown',2,1,{shiftKey:true});ctx.pointer(ctx.cell(2,1),'pointerup',2,1,{shiftKey:true});assert.equal(ctx.root.dataset.selectedCellCount,'1');
  ctx.cell(2,1).dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'ArrowUp',shiftKey:true,bubbles:true}));assert.equal(ctx.root.dataset.selectedCellCount,'1');assert.equal(ctx.cell(1,1).getAttribute('aria-selected'),'false');ctx.selection.destroy();
});

test('switching to board layout constrains an existing cell range to its anchor column',()=>{
  const ctx=fixture();ctx.pointer(ctx.cell(0,0),'pointerdown',0,0);ctx.pointer(ctx.cell(3,1),'pointermove',3,1);ctx.pointer(ctx.cell(3,1),'pointerup',3,1);assert.equal(ctx.root.dataset.selectedCellCount,'8');boardColumns(ctx);assert.equal(ctx.root.dataset.selectedCellCount,'4');ctx.selection.destroy();
});

test('cell selection still spans horizontal subgroups inside one board column',()=>{
  const ctx=fixture();boardColumns(ctx,false);ctx.pointer(ctx.cell(0,0),'pointerdown',0,0);ctx.pointer(ctx.cell(3,1),'pointermove',3,1);ctx.pointer(ctx.cell(3,1),'pointerup',3,1);assert.equal(ctx.root.dataset.selectedCellCount,'8');ctx.selection.destroy();
});
