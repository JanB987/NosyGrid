import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {parse,stringify} from 'yaml';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/main.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/plugin.mjs',external:['yaml'],alias:{obsidian:`${process.cwd()}/tests/obsidian-mock.mjs`}});
const {default:Plugin,ManualOrderView}=await import(pathToFileURL(`${process.cwd()}/test-build/plugin.mjs`));

function setup(values=[1,2,3],columns=['file.name','note.priority']) {
  const dom=new JSDOM('<div id="view"></div>');
  const proto=dom.window.HTMLElement.prototype;
  proto.createEl=function(tag,options={}) {
    const el=this.ownerDocument.createElement(tag);
    if(options.cls)el.className=options.cls;
    if(options.text)el.textContent=options.text;
    for(const [k,v] of Object.entries(options.attr??{}))el.setAttribute(k,v);
    this.append(el);return el;
  };
  proto.createDiv=function(options){return this.createEl('div',options);};
  proto.createSpan=function(options){return this.createEl('span',options);};
  proto.empty=function(){this.replaceChildren();};
  proto.setText=function(text){this.textContent=text;};
  proto.addClass=function(...classes){this.classList.add(...classes);};
  proto.removeClass=function(...classes){this.classList.remove(...classes);};
  const records=new Map(values.map((rank,i)=>{
    const fm={keep:'unchanged'};
    if(rank!==undefined)fm.priority=rank;
    return [`Note ${i+1}.md`,{file:{path:`Note ${i+1}.md`,name:`Note ${i+1}.md`,basename:`Note ${i+1}`,extension:'md'},fm}];
  }));
  let writes=0;
  const opened=[],hovered=[],contextMenus=[];
  const app={
    vault:{getFileByPath:path=>records.get(path)?.file,getAbstractFileByPath:path=>records.get(path)?.file,getFolderByPath:path=>path==='Existing'?{path}:null,getMarkdownFiles:()=>[...records.values()].map(r=>r.file),getFiles:()=>[...records.values()].map(r=>r.file),read:async file=>`---\n${stringify(records.get(file.path).fm)}---\nBody unchanged`},
    fileManager:{processFrontMatter:async(file,callback)=>{writes++;const next=structuredClone(records.get(file.path).fm);callback(next);records.get(file.path).fm=next;},
      renameFile:async(file,path)=>{writes++;const record=records.get(file.path);records.delete(file.path);file.path=path;file.name=path.split('/').at(-1);file.basename=file.name.replace(/\.md$/,'');records.set(path,record);}},
    metadataCache:{getFileCache:file=>({frontmatter:records.get(file.path).fm}),fileToLinktext:file=>file.basename,getFirstLinkpathDest:target=>[...records.values()].find(r=>r.file.basename===target||r.file.path===target)?.file??null},
    renderContext:{},workspace:{openLinkText:async(...args)=>{opened.push(args);},trigger:(...args)=>{hovered.push(args);},handleLinkContextMenu:(...args)=>{contextMenus.push(args);return true;}}
  };
  globalThis.testApp=app;globalThis.notices=[];
  const plugin=new Plugin();
  const view=new ManualOrderView({app},dom.window.document.getElementById('view'),plugin);
  const options={orderProperty:'priority',orderDirection:'asc'};
  view.config={get:key=>options[key],set:(key,value)=>{if(value===null)delete options[key];else options[key]=structuredClone(value);},getOrder:()=>columns,getDisplayName:id=>id};
  const entries=[...records.values()].map(record=>({file:record.file,getValue:id=>record.fm[id.replace('note.','')]===undefined?null:{toString:()=>String(record.fm[id.replace('note.','')]),renderTo:el=>{el.textContent=String(record.fm[id.replace('note.','')]);}}}));
  view.data={data:entries,groupedData:[{entries,hasKey:()=>false}]};
  view.onDataUpdated();
  return {dom,records,plugin,view,options,app,entries,opened,hovered,contextMenus,get writes(){return writes;}};
}
const displayed=ctx=>[...ctx.dom.window.document.querySelectorAll('tbody tr')].map(tr=>[...tr.cells].slice(1).map(cell=>cell.textContent));

function summaryAPI(ctx) {
  const calls=[];ctx.view.data.getSummaryValue=(controller,entries,property,key)=>{
    calls.push({paths:entries.map(entry=>entry.file.path),property,key,controller});
    const value=key==='Sum'?entries.reduce((sum,entry)=>sum+(ctx.records.get(entry.file.path).fm[property.slice(5)]??0),0):entries.length;
    return {toString:()=>String(value),renderTo:el=>{el.createSpan({cls:'native-summary-result',text:String(value)});}};
  };return calls;
}
const totalSummary=ctx=>ctx.dom.window.document.querySelector('.manual-order-summary-total .manual-order-summary-value')?.textContent;
test('native summary API receives each nested group and the deduplicated overall result set',()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups[1].layout='vertical';const calls=summaryAPI(ctx);ctx.options.summaries={'note.priority':'Sum'};ctx.view.onDataUpdated();
  assert.equal(totalSummary(ctx),'10');assert.equal(groupHeader(ctx,'note.team: A').querySelector('.manual-order-summary-value').textContent,'3');assert.equal(groupHeader(ctx,'note.team: B').querySelector('.manual-order-summary-value').textContent,'7');
  const empty=[...ctx.dom.window.document.querySelectorAll('.manual-order-board-column')].find(column=>column.querySelector('.manual-order-group-count').textContent==='0');assert.equal(empty.querySelector('.manual-order-summary-value').textContent,'0');
  assert.ok(calls.some(call=>call.paths.length===4&&new Set(call.paths).size===4));assert.ok(calls.every(call=>call.property==='note.priority'&&call.key==='Sum'&&call.controller.app===ctx.app));assert.equal(ctx.writes,0);
});
test('summary menus persist native choices and remove the summary bars when None is selected',async()=>{
  const ctx=setup();summaryAPI(ctx);const doc=ctx.dom.window.document,table=doc.querySelector('table');
  doc.querySelector('button[aria-label="Summarize note.priority"]').click();[...doc.querySelectorAll('.mock-menu button')].find(button=>button.textContent==='Sum').click();await settle(ctx);
  assert.deepEqual(ctx.options.summaries,{'note.priority':'Sum'});assert.equal(totalSummary(ctx),'6');assert.equal(doc.querySelector('table'),table);assert.equal(ctx.writes,0);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},doc.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.equal(totalSummary(ctx),'6');
  doc.querySelector('.manual-order-summary-total [aria-label="Summarize note.priority"]').click();[...doc.querySelectorAll('.mock-menu button')].find(button=>button.textContent==='None').click();await settle(ctx);assert.equal(ctx.options.summaries,undefined);assert.equal(doc.querySelector('.manual-order-summary-total'),null);
});
test('collapsed groups remain summarized and hidden values are excluded from parent and overall summaries',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups[1].layout='vertical';summaryAPI(ctx);ctx.options.summaries={'note.priority':'Sum'};ctx.view.onDataUpdated();
  groupHeader(ctx,'note.team: B').click();await settle(ctx);assert.equal(groupHeader(ctx,'note.team: B').querySelector('.manual-order-summary-value').textContent,'7');assert.equal(totalSummary(ctx),'10');groupHeader(ctx,'note.team: B').click();await settle(ctx);
  const check=valueMenu(ctx).querySelector('input[aria-label="Show group Waiting"]');check.checked=false;check.dispatchEvent(new ctx.dom.window.Event('change'));await settle(ctx);assert.equal(totalSummary(ctx),'6');assert.equal(groupHeader(ctx,'note.team: B').querySelector('.manual-order-summary-value').textContent,'3');
});
test('summary values refresh after rank edits without replacing the data table',async()=>{
  const ctx=setup();summaryAPI(ctx);ctx.options.summaries={'note.priority':'Sum'};ctx.view.onDataUpdated();const table=ctx.dom.window.document.querySelector('table'),file=ctx.entries[0].file;
  await ctx.plugin.commitCell({file,path:file.path,property:'note.priority',exists:true,value:1},{exists:true,value:5});assert.equal(totalSummary(ctx),'10');assert.equal(ctx.dom.window.document.querySelector('table'),table);
  await ctx.plugin.undoEdit();assert.equal(totalSummary(ctx),'6');
});
test('existing custom summary names delegate to Bases and summary errors do not break the table',()=>{
  const ctx=setup();const calls=summaryAPI(ctx);ctx.options.summaries={'note.priority':'My custom summary'};ctx.view.onDataUpdated();assert.equal(totalSummary(ctx),'3');assert.ok(calls.some(call=>call.key==='My custom summary'));
  ctx.view.data.getSummaryValue=()=>{throw new Error('Unknown summary');};assert.doesNotThrow(()=>ctx.view.onDataUpdated());assert.equal(totalSummary(ctx),'—');assert.match(ctx.dom.window.document.querySelector('.manual-order-summary-total [aria-label="Summarize note.priority"]').title,/Unknown summary/);assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,3);
});

function delayMetadataWithCircularFiles(ctx) {
  const cached=new Map([...ctx.records].map(([path,record])=>[path,structuredClone(record.fm)]));
  const original=ctx.app.metadataCache.getFileCache;
  ctx.app.metadataCache.getFileCache=file=>({frontmatter:cached.get(file.path)});
  for(const record of ctx.records.values())record.file._={closed:[{e:record.file}]};
  return ()=>{ctx.app.metadataCache.getFileCache=original;};
}
test('delayed metadata after an edit fingerprints only property payloads, never circular TFile objects',async()=>{
  const ctx=setup([1,2,3],['file.name','note.keep']),table=ctx.dom.window.document.querySelector('table');const catchUp=delayMetadataWithCircularFiles(ctx),file=ctx.entries[0].file;
  await ctx.plugin.commitCell({file,path:file.path,property:'note.keep',exists:true,value:'unchanged'},{exists:true,value:'updated'});
  assert.deepEqual(ctx.view.cellValue(ctx.entries[0],'note.keep'),{exists:true,value:'updated'});assert.doesNotThrow(()=>ctx.view.onDataUpdated());
  assert.equal(ctx.dom.window.document.querySelector('table'),table);assert.equal(ctx.dom.window.document.querySelector('td[data-property="note.keep"]').textContent,'updated');
  catchUp();assert.doesNotThrow(()=>ctx.view.onDataUpdated());assert.equal(ctx.plugin.cellOverrides.size,0);
});
test('moving multiple rows across vertical columns tolerates circular files while metadata is stale',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups[1].layout='vertical';ctx.view.onDataUpdated();const catchUp=delayMetadataWithCircularFiles(ctx);
  const target=ctx.view.groupTargets.find(target=>target.bindings.some(binding=>binding.property==='note.team'&&binding.value.value==='B')&&target.bindings.some(binding=>binding.property==='note.stage'&&binding.value.value==='Waiting'));
  await ctx.view.moveRowsToGroup(['Note 1.md','Note 2.md'],target);assert.doesNotThrow(()=>ctx.view.refreshGroupAvailability());
  for(const path of ['Note 1.md','Note 2.md']){assert.equal(ctx.records.get(path).fm.team,'B');assert.equal(ctx.records.get(path).fm.stage,'Waiting');}
  assert.equal(ctx.plugin.editHistory.length,1);assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,4);
  catchUp();assert.doesNotThrow(()=>ctx.view.onDataUpdated());await ctx.plugin.undoEdit();for(const path of ['Note 1.md','Note 2.md'])assert.equal(ctx.records.get(path).fm.team,'A');
});

test('ordinary edits patch only changed cells and retain table, rows, focus and selection',async()=>{
  const ctx=setup([1,2,3],['file.name','note.priority','note.keep']);const doc=ctx.dom.window.document;
  const table=doc.querySelector('table'),row=doc.querySelector('tbody tr'),changed=row.querySelector('td[data-property="note.keep"]'),other=doc.querySelector('tr[data-row-path="Note 2.md"] td[data-property="note.keep"]');
  ctx.view.selection.selectCell(other);other.focus();const file=ctx.entries[0].file;
  const saving=ctx.plugin.commitCell({file,path:file.path,property:'note.keep',exists:true,value:'unchanged'},{exists:true,value:'updated'});
  assert.equal(doc.querySelector('table'),table,'save start keeps the existing table mounted');await saving;
  assert.equal(doc.querySelector('table'),table);assert.equal(doc.querySelector('tbody tr'),row);assert.equal(other.isConnected,true);assert.equal(doc.activeElement,other);
  assert.equal(other.classList.contains('manual-order-cell-selected'),true);assert.equal(row.querySelector('td[data-property="note.keep"]').textContent,'updated');assert.equal(changed.isConnected,false);
  const replacement=row.querySelector('td[data-property="note.keep"]');ctx.view.onDataUpdated();assert.equal(row.querySelector('td[data-property="note.keep"]'),replacement,'a repeated query refresh does not replace unchanged cells');
});
test('cancelled editors restore preview in their own cell without rebuilding surrounding rows',async()=>{
  const ctx=setup([1,2,3],['file.name','note.keep']),doc=ctx.dom.window.document,table=doc.querySelector('table'),other=doc.querySelector('tr[data-row-path="Note 2.md"]');
  await ctx.view.editCell(ctx.entries[0],'note.keep');ctx.view.editor.cancel();await settle(ctx);
  assert.equal(doc.querySelector('table'),table);assert.equal(other.isConnected,true);assert.equal(doc.querySelector('.manual-order-editor'),null);assert.equal(doc.querySelector('td[data-property="note.keep"]').textContent,'unchanged');
});
test('list patches replace only their cell and release obsolete sizing registrations',async()=>{
  const ctx=setup([1,2,3],['file.name','note.items']);ctx.plugin.propertyTypes.set('items','list');ctx.records.get('Note 1.md').fm.items=['first'];ctx.view.onDataUpdated();
  const doc=ctx.dom.window.document,table=doc.querySelector('table'),row=doc.querySelector('tbody tr'),file=ctx.entries[0].file;
  for(const values of [['first','second'],['third'],[]]) {
    const before=structuredClone(ctx.records.get(file.path).fm.items);await ctx.plugin.commitCell({file,path:file.path,property:'note.items',exists:true,value:before},{exists:true,value:values});
    assert.equal(doc.querySelector('table'),table);assert.equal(doc.querySelector('tbody tr'),row);assert.equal(ctx.view.rowLayout.rows.get(file.path).lists.length,1);assert.equal(row.querySelectorAll('.manual-order-list-items li').length,values.length);
  }
});
test('fresh Bases entry objects and formula dependencies update without replacing unaffected cells',()=>{
  const ctx=setup([1,2,3],['note.keep','formula.result']),doc=ctx.dom.window.document;const table=doc.querySelector('table'),unchanged=doc.querySelector('td[data-property="note.keep"]');
  ctx.view.data.data=ctx.entries.map(entry=>({...entry,getValue:id=>id==='formula.result'?{toString:()=> 'calculated',renderTo:el=>{el.textContent='calculated';}}:entry.getValue(id)}));ctx.view.data.groupedData[0].entries=ctx.view.data.data;ctx.view.onDataUpdated();
  assert.equal(doc.querySelector('table'),table);assert.equal(doc.querySelector('td[data-property="note.keep"]'),unchanged);assert.equal(doc.querySelector('td[data-property="formula.result"]').textContent,'calculated');
});
test('rank edits move existing rows while grouping and query membership changes still update the layout',()=>{
  const ctx=setup([1,2,3],['note.keep','note.priority']);const doc=ctx.dom.window.document,table=doc.querySelector('table');ctx.records.get('Note 1.md').fm.priority=4;ctx.view.onDataUpdated();
  assert.equal(doc.querySelector('table'),table);assert.deepEqual([...doc.querySelectorAll('tbody tr')].map(row=>row.dataset.rowPath),['Note 2.md','Note 3.md','Note 1.md']);
  ctx.options.manualGroups=[{property:'note.keep',direction:'asc'}];ctx.view.onDataUpdated();assert.ok(doc.querySelector('.manual-order-group-header'));
  ctx.view.data.data=ctx.view.data.data.slice(1);ctx.view.data.groupedData[0].entries=ctx.view.data.data;ctx.view.onDataUpdated();assert.equal(doc.querySelector('tr[data-row-path="Note 1.md"]'),null);
});

function valueMenu(ctx,property='note.stage') {
  if(!ctx.dom.window.document.querySelector('.manual-order-group-menu'))[...ctx.dom.window.document.querySelectorAll('.manual-order-toolbar button')].find(button=>button.textContent.startsWith('Groups')).click();
  return [...ctx.dom.window.document.querySelectorAll('.manual-order-group-values')].find(el=>el.querySelector('summary').textContent.startsWith(property+' —'));
}
async function chooseGroupColor(ctx,property,value,color) {
  const picker=valueMenu(ctx,property).querySelector(`input[aria-label="Color for group ${value}"]`);picker.value=color;picker.dispatchEvent(new ctx.dom.window.Event('change',{bubbles:true}));await settle(ctx);
}
test('group value colors update matching empty and filled columns in place and persist on reopen',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups[1].layout='vertical';ctx.view.onDataUpdated();valueMenu(ctx);
  const table=ctx.dom.window.document.querySelector('table');await chooseGroupColor(ctx,'note.stage','Waiting','#22aa55');
  assert.equal(ctx.dom.window.document.querySelector('table'),table);const matches=[...ctx.dom.window.document.querySelectorAll('.manual-order-board-column')].filter(section=>section.querySelector('.manual-order-group-label').textContent==='note.stage: Waiting');assert.equal(matches.length,2);
  for(const section of matches){assert.equal(section.classList.contains('is-colored-group'),true);assert.equal(section.style.getPropertyValue('--manual-order-group-color'),'#22aa55');}
  assert.equal(ctx.dom.window.document.querySelectorAll('.is-colored-group').length,2);assert.equal(ctx.writes,0);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.equal(ctx.dom.window.document.querySelectorAll('.is-colored-group').length,2);
  const clear=valueMenu(ctx).querySelector('button[aria-label="Clear color for group Waiting"]');assert.equal(clear.disabled,false);clear.click();await settle(ctx);assert.equal(ctx.options.manualGroupColors,undefined);assert.equal(ctx.dom.window.document.querySelector('.is-colored-group'),null);assert.equal(ctx.writes,0);
});
test('horizontal group values offer colors and keep them when switching orientation',async()=>{
  const ctx=groupedMoveFixture();const menu=valueMenu(ctx,'note.team');assert.equal(menu.querySelector('input[type=checkbox]'),null);
  await chooseGroupColor(ctx,'note.team','A','#cc3355');assert.equal(groupHeader(ctx,'note.team: A').parentElement.style.getPropertyValue('--manual-order-group-color'),'#cc3355');
  ctx.options.manualGroups[0].layout='vertical';ctx.view.onDataUpdated();assert.equal(groupHeader(ctx,'note.team: A').parentElement.style.getPropertyValue('--manual-order-group-color'),'#cc3355');assert.equal(ctx.writes,0);
});
test('nested color resets remove only that value and invalid stored colors are ignored',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups[1].layout='vertical';ctx.view.onDataUpdated();await chooseGroupColor(ctx,'note.team','A','#cc3355');await chooseGroupColor(ctx,'note.stage','Ready','#2266dd');
  const ready=groupHeader(ctx,'note.stage: Ready').parentElement,key=ready.dataset.groupColorKey;assert.equal(ready.style.getPropertyValue('--manual-order-group-color'),'#2266dd');
  valueMenu(ctx).querySelector('button[aria-label="Clear color for group Ready"]').click();await settle(ctx);assert.equal(ready.style.getPropertyValue('--manual-order-group-color'),'');assert.equal(Object.keys(ctx.options.manualGroupColors).length,1);
  ctx.options.manualGroupColors[key]='red; background: url(bad)';ctx.view.onDataUpdated();assert.equal(ready.classList.contains('is-colored-group'),false);assert.equal(groupHeader(ctx,'note.team: A').parentElement.classList.contains('is-colored-group'),true);
});
test('failed group color saves leave the prior presentation and settings intact',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups[1].layout='vertical';ctx.view.onDataUpdated();const save=ctx.view.config.set;
  ctx.view.config.set=(key,value)=>{if(key==='manualGroupColors'&&value)throw new Error('color save failed');save(key,value);};await chooseGroupColor(ctx,'note.stage','Ready','#2266dd');
  assert.equal(ctx.options.manualGroupColors,undefined);assert.equal(ctx.dom.window.document.querySelector('.is-colored-group'),null);assert.match(globalThis.notices.at(-1),/color save failed/);assert.equal(ctx.writes,0);
});
test('empty filtered Bases allow unused outer group values to be added',async()=>{
  const ctx=setup([]);ctx.options.manualGroups=[{property:'note.status',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const input=valueMenu(ctx,'note.status').querySelector('input[type=text]');input.value='To do';input.closest('form').dispatchEvent(new ctx.dom.window.Event('submit',{cancelable:true}));await settle(ctx);
  assert.deepEqual(stageColumns(ctx),[['note.status: To do']]);assert.equal(ctx.writes,0);
});
test('native primary value menus add destinations and preserve aliased links',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[];ctx.options.manualNativeGroupLayout='vertical';ctx.view.config.groupBy={property:'note.team',direction:'ASC'};
  ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,2),key:{toString:()=> 'A',renderTo:el=>{el.textContent='A';}},hasKey:()=>true},{entries:ctx.entries.slice(2),key:{toString:()=> 'B',renderTo:el=>{el.textContent='B';}},hasKey:()=>true}];ctx.view.onDataUpdated();
  const input=valueMenu(ctx,'note.team').querySelector('input[type=text]');input.value='[[Note 4|Fourth]]';input.closest('form').dispatchEvent(new ctx.dom.window.Event('submit',{cancelable:true}));await settle(ctx);
  const link=valueMenu(ctx,'note.team').querySelector('a.internal-link');assert.equal(link.textContent,'Fourth');link.click();await settle(ctx);assert.ok(ctx.opened.length);assert.equal(ctx.writes,0);assert.equal(stageColumns(ctx)[0].length,3);
});
test('failed value-setting saves restore the previous group order and visibility',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();const save=ctx.view.config.set;
  ctx.view.config.set=(key,value)=>{if(key==='manualGroupValues'&&value)throw new Error('settings failed');save(key,value);};
  valueMenu(ctx,'note.team').querySelector('button[aria-label="Move group B"]').dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true,cancelable:true}));await settle(ctx);
  assert.deepEqual(stageColumns(ctx),[['note.team: A','note.team: B']]);assert.equal(ctx.options.manualVerticalGroupOrder,undefined);assert.match(globalThis.notices.at(-1),/settings failed/);assert.equal(ctx.writes,0);
});
test('value menu hides shared columns without deleting notes or reserving hidden slots and restores on reopen',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const menu=valueMenu(ctx);assert.equal(menu.querySelectorAll('.manual-order-group-value-option').length,2);
  const check=menu.querySelector('input[aria-label="Show group Ready"]');check.checked=false;check.dispatchEvent(new ctx.dom.window.Event('change'));await settle(ctx);
  assert.deepEqual(stageColumns(ctx),[['note.stage: Waiting'],['note.stage: Waiting']]);assert.equal(ctx.dom.window.document.querySelector('tr[data-row-path="Note 1.md"]'),null);assert.equal(ctx.writes,0);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.deepEqual(stageColumns(ctx),[['note.stage: Waiting'],['note.stage: Waiting']]);
  [...valueMenu(ctx).querySelectorAll('button')].find(button=>button.textContent==='Show all').click();await settle(ctx);assert.deepEqual(stageColumns(ctx),[['note.stage: Ready','note.stage: Waiting'],['note.stage: Ready','note.stage: Waiting']]);assert.equal(ctx.writes,0);
});
test('menu keyboard reordering controls every matching board and can reset',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  valueMenu(ctx).querySelector('button[aria-label="Move group Waiting"]').dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true,cancelable:true}));await settle(ctx);
  assert.deepEqual(stageColumns(ctx),[['note.stage: Waiting','note.stage: Ready'],['note.stage: Waiting','note.stage: Ready']]);ctx.view.onDataUpdated();assert.deepEqual(stageColumns(ctx),[['note.stage: Waiting','note.stage: Ready'],['note.stage: Waiting','note.stage: Ready']]);
  await dropGroup(ctx,groupHeader(ctx,'note.stage: Ready'),groupHeader(ctx,'note.stage: Waiting'));assert.deepEqual(stageColumns(ctx),[['note.stage: Ready','note.stage: Waiting'],['note.stage: Ready','note.stage: Waiting']]);
  valueMenu(ctx).querySelector('button[aria-label="Move group Waiting"]').dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true,cancelable:true}));await settle(ctx);assert.deepEqual(stageColumns(ctx),[['note.stage: Waiting','note.stage: Ready'],['note.stage: Waiting','note.stage: Ready']],'the menu can restore its earlier order after a header drag');
  ctx.dom.window.document.querySelector('.manual-order-reset-group-order').click();await settle(ctx);assert.deepEqual(stageColumns(ctx),[['note.stage: Ready','note.stage: Waiting'],['note.stage: Ready','note.stage: Waiting']]);assert.equal(ctx.writes,0);
});
test('adding an unused value creates persistent empty destinations under horizontal parents and accepts row moves',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const menu=valueMenu(ctx),input=menu.querySelector('input[type=text]');input.value='New stage';input.closest('form').dispatchEvent(new ctx.dom.window.Event('submit',{cancelable:true}));await settle(ctx);
  assert.equal(ctx.writes,0);assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-empty-group').length,3);ctx.view.onDataUpdated();
  const headers=[...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')].filter(el=>el.querySelector('.manual-order-group-label').textContent==='note.stage: New stage');assert.equal(headers.length,2);
  const handle=ctx.dom.window.document.querySelector('tr[data-row-path="Note 1.md"] .manual-order-handle');dragEvent(ctx,handle,'dragstart',dataTransfer());dragEvent(ctx,headers[1],'drop',dataTransfer());await settle(ctx);
  assert.equal(ctx.records.get('Note 1.md').fm.stage,'New stage');assert.equal(ctx.records.get('Note 1.md').fm.team,'B');ctx.view.onDataUpdated();
  assert.equal([...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')].filter(el=>el.querySelector('.manual-order-group-label').textContent==='note.stage: New stage').length,2);
});
test('added values respect numeric property types and duplicate values produce one column',async()=>{
  const ctx=setup();ctx.options.manualGroups=[{property:'note.priority',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  for(const value of ['4','4']) {const input=valueMenu(ctx,'note.priority').querySelector('input[type=text]');input.value=value;input.closest('form').dispatchEvent(new ctx.dom.window.Event('submit',{cancelable:true}));await settle(ctx);}
  assert.equal(ctx.options.manualGroupValues['note.priority'].added[0],4);assert.equal(stageColumns(ctx)[0].filter(label=>label==='note.priority: 4').length,1);assert.equal(ctx.writes,0);
});
test('group menu drag reorders values and hide all keeps the menu usable',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  let menu=valueMenu(ctx,'note.team'),rows=menu.querySelectorAll('.manual-order-group-value-option');dragEvent(ctx,rows[1].querySelector('button'),'dragstart',dataTransfer());dragEvent(ctx,rows[0],'drop',dataTransfer());await settle(ctx);assert.deepEqual(stageColumns(ctx),[['note.team: B','note.team: A']]);
  menu=valueMenu(ctx,'note.team');[...menu.querySelectorAll('button')].find(button=>button.textContent==='Hide all').click();await settle(ctx);assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-board-column').length,0);
  [...valueMenu(ctx,'note.team').querySelectorAll('button')].find(button=>button.textContent==='Show all').click();await settle(ctx);assert.deepEqual(stageColumns(ctx),[['note.team: B','note.team: A']]);assert.equal(ctx.writes,0);
});

test('table drop persists the user example, renders it, and undo restores it',async()=>{
  const ctx=setup();
  assert.equal(ctx.writes,0);
  const handles=ctx.dom.window.document.querySelectorAll('.manual-order-handle');
  handles[1].ondragstart({dataTransfer:{setData(){},setDragImage(){}}});
  ctx.dom.window.document.querySelector('tbody tr').ondrop({preventDefault(){},clientY:-1});
  for(let i=0;i<20&&ctx.plugin.busy;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(ctx.records.get('Note 2.md').fm.priority,0);
  assert.equal(ctx.records.get('Note 1.md').fm.priority,1);
  assert.equal(ctx.records.get('Note 3.md').fm.priority,3);
  assert.deepEqual(displayed(ctx),[['Note 2','0'],['Note 1','1'],['Note 3','3']]);
  assert.equal(ctx.writes,1);
  for(const r of ctx.records.values())assert.equal(r.fm.keep,'unchanged');
  await ctx.plugin.undo();
  assert.deepEqual(displayed(ctx),[['Note 1','1'],['Note 2','2'],['Note 3','3']]);
});
test('external rank conflicts block undo without overwriting',async()=>{
  const ctx=setup();
  await ctx.view.move('Note 2.md','Note 1.md',false,0);
  ctx.records.get('Note 2.md').fm.priority=99;
  const writes=ctx.writes;
  await ctx.plugin.undo();
  assert.equal(ctx.records.get('Note 2.md').fm.priority,99);
  assert.equal(ctx.writes,writes);
  assert.match(globalThis.notices.at(-1),/changed/);
});
test('empty original values are restored exactly by undo',async()=>{
  for(const empty of [undefined,null,'']) {
    const ctx=setup([1,empty,3]);
    await ctx.view.move('Note 2.md','Note 1.md',false,0);
    assert.equal(ctx.records.get('Note 2.md').fm.priority,0);
    await ctx.plugin.undo();
    assert.equal(ctx.records.get('Note 2.md').fm.priority,empty);
    assert.equal(Object.hasOwn(ctx.records.get('Note 2.md').fm,'priority'),empty!==undefined);
  }
});
test('text ranks disable handles and opening a view makes no writes',()=>{
  const ctx=setup([1,'high',3]);
  assert.equal(ctx.writes,0);
  assert.ok([...ctx.dom.window.document.querySelectorAll('.manual-order-handle')].every(el=>!el.draggable&&!el.disabled));
});
test('changing direction reverses the table without writing notes',()=>{
  const ctx=setup();ctx.options.orderDirection='desc';ctx.view.onDataUpdated();
  assert.deepEqual(displayed(ctx),[['Note 3','3'],['Note 2','2'],['Note 1','1']]);
  assert.equal(ctx.writes,0);
});

test('a changed row that needs no renumbering still aborts a stale reorder',async()=>{
  const ctx=setup();
  ctx.records.get('Note 3.md').fm.priority=99;
  await ctx.view.move('Note 2.md','Note 1.md',false,0);
  assert.equal(ctx.writes,0);
  assert.equal(ctx.records.get('Note 1.md').fm.priority,1);
});

test('query refresh invalidates an in-progress drag',()=>{
  const ctx=setup();
  ctx.dom.window.document.querySelectorAll('.manual-order-handle')[1].ondragstart({dataTransfer:{setData(){},setDragImage(){}}});
  ctx.view.onDataUpdated();
  ctx.dom.window.document.querySelector('tbody tr').ondrop({preventDefault(){},clientY:-1});
  assert.equal(ctx.writes,0);
});

const settle=async ctx=>{for(let i=0;i<60&&(ctx.plugin.busy||ctx.view.loadingEditor||ctx.view.pasting||ctx.view.movingRows);i++)await new Promise(resolve=>setTimeout(resolve,0));await new Promise(resolve=>setTimeout(resolve,0));};
const cell=(ctx,path,property)=>[...ctx.dom.window.document.querySelectorAll('td[data-property]')].find(el=>el.dataset.path===path&&el.dataset.property===property);
const editorInput=ctx=>ctx.dom.window.document.querySelector('.manual-order-editor-input');

test('clicking a cell edits text, preserves other properties, and undo restores it',async()=>{
  const ctx=setup([1,2,3],['file.name','note.keep','note.priority']);
  cell(ctx,'Note 1.md','note.keep').click();await settle(ctx);
  editorInput(ctx).value='Edited from the table';
  await ctx.view.editor.save();
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'Edited from the table');
  assert.equal(ctx.records.get('Note 1.md').fm.priority,1);
  await ctx.plugin.undoEdit();
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'unchanged');
});

test('editing a rank re-sorts the table and remains numeric',async()=>{
  const ctx=setup();
  await ctx.view.editCell(ctx.entries[1],'note.priority');
  editorInput(ctx).value='0';await ctx.view.editor.save();
  assert.equal(ctx.records.get('Note 2.md').fm.priority,0);
  assert.deepEqual(displayed(ctx),[['Note 2','0'],['Note 1','1'],['Note 3','3']]);
});

test('invalid numeric input stays editable and never writes',async()=>{
  const ctx=setup();await ctx.view.editCell(ctx.entries[0],'note.priority');
  editorInput(ctx).value='not a number';
  assert.equal(await ctx.view.editor.save(),false);
  assert.equal(ctx.writes,0);
  assert.equal(editorInput(ctx).value,'not a number');
  ctx.view.editor.cancel();
});

test('draft survives a query refresh and Escape cancels without writing',async()=>{
  const ctx=setup();await ctx.view.editCell(ctx.entries[0],'note.priority');
  editorInput(ctx).value='17';ctx.view.onDataUpdated();
  assert.equal(editorInput(ctx).value,'17');
  editorInput(ctx).dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(ctx.writes,0);
  assert.equal(ctx.dom.window.document.querySelector('.manual-order-editor'),null);
});

test('concurrent property edit refuses overwrite and keeps the draft',async()=>{
  const ctx=setup();await ctx.view.editCell(ctx.entries[0],'note.priority');
  editorInput(ctx).value='5';ctx.records.get('Note 1.md').fm.priority=10;
  assert.equal(await ctx.view.editor.save(),false);
  assert.equal(ctx.records.get('Note 1.md').fm.priority,10);
  assert.equal(editorInput(ctx).value,'5');
  ctx.view.editor.cancel();
});

test('clear removes the key and undo restores false exactly',async()=>{
  const ctx=setup([1,2,3],['note.done']);ctx.records.get('Note 1.md').fm.done=false;
  ctx.view.onDataUpdated();await ctx.view.editCell(ctx.entries[0],'note.done');
  await ctx.view.editor.save(0,{exists:false,value:undefined});
  assert.equal(Object.hasOwn(ctx.records.get('Note 1.md').fm,'done'),false);
  await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.done,false);
});

test('checkbox can be toggled directly and undone',async()=>{
  const ctx=setup([1,2,3],['note.done']);ctx.records.get('Note 1.md').fm.done=false;ctx.view.onDataUpdated();
  cell(ctx,'Note 1.md','note.done').querySelector('input').click();await settle(ctx);
  assert.equal(ctx.records.get('Note 1.md').fm.done,true);
  await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.done,false);
});

test('Tab saves and opens the next editable cell',async()=>{
  const ctx=setup([1,2,3],['note.keep','note.priority']);
  await ctx.view.editCell(ctx.entries[0],'note.keep');editorInput(ctx).value='saved with Tab';
  editorInput(ctx).dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
  await settle(ctx);
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'saved with Tab');
  assert.equal(editorInput(ctx).getAttribute('aria-label'),'Value for note.priority');
  ctx.view.editor.cancel();
});

test('rename uses file manager, preserves reorder undo, and can be undone',async()=>{
  const ctx=setup();await ctx.view.move('Note 2.md','Note 1.md',false,0);
  cell(ctx,'Note 2.md','file.name').querySelector('.manual-order-rename').click();await settle(ctx);
  editorInput(ctx).value='Renamed.md';await ctx.view.editor.save();
  assert.equal(ctx.records.has('Note 2.md'),false);
  assert.equal(ctx.records.get('Renamed.md').fm.priority,0);
  await ctx.plugin.undo();assert.equal(ctx.records.get('Renamed.md').fm.priority,2);
  await ctx.plugin.undoEdit();assert.ok(ctx.records.has('Note 2.md'));
});

test('rename collision leaves both files and the editor intact',async()=>{
  const ctx=setup();await ctx.view.editCell(ctx.entries[0],'file.name');
  editorInput(ctx).value='Note 2.md';assert.equal(await ctx.view.editor.save(),false);
  assert.equal(ctx.records.size,3);assert.equal(ctx.writes,0);
  ctx.view.editor.cancel();
});

test('structured lists and literal numeric-looking text round-trip without coercion',async()=>{
  const ctx=setup([1,2,3],['note.tags','note.keep']);
  await ctx.view.editCell(ctx.entries[0],'note.tags');editorInput(ctx).value='alpha\ncontains, comma\n[[Note 2]]';
  await ctx.view.editor.save();assert.deepEqual(ctx.records.get('Note 1.md').fm.tags,['alpha','contains, comma','[[Note 2]]']);
  await ctx.view.editCell(ctx.entries[0],'note.keep');editorInput(ctx).value='001';await ctx.view.editor.save();
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'001');
});

test('inline editing has one input and no buttons, type picker, or help panel',async()=>{
  const ctx=setup([1,2,3],['note.keep']);
  await ctx.view.editCell(ctx.entries[0],'note.keep');
  const editor=ctx.dom.window.document.querySelector('.manual-order-editor');
  assert.equal(editor.querySelectorAll('input,textarea').length,1);
  assert.equal(editor.querySelectorAll('button,select,label').length,0);
  assert.equal(editor.querySelector('.manual-order-editor-error').hidden,true);
  assert.equal(editorInput(ctx).rows,1);
  assert.equal(editorInput(ctx).selectionStart,editorInput(ctx).value.length);
  assert.equal(editorInput(ctx).selectionEnd,editorInput(ctx).value.length);
  ctx.view.editor.cancel();
});

test('saved Obsidian property type overrides each individual cell value',async()=>{
  const ctx=setup([1,2,3],['note.score']);
  ctx.records.get('Note 1.md').fm.score='12';
  ctx.records.get('Note 2.md').fm.score=14;
  ctx.app.vault.configDir='.obsidian';
  ctx.app.vault.adapter={exists:async()=>true,read:async()=>JSON.stringify({types:{score:'number'}})};
  await ctx.view.editCell(ctx.entries[0],'note.score');
  assert.equal(editorInput(ctx).inputMode,'decimal');
  editorInput(ctx).value='15';await ctx.view.editor.save();
  assert.equal(ctx.records.get('Note 1.md').fm.score,15);
  await ctx.view.editCell(ctx.entries[1],'note.score');
  assert.equal(editorInput(ctx).inputMode,'decimal');
  ctx.view.editor.cancel();
});

test('an empty cell uses the property definition and reloads type changes from Obsidian',async()=>{
  const ctx=setup([1,2,3],['note.field']);
  let type='date';
  ctx.app.vault.configDir='.obsidian';
  ctx.app.vault.adapter={exists:async()=>true,read:async()=>JSON.stringify({types:{field:type}})};
  await ctx.view.editCell(ctx.entries[0],'note.field');assert.equal(editorInput(ctx).type,'date');ctx.view.editor.cancel();
  type='number';
  await ctx.view.editCell(ctx.entries[0],'note.field');assert.equal(editorInput(ctx).inputMode,'decimal');ctx.view.editor.cancel();
});

test('unassigned properties use one inferred type across rows with inconsistent values',async()=>{
  const ctx=setup([1,2,3],['note.score']);
  ctx.records.get('Note 1.md').fm.score=7;
  ctx.records.get('Note 2.md').fm.score='eight';
  await ctx.view.editCell(ctx.entries[1],'note.score');
  assert.equal(editorInput(ctx).inputMode,'decimal');
  editorInput(ctx).value='still not a number';
  assert.equal(await ctx.view.editor.save(),false);
  assert.equal(ctx.records.get('Note 2.md').fm.score,'eight');ctx.view.editor.cancel();
});

test('clicking away saves automatically without taking focus back',async()=>{
  const ctx=setup([1,2,3],['note.keep','note.priority']);
  await ctx.view.editCell(ctx.entries[0],'note.keep');editorInput(ctx).value='saved on blur';
  const outside=ctx.dom.window.document.createElement('input');ctx.dom.window.document.body.append(outside);outside.focus();
  await settle(ctx);
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'saved on blur');
  assert.equal(ctx.dom.window.document.activeElement,outside);
  assert.equal(ctx.dom.window.document.querySelector('.manual-order-editor'),null);
});

test('focusing then leaving a cell never normalizes or deletes an unchanged value',async()=>{
  const ctx=setup([1,2,3],['note.field']);
  ctx.app.vault.configDir='.obsidian';
  ctx.app.vault.adapter={exists:async()=>true,read:async()=>JSON.stringify({types:{field:'number'}})};
  ctx.records.get('Note 1.md').fm.field='001';
  await ctx.view.editCell(ctx.entries[0],'note.field');await ctx.view.editor.save();
  assert.equal(ctx.writes,0);assert.equal(ctx.records.get('Note 1.md').fm.field,'001');
  ctx.records.get('Note 2.md').fm.field=null;
  await ctx.view.editCell(ctx.entries[1],'note.field');await ctx.view.editor.save();
  assert.equal(ctx.writes,0);assert.equal(ctx.records.get('Note 2.md').fm.field,null);
});

function typeDraft(ctx,text,caret=text.length) {
  const input=editorInput(ctx);input.value=text;input.setSelectionRange(caret,caret);
  input.dispatchEvent(new ctx.dom.window.Event('input',{bubbles:true}));return input;
}
function press(ctx,key,extra={}) {editorInput(ctx).dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));}

test('typing [[ searches notes and Enter completes only that link without saving',async()=>{
  const ctx=setup([1,2,3],['note.keep']);await ctx.view.editCell(ctx.entries[0],'note.keep');
  typeDraft(ctx,'See [[Note 1]] then [[Note 2');
  assert.match(ctx.dom.window.document.querySelector('.manual-order-link-suggestions').textContent,/Note 2/);
  press(ctx,'Enter');
  assert.equal(editorInput(ctx).value,'See [[Note 1]] then [[Note 2]]');assert.equal(ctx.writes,0);
  assert.equal(ctx.dom.window.document.querySelector('.manual-order-link-suggestions'),null);
  press(ctx,'Enter');await settle(ctx);
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'See [[Note 1]] then [[Note 2]]');
  assert.equal(cell(ctx,'Note 1.md','note.keep').querySelectorAll('.internal-link').length,2);
});

test('list autocomplete preserves other items and supports multiple links in one item',async()=>{
  const ctx=setup([1,2,3],['note.related']);ctx.records.get('Note 1.md').fm.related=['[[Note 1]]','Other item'];
  await ctx.view.editCell(ctx.entries[0],'note.related');
  const draft='[[Note 1]] and [[Note 2';typeDraft(ctx,draft);
  const option=ctx.dom.window.document.querySelector('.manual-order-link-suggestions [role=option]');
  const mouse=new ctx.dom.window.MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0});option.dispatchEvent(mouse);
  assert.equal(mouse.defaultPrevented,true);option.click();
  assert.equal(editorInput(ctx).value,'[[Note 1]] and [[Note 2]]');
  await ctx.view.editor.save();
  assert.deepEqual(ctx.records.get('Note 1.md').fm.related,['[[Note 1]] and [[Note 2]]','Other item']);
  assert.equal(cell(ctx,'Note 1.md','note.related').querySelectorAll('.internal-link').length,2);
});

test('Escape closes suggestions first, then cancels the cell without writing',async()=>{
  const ctx=setup([1,2,3],['note.keep']);await ctx.view.editCell(ctx.entries[0],'note.keep');typeDraft(ctx,'[[');
  assert.ok(ctx.dom.window.document.querySelector('.manual-order-link-suggestions'));
  press(ctx,'Escape');assert.equal(ctx.dom.window.document.querySelector('.manual-order-link-suggestions'),null);assert.ok(ctx.view.editor);
  press(ctx,'Escape');assert.equal(ctx.view.editor,undefined);assert.equal(ctx.writes,0);
});

test('Tab accepts a suggestion before navigating and arrows change selection',async()=>{
  const ctx=setup([1,2,3],['note.keep','note.priority']);await ctx.view.editCell(ctx.entries[0],'note.keep');typeDraft(ctx,'[[');
  press(ctx,'ArrowDown');press(ctx,'Tab');
  assert.equal(editorInput(ctx).value,'[[Note 2]]');assert.equal(ctx.writes,0);
  press(ctx,'Tab');await settle(ctx);
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'[[Note 2]]');assert.equal(editorInput(ctx).getAttribute('aria-label'),'Value for note.priority');ctx.view.editor.cancel();
});

test('text links open with source path, modifier/middle clicks, hover, and native context menu',()=>{
  const ctx=setup([1,2,3],['note.keep']);ctx.records.get('Note 1.md').fm.keep='See [[Note 2|Second]] and [[Note 3#Heading]] plus [[Missing]]';ctx.view.onDataUpdated();
  const links=cell(ctx,'Note 1.md','note.keep').querySelectorAll('.internal-link');
  assert.equal(links.length,3);assert.equal(links[0].textContent,'Second');
  links[0].click();assert.deepEqual(ctx.opened.at(-1),['Note 2','Note 1.md',false]);assert.equal(ctx.view.editor,undefined);
  links[1].dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));assert.deepEqual(ctx.opened.at(-1),['Note 3#Heading','Note 1.md',true]);
  links[0].dispatchEvent(new ctx.dom.window.MouseEvent('auxclick',{bubbles:true,button:1}));assert.deepEqual(ctx.opened.at(-1),['Note 2','Note 1.md','tab']);
  links[0].dispatchEvent(new ctx.dom.window.MouseEvent('mouseover',{bubbles:true}));assert.equal(ctx.hovered.at(-1)[0],'hover-link');assert.equal(ctx.hovered.at(-1)[1].sourcePath,'Note 1.md');
  links[2].dispatchEvent(new ctx.dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));assert.equal(ctx.contextMenus.at(-1)[1],'Missing');assert.equal(ctx.contextMenus.at(-1)[2],'Note 1.md');
  assert.equal(ctx.writes,0);
});

test('links render immediately after save while the Bases query is still stale',async()=>{
  const ctx=setup([1,2,3],['note.keep']);await ctx.view.editCell(ctx.entries[0],'note.keep');typeDraft(ctx,'[[Note 2]] and [[Note 3]]');
  const oldGet=ctx.app.metadataCache.getFileCache;
  ctx.app.metadataCache.getFileCache=file=>file.path==='Note 1.md'?{frontmatter:{priority:1,keep:'unchanged'}}:oldGet(file);
  await ctx.view.editor.save();
  assert.equal(cell(ctx,'Note 1.md','note.keep').querySelectorAll('.internal-link').length,2);
});

test('autocomplete offers aliases and preserves an existing display alias',async()=>{
  const ctx=setup([1,2,3],['note.keep']);ctx.records.get('Note 2.md').fm.aliases=['Special Alias'];
  await ctx.view.editCell(ctx.entries[0],'note.keep');typeDraft(ctx,'[[Special');press(ctx,'Enter');assert.equal(editorInput(ctx).value,'[[Note 2|Special Alias]]');
  typeDraft(ctx,'Before [[Note 3|My label]] after','Before [[Note 3'.length);press(ctx,'Enter');
  assert.equal(editorInput(ctx).value,'Before [[Note 3|My label]] after');ctx.view.editor.cancel();
});

test('autocomplete does not activate outside a link or for numeric fields',async()=>{
  const ctx=setup([1,2,3],['note.keep','note.priority']);await ctx.view.editCell(ctx.entries[0],'note.keep');
  typeDraft(ctx,'ordinary text');assert.equal(ctx.dom.window.document.querySelector('.manual-order-link-suggestions'),null);ctx.view.editor.cancel();
  await ctx.view.editCell(ctx.entries[0],'note.priority');typeDraft(ctx,'[[');assert.equal(ctx.dom.window.document.querySelector('.manual-order-link-suggestions'),null);ctx.view.editor.cancel();
});

test('disposing a cell removes autocomplete and does not save a draft on later blur',async()=>{
  const ctx=setup([1,2,3],['note.keep']);await ctx.view.editCell(ctx.entries[0],'note.keep');typeDraft(ctx,'[[Note');
  ctx.view.editor.dispose();assert.equal(ctx.dom.window.document.querySelector('.manual-order-link-suggestions'),null);
  const outside=ctx.dom.window.document.createElement('input');ctx.dom.window.document.body.append(outside);outside.focus();await settle(ctx);
  assert.equal(ctx.writes,0);
});

test('Ctrl/Cmd-click opens the correct link while editing text and list values',async()=>{
  for(const type of ['text','list']) {
    const ctx=setup([1,2,3],['note.keep']);
    ctx.app.vault.configDir='.obsidian';ctx.app.vault.adapter={exists:async()=>true,read:async()=>JSON.stringify({types:{keep:type==='list'?'multitext':'text'}})};
    await ctx.view.editCell(ctx.entries[0],'note.keep');
    const text='See [[Note 2|Alias]] and [[Note 3#Heading]]';const input=typeDraft(ctx,text,text.indexOf('Heading'));
    input.dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));
    assert.deepEqual(ctx.opened.at(-1),['Note 3#Heading','Note 1.md',true]);
    input.setSelectionRange(text.indexOf('Alias'),text.indexOf('Alias'));
    input.dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,cancelable:true,metaKey:true}));
    assert.deepEqual(ctx.opened.at(-1),['Note 2','Note 1.md',true]);assert.equal(ctx.writes,0);
    assert.equal(input.value,text);assert.ok(ctx.view.editor);ctx.view.editor.cancel();
  }
});

test('ordinary editor clicks and selected text do not follow links',async()=>{
  const ctx=setup([1,2,3],['note.keep']);await ctx.view.editCell(ctx.entries[0],'note.keep');
  const input=typeDraft(ctx,'[[Note 2]]',4);
  input.dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true}));assert.equal(ctx.opened.length,0);
  input.setSelectionRange(2,6);input.dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));assert.equal(ctx.opened.length,0);
  ctx.view.editor.cancel();
});

test('list cells render separate bullet items and keep links interactive per item',()=>{
  const ctx=setup([1,2,3],['note.related']);
  ctx.records.get('Note 1.md').fm.related=['item 1','See [[Note 2]] and [[Note 3|Third]]','item 3'];ctx.view.onDataUpdated();
  const items=cell(ctx,'Note 1.md','note.related').querySelectorAll('.manual-order-list-items > li');
  assert.equal(items.length,3);assert.equal(items[0].textContent,'item 1');assert.equal(items[1].querySelectorAll('.internal-link').length,2);
  items[1].querySelector('.internal-link').click();assert.deepEqual(ctx.opened.at(-1),['Note 2','Note 1.md',false]);assert.equal(ctx.writes,0);
});

test('saved non-default row heights restore independently and follow notes through reorder',async()=>{
  const ctx=setup();ctx.options.manualRowHeights={'Note 1.md':120,'Note 3.md':200};ctx.view.onDataUpdated();
  const row=path=>[...ctx.dom.window.document.querySelectorAll('tbody tr')].find(tr=>tr.dataset.rowPath===path);
  assert.equal(row('Note 1.md').style.getPropertyValue('--manual-order-row-height'),'120px');
  assert.equal(row('Note 2.md').style.getPropertyValue('--manual-order-row-height'),'48px');
  assert.equal(row('Note 3.md').style.getPropertyValue('--manual-order-row-height'),'200px');
  await ctx.view.move('Note 3.md','Note 1.md',false,0);
  assert.equal(row('Note 3.md').style.getPropertyValue('--manual-order-row-height'),'200px');
  assert.deepEqual(ctx.options.manualRowHeights,{'Note 1.md':120,'Note 3.md':200});
});

test('file rename migrates saved height in the view configuration',async()=>{
  const ctx=setup();ctx.options.manualRowHeights={'Note 1.md':125};ctx.view.onDataUpdated();
  await ctx.view.editCell(ctx.entries[0],'file.name');editorInput(ctx).value='Renamed.md';await ctx.view.editor.save();
  assert.deepEqual(ctx.options.manualRowHeights,{'Renamed.md':125});
  assert.equal(ctx.dom.window.document.querySelector('tbody tr').style.getPropertyValue('--manual-order-row-height'),'125px');
  await ctx.plugin.undoEdit();assert.deepEqual(ctx.options.manualRowHeights,{'Note 1.md':125});
});

const listInputs=ctx=>[...ctx.dom.window.document.querySelectorAll('.manual-order-list-item-input')];
const keyOn=(ctx,input,key,extra={})=>input.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));
test('list editor gives each existing item a remove control plus an empty add row',async()=>{
  const ctx=setup([1,2,3],['note.tags']);ctx.records.get('Note 1.md').fm.tags=['one','two','three'];ctx.view.onDataUpdated();
  await ctx.view.editCell(ctx.entries[0],'note.tags');
  assert.deepEqual(listInputs(ctx).map(input=>input.value),['one','two','three','']);
  assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-list-remove:not([hidden])').length,3);
  assert.equal(ctx.dom.window.document.activeElement,listInputs(ctx)[3]);assert.equal(ctx.writes,0);ctx.view.editor.cancel();
});
test('Enter confirms a new item, adds another row, and empty Enter exits',async()=>{
  const ctx=setup([1,2,3],['note.tags']);await ctx.view.editCell(ctx.entries[0],'note.tags');
  let input=ctx.dom.window.document.activeElement;input.value='first';input.dispatchEvent(new ctx.dom.window.Event('input',{bubbles:true}));keyOn(ctx,input,'Enter');await settle(ctx);
  assert.deepEqual(ctx.records.get('Note 1.md').fm.tags,['first']);assert.ok(ctx.view.editor);
  input=ctx.dom.window.document.activeElement;assert.equal(input.value,'');input.value='second';input.dispatchEvent(new ctx.dom.window.Event('input',{bubbles:true}));keyOn(ctx,input,'Enter');await settle(ctx);
  assert.deepEqual(ctx.records.get('Note 1.md').fm.tags,['first','second']);
  input=ctx.dom.window.document.activeElement;assert.equal(input.value,'');keyOn(ctx,input,'Enter');await settle(ctx);
  assert.equal(ctx.view.editor,undefined);assert.equal(ctx.writes,2);
});
test('remove updates only the selected item and supports repeated removals',async()=>{
  const ctx=setup([1,2,3],['note.tags']);ctx.records.get('Note 1.md').fm.tags=['one','two','three'];ctx.view.onDataUpdated();await ctx.view.editCell(ctx.entries[0],'note.tags');
  ctx.dom.window.document.querySelectorAll('.manual-order-list-remove')[1].click();await settle(ctx);
  assert.deepEqual(ctx.records.get('Note 1.md').fm.tags,['one','three']);assert.ok(ctx.view.editor);
  ctx.dom.window.document.querySelectorAll('.manual-order-list-remove')[0].click();await settle(ctx);
  assert.deepEqual(ctx.records.get('Note 1.md').fm.tags,['three']);
  ctx.dom.window.document.querySelectorAll('.manual-order-list-remove')[0].click();await settle(ctx);
  assert.equal(Object.hasOwn(ctx.records.get('Note 1.md').fm,'tags'),false);assert.equal(listInputs(ctx).length,1);
  ctx.view.editor.cancel();assert.equal(ctx.records.get('Note 1.md').fm.keep,'unchanged');
});
test('editing existing items preserves duplicate items and confirmed changes survive Escape',async()=>{
  const ctx=setup([1,2,3],['note.tags']);ctx.records.get('Note 1.md').fm.tags=['duplicate','duplicate'];ctx.view.onDataUpdated();await ctx.view.editCell(ctx.entries[0],'note.tags',2,1);
  const second=listInputs(ctx)[1];assert.equal(ctx.dom.window.document.activeElement,second);assert.equal(second.selectionStart,2);
  second.value='changed';keyOn(ctx,second,'Enter');await settle(ctx);
  assert.deepEqual(ctx.records.get('Note 1.md').fm.tags,['duplicate','changed']);
  const blank=ctx.dom.window.document.activeElement;blank.value='unconfirmed';keyOn(ctx,blank,'Escape');
  assert.deepEqual(ctx.records.get('Note 1.md').fm.tags,['duplicate','changed']);assert.equal(ctx.view.editor,undefined);
});
test('pasted lines become separate items and keep their order',async()=>{
  const ctx=setup([1,2,3],['note.tags']);await ctx.view.editCell(ctx.entries[0],'note.tags');
  const input=listInputs(ctx)[0];input.value='alpha\nbeta\ngamma';input.dispatchEvent(new ctx.dom.window.Event('input',{bubbles:true}));
  assert.deepEqual(listInputs(ctx).map(input=>input.value),['alpha','beta','gamma']);
  keyOn(ctx,ctx.dom.window.document.activeElement,'Enter');await settle(ctx);
  assert.deepEqual(ctx.records.get('Note 1.md').fm.tags,['alpha','beta','gamma']);ctx.view.editor.cancel();
});
test('each list item autocompletes links before Enter confirms that item',async()=>{
  const ctx=setup([1,2,3],['note.related']);ctx.records.get('Note 1.md').fm.related=[];ctx.view.onDataUpdated();await ctx.view.editCell(ctx.entries[0],'note.related');
  const input=listInputs(ctx)[0];input.value='See [[Note 2';input.setSelectionRange(input.value.length,input.value.length);input.dispatchEvent(new ctx.dom.window.Event('input',{bubbles:true}));
  keyOn(ctx,input,'Enter');assert.equal(input.value,'See [[Note 2]]');assert.equal(ctx.writes,0);
  keyOn(ctx,input,'Enter');await settle(ctx);assert.deepEqual(ctx.records.get('Note 1.md').fm.related,['See [[Note 2]]']);
  keyOn(ctx,ctx.dom.window.document.activeElement,'Enter');await settle(ctx);
  assert.equal(cell(ctx,'Note 1.md','note.related').querySelectorAll('.internal-link').length,1);
});

test('standard and legacy caret APIs preserve source offsets after aliased links',async()=>{
  for(const api of ['standard','legacy']) {
    const ctx=setup([1,2,3],['note.related']),value='See [[Note 2|Two]] after';
    ctx.records.get('Note 1.md').fm.related=[value];ctx.view.onDataUpdated();
    const doc=ctx.dom.window.document,host=cell(ctx,'Note 1.md','note.related').querySelector('.manual-order-property-value');
    if(api==='standard') {
      doc.caretPositionFromPoint=()=>({offsetNode:host.lastChild,offset:3});
      doc.caretRangeFromPoint=()=>{throw new Error('Legacy caret API should not run when the standard API succeeds.');};
    } else {const range=doc.createRange();range.setStart(host.lastChild,3);range.collapse(true);doc.caretRangeFromPoint=()=>range;}
    host.dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,clientX:50,clientY:10}));await settle(ctx);
    assert.equal(doc.activeElement,listInputs(ctx)[0]);assert.equal(listInputs(ctx)[0].selectionStart,value.indexOf(' after')+3);ctx.view.editor.cancel();
  }
});

test('list-editor pointer reset timers are scheduled and cleared in their own window',async()=>{
  const ctx=setup([1,2,3],['note.related']);ctx.records.get('Note 1.md').fm.related=['one','two'];ctx.view.onDataUpdated();await ctx.view.editCell(ctx.entries[0],'note.related');
  const win=ctx.dom.window,set=win.setTimeout.bind(win),clear=win.clearTimeout.bind(win);let scheduled=0,cleared=0;
  win.setTimeout=(...args)=>{scheduled++;return set(...args);};win.clearTimeout=id=>{cleared++;clear(id);};
  const input=listInputs(ctx)[0];for(let i=0;i<2;i++)input.dispatchEvent(new win.MouseEvent('pointerdown',{bubbles:true}));
  assert.equal(scheduled,2);assert.equal(cleared,1);ctx.view.editor.cancel();assert.equal(cleared,2);
});

test('list removal refuses a conflicting note edit and retains the draft for recovery',async()=>{
  const ctx=setup([1,2,3],['note.tags']);ctx.records.get('Note 1.md').fm.tags=['one','two'];ctx.view.onDataUpdated();await ctx.view.editCell(ctx.entries[0],'note.tags');
  ctx.records.get('Note 1.md').fm.tags=['external'];
  ctx.dom.window.document.querySelectorAll('.manual-order-list-remove')[1].click();await settle(ctx);
  assert.deepEqual(ctx.records.get('Note 1.md').fm.tags,['external']);assert.ok(ctx.view.editor);
  assert.equal(ctx.dom.window.document.querySelector('.manual-order-editor-error').hidden,false);
  assert.match(ctx.dom.window.document.querySelector('.manual-order-editor-error').textContent,/changed elsewhere/);ctx.view.editor.cancel();
});

test('adding an item preserves untouched numeric, boolean, null, and empty list values',async()=>{
  const ctx=setup([1,2,3],['note.related']);ctx.plugin.propertyTypes.set('related','list');
  ctx.records.get('Note 1.md').fm.related=[0,false,null,''];ctx.view.onDataUpdated();await ctx.view.editCell(ctx.entries[0],'note.related');
  const input=ctx.dom.window.document.activeElement;input.value='added';keyOn(ctx,input,'Enter');await settle(ctx);
  assert.deepEqual(ctx.records.get('Note 1.md').fm.related,[0,false,null,'','added']);ctx.view.editor.cancel();
});

function dataTransfer() {
  const values=new Map();return {get types(){return [...values.keys()];},setData:(key,value)=>values.set(key,value),getData:key=>values.get(key)??'',setDragImage(){},effectAllowed:'uninitialized',dropEffect:'none'};
}
function dragEvent(ctx,target,type,data) {
  const event=new ctx.dom.window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:data});target.dispatchEvent(event);return event;
}
function linkDragFixture(sourceType='text',targetType='text') {
  const ctx=setup([1,2,3],['file.name','note.source','note.target','note.priority']);
  ctx.plugin.propertyTypes.set('source',sourceType);ctx.plugin.propertyTypes.set('target',targetType);
  ctx.records.get('Note 1.md').fm.source=sourceType==='list'?['Before [[Note 3|Third]] after']: 'Before [[Note 3|Third]] after';
  ctx.records.get('Note 2.md').fm.target=targetType==='list'?['existing item']:'existing text';ctx.view.onDataUpdated();return ctx;
}
test('note links copy between every Text/List combination, retaining the source and alias',async()=>{
  for(const sourceType of ['text','list'])for(const targetType of ['text','list']) {
    const ctx=linkDragFixture(sourceType,targetType),before=structuredClone(ctx.records.get('Note 1.md').fm);
    const data=dataTransfer(),source=cell(ctx,'Note 1.md','note.source').querySelector('.internal-link');
    assert.equal(source.draggable,true);dragEvent(ctx,source,'dragstart',data);assert.equal(data.effectAllowed,'copy');
    const target=cell(ctx,'Note 2.md','note.target');assert.equal(dragEvent(ctx,target,'dragover',data).defaultPrevented,true);
    assert.equal(data.dropEffect,'copy');assert.ok(target.classList.contains('manual-order-link-drop-target'));
    dragEvent(ctx,target,'drop',data);await settle(ctx);
    assert.deepEqual(ctx.records.get('Note 1.md').fm,before);
    assert.deepEqual(ctx.records.get('Note 2.md').fm.target,targetType==='list'?['existing item','[[Note 3|Third]]']:'existing text [[Note 3|Third]]');
    assert.equal(ctx.records.get('Note 2.md').fm.priority,2);assert.equal(ctx.writes,1);
    await ctx.plugin.undoEdit();assert.deepEqual(ctx.records.get('Note 2.md').fm.target,targetType==='list'?['existing item']:'existing text');
  }
});
test('dropping a link into an active Text editor preserves and saves its draft',async()=>{
  const ctx=linkDragFixture();await ctx.view.editCell(ctx.entries[1],'note.target');editorInput(ctx).value='pending text';
  const data=dataTransfer();dragEvent(ctx,cell(ctx,'Note 1.md','note.source').querySelector('.internal-link'),'dragstart',data);
  dragEvent(ctx,cell(ctx,'Note 2.md','note.target'),'drop',data);await settle(ctx);
  assert.equal(ctx.records.get('Note 2.md').fm.target,'pending text [[Note 3|Third]]');assert.equal(ctx.view.editor,undefined);
});
test('dropping into an active List editor adds an item and retains unconfirmed items',async()=>{
  const ctx=linkDragFixture('text','list');await ctx.view.editCell(ctx.entries[1],'note.target');
  const input=ctx.dom.window.document.activeElement;input.value='pending item';
  const data=dataTransfer();dragEvent(ctx,cell(ctx,'Note 1.md','note.source').querySelector('.internal-link'),'dragstart',data);
  dragEvent(ctx,cell(ctx,'Note 2.md','note.target'),'drop',data);await settle(ctx);
  assert.deepEqual(ctx.records.get('Note 2.md').fm.target,['existing item','pending item','[[Note 3|Third]]']);
  assert.ok(ctx.view.editor);ctx.view.editor.cancel();
});
test('a selected wikilink can be dragged out of an editor without removing source text',async()=>{
  const ctx=linkDragFixture();await ctx.view.editCell(ctx.entries[0],'note.source');const input=editorInput(ctx);
  const text='Unconfirmed [[Note 3]] retained';input.value=text;input.setSelectionRange(text.indexOf('[['),text.indexOf(']]')+2);
  const data=dataTransfer();dragEvent(ctx,input,'dragstart',data);assert.equal(data.effectAllowed,'copy');
  dragEvent(ctx,cell(ctx,'Note 2.md','note.target'),'drop',data);await settle(ctx);
  assert.equal(ctx.records.get('Note 1.md').fm.source,text);assert.equal(ctx.records.get('Note 2.md').fm.target,'existing text [[Note 3]]');
});
test('link drops never edit rank, file, or formula cells and malformed payloads are rejected',async()=>{
  const ctx=linkDragFixture(),data=dataTransfer();dragEvent(ctx,cell(ctx,'Note 1.md','note.source').querySelector('.internal-link'),'dragstart',data);
  for(const property of ['note.priority','file.name']) {
    const target=cell(ctx,'Note 2.md',property);assert.equal(dragEvent(ctx,target,'dragover',data).defaultPrevented,false);
    dragEvent(ctx,target,'drop',data);await settle(ctx);
  }
  ctx.plugin.propertyTypes.set('done','checkbox');ctx.records.get('Note 2.md').fm.done=false;
  ctx.view.config.getOrder=()=>['note.source','note.target','formula.calculated','file.path','note.done'];ctx.view.onDataUpdated();
  for(const property of ['formula.calculated','file.path','note.done']) {
    const target=cell(ctx,'Note 2.md',property);assert.equal(dragEvent(ctx,target,'dragover',data).defaultPrevented,false);dragEvent(ctx,target,'drop',data);await settle(ctx);
  }
  const bad=dataTransfer();bad.setData('application/x-manual-order-bases-link','{"version":1,"link":"plain text"}');
  dragEvent(ctx,cell(ctx,'Note 2.md','note.target'),'drop',bad);await settle(ctx);
  assert.equal(ctx.writes,0);assert.equal(ctx.records.get('Note 2.md').fm.priority,2);
  assert.equal(ctx.records.get('Note 2.md').fm.target,'existing text');
});
test('same-cell drop adds a copy instead of moving or deleting the original link',async()=>{
  const ctx=linkDragFixture(),target=cell(ctx,'Note 1.md','note.source'),data=dataTransfer();
  dragEvent(ctx,target.querySelector('.internal-link'),'dragstart',data);dragEvent(ctx,target,'drop',data);await settle(ctx);
  assert.equal(ctx.records.get('Note 1.md').fm.source,'Before [[Note 3|Third]] after [[Note 3|Third]]');
});

test('a conflicting destination edit is never overwritten by a link drop',async()=>{
  const ctx=linkDragFixture(),data=dataTransfer();dragEvent(ctx,cell(ctx,'Note 1.md','note.source').querySelector('.internal-link'),'dragstart',data);
  const process=ctx.app.fileManager.processFrontMatter;
  ctx.app.fileManager.processFrontMatter=async(file,callback)=>{ctx.records.get(file.path).fm.target='external edit';return process(file,callback);};
  dragEvent(ctx,cell(ctx,'Note 2.md','note.target'),'drop',data);await settle(ctx);
  assert.equal(ctx.records.get('Note 2.md').fm.target,'external edit');assert.equal(ctx.plugin.editHistory.length,0);
  assert.match(globalThis.notices.at(-1),/changed elsewhere/);
});

function selectCells(ctx,startPath,startProperty,endPath,endProperty) {
  const start=cell(ctx,startPath,startProperty),end=cell(ctx,endPath,endProperty);start.focus();ctx.view.selection.selectCell(start);
  for(const type of ['pointerdown','pointerup']) {
    const event=new ctx.dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,shiftKey:true});
    Object.defineProperty(event,'pointerId',{value:1});Object.defineProperty(event,'pointerType',{value:'mouse'});end.dispatchEvent(event);
  }
}
async function pasteCells(ctx,text,target=ctx.dom.window.document.activeElement) {
  const event=new ctx.dom.window.Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{types:['text/plain'],getData:type=>type==='text/plain'?text:''}});
  target.dispatchEvent(event);await settle(ctx);return event;
}

function copyCells(ctx,target=ctx.dom.window.document.activeElement) {
  const event=new ctx.dom.window.Event('copy',{bubbles:true,cancelable:true}),data=new Map();
  Object.defineProperty(event,'clipboardData',{value:{setData:(type,value)=>data.set(type,value)}});
  target.dispatchEvent(event);return {event,text:data.get('text/plain')};
}

test('copy includes every hidden list item and original wiki syntax without saving or expanding rows',()=>{
  const ctx=setup([1,2,3],['note.items']);ctx.plugin.propertyTypes.set('items','list');
  const items=Array.from({length:20},(_,i)=>i===0?'[[Note 2|Alias]]':`item ${i}`);
  ctx.records.get('Note 1.md').fm.items=items;ctx.view.onDataUpdated();
  selectCells(ctx,'Note 1.md','note.items','Note 1.md','note.items');
  const result=copyCells(ctx);assert.equal(result.event.defaultPrevented,true);
  assert.equal(result.text,`"${items.join('\n')}"`);assert.equal(ctx.writes,0);assert.equal(ctx.options.manualRowHeights,undefined);
});

test('copy range preserves row/column order, empty cells, false, zero, filenames and formulas',()=>{
  const ctx=setup([1,2,3],['file.name','note.keep','formula.calculated']);
  ctx.records.get('Note 1.md').fm.keep=false;ctx.records.get('Note 2.md').fm.keep=0;
  ctx.entries[0].getValue=id=>id==='formula.calculated'?{toString:()=> 'computed',renderTo:el=>{el.textContent='computed';}}:null;
  ctx.view.onDataUpdated();selectCells(ctx,'Note 2.md','formula.calculated','Note 1.md','file.name');
  assert.equal(copyCells(ctx).text,'Note 1.md\tfalse\tcomputed\nNote 2.md\t0\t');assert.equal(ctx.writes,0);
});

test('copy at an editor caret includes the full current draft but highlighted text stays native',async()=>{
  const ctx=setup([1,2,3],['note.keep']);cell(ctx,'Note 1.md','note.keep').click();await settle(ctx);
  const input=editorInput(ctx);input.value='draft [[Note 2|Alias]]';input.setSelectionRange(3,3);
  assert.equal(copyCells(ctx,input).text,input.value);assert.equal(ctx.writes,0);
  input.setSelectionRange(0,5);assert.equal(copyCells(ctx,input).event.defaultPrevented,false);ctx.view.editor.cancel();
});

test('copy in a list editor includes all existing items and the unsaved new item',async()=>{
  const ctx=setup([1,2,3],['note.items']);ctx.plugin.propertyTypes.set('items','list');ctx.records.get('Note 1.md').fm.items=['one','[[Note 2]]'];ctx.view.onDataUpdated();
  cell(ctx,'Note 1.md','note.items').click();await settle(ctx);
  const inputs=listInputs(ctx),input=inputs.at(-1);input.value='new item';input.setSelectionRange(8,8);
  assert.equal(copyCells(ctx,input).text,'"one\n[[Note 2]]\nnew item"');assert.equal(ctx.writes,0);ctx.view.editor.cancel();
});

test('copy outside a selected cell is left to Obsidian',()=>{
  const ctx=setup();assert.equal(copyCells(ctx,ctx.dom.window.document.querySelector('.manual-order-bases')).event.defaultPrevented,false);
});
test('matrix paste overwrites selected cells, writes once per note, and undoes as one operation',async()=>{
  const ctx=setup([1,2,3],['note.keep','note.score']);ctx.plugin.propertyTypes.set('score','number');
  for(let i=1;i<=3;i++)ctx.records.get(`Note ${i}.md`).fm.score=i;ctx.view.onDataUpdated();
  selectCells(ctx,'Note 1.md','note.keep','Note 2.md','note.score');
  assert.equal((await pasteCells(ctx,'A\t10\nB\t20')).defaultPrevented,true);
  assert.deepEqual([ctx.records.get('Note 1.md').fm.keep,ctx.records.get('Note 1.md').fm.score],['A',10]);
  assert.deepEqual([ctx.records.get('Note 2.md').fm.keep,ctx.records.get('Note 2.md').fm.score],['B',20]);
  assert.equal(ctx.records.get('Note 3.md').fm.keep,'unchanged');assert.equal(ctx.writes,2);assert.equal(ctx.plugin.editHistory.length,1);
  assert.equal(ctx.dom.window.document.querySelectorAll('[aria-selected=true]').length,4);
  await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.keep,'unchanged');assert.equal(ctx.records.get('Note 2.md').fm.score,2);assert.equal(ctx.plugin.editHistory.length,0);
});
test('one clipboard value fills every selected cell and empty values clear properties',async()=>{
  const ctx=setup([1,2,3],['note.keep']);selectCells(ctx,'Note 1.md','note.keep','Note 3.md','note.keep');await pasteCells(ctx,'replacement');
  for(const record of ctx.records.values())assert.equal(record.fm.keep,'replacement');
  await pasteCells(ctx,'');for(const record of ctx.records.values())assert.equal(Object.hasOwn(record.fm,'keep'),false);
  await ctx.plugin.undoEdit();for(const record of ctx.records.values())assert.equal(record.fm.keep,'replacement');
});
test('pasting converts declared list, checkbox, and date types and preserves text literals',async()=>{
  const ctx=setup([1,2,3],['note.done','note.when','note.tags','note.keep']);
  ctx.plugin.propertyTypes.set('done','checkbox');ctx.plugin.propertyTypes.set('when','date');ctx.view.onDataUpdated();
  selectCells(ctx,'Note 1.md','note.done','Note 2.md','note.keep');
  await pasteCells(ctx,'TRUE\t2026-11-01\t[one, two]\t001\nfalse\t2026-11-02\t"[[Note 3]]\nsecond item"\tfalse');
  assert.equal(ctx.records.get('Note 1.md').fm.done,true);assert.equal(ctx.records.get('Note 2.md').fm.done,false);
  assert.equal(ctx.records.get('Note 1.md').fm.when,'2026-11-01');assert.deepEqual(ctx.records.get('Note 2.md').fm.tags,['[[Note 3]]','second item']);
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'001');assert.equal(ctx.records.get('Note 2.md').fm.keep,'false');
  assert.equal(cell(ctx,'Note 2.md','note.tags').querySelectorAll('.internal-link').length,1);
});
test('invalid values, mismatched shapes, and read-only columns abort before any write',async()=>{
  const ctx=setup([1,2,3],['note.keep','note.priority','formula.calculated']);const original=structuredClone([...ctx.records.values()].map(r=>r.fm));
  selectCells(ctx,'Note 1.md','note.keep','Note 2.md','note.priority');await pasteCells(ctx,'A\t4\nB\tinvalid');assert.equal(ctx.writes,0);
  await pasteCells(ctx,'a\tb\tc');assert.equal(ctx.writes,0);
  selectCells(ctx,'Note 1.md','note.priority','Note 2.md','formula.calculated');await pasteCells(ctx,'4');assert.equal(ctx.writes,0);
  assert.deepEqual([...ctx.records.values()].map(r=>r.fm),original);
});
test('a later write failure rolls back all earlier pasted notes',async()=>{
  const ctx=setup([1,2,3],['note.keep']);const original=structuredClone([...ctx.records.values()].map(r=>r.fm));
  const process=ctx.app.fileManager.processFrontMatter;ctx.app.fileManager.processFrontMatter=async(file,callback)=>{if(file.path==='Note 2.md')throw new Error('disk failure');return process(file,callback);};
  selectCells(ctx,'Note 1.md','note.keep','Note 3.md','note.keep');await pasteCells(ctx,'replacement');
  assert.deepEqual([...ctx.records.values()].map(r=>r.fm),original);assert.equal(ctx.plugin.editHistory.length,0);assert.match(globalThis.notices.at(-1),/disk failure/);
});
test('a conflicting edit during rollback is preserved and the affected cell is reported',async()=>{
  const ctx=setup([1,2,3],['note.keep']),process=ctx.app.fileManager.processFrontMatter;
  ctx.app.fileManager.processFrontMatter=async(file,callback)=>{if(file.path==='Note 2.md'){ctx.records.get('Note 1.md').fm.keep='external';throw new Error('disk failure');}return process(file,callback);};
  selectCells(ctx,'Note 1.md','note.keep','Note 2.md','note.keep');await pasteCells(ctx,'replacement');
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'external');assert.match(globalThis.notices.at(-1),/could not be restored/);assert.equal(ctx.plugin.editHistory.length,0);
});
test('filename and property paste supports one-operation undo and keeps row heights attached',async()=>{
  const ctx=setup([1,2,3],['file.name','note.keep']);ctx.options.manualRowHeights={'Note 1.md':120};ctx.view.onDataUpdated();
  selectCells(ctx,'Note 1.md','file.name','Note 2.md','note.keep');await pasteCells(ctx,'Renamed 1\tA\nRenamed 2\tB');
  assert.equal(ctx.records.get('Renamed 1.md').fm.keep,'A');assert.equal(ctx.records.get('Renamed 2.md').fm.keep,'B');
  assert.deepEqual(ctx.options.manualRowHeights,{'Renamed 1.md':120});assert.equal(ctx.plugin.editHistory.length,1);
  assert.equal(ctx.dom.window.document.querySelectorAll('[aria-selected=true]').length,4);
  await ctx.plugin.undoEdit();assert.ok(ctx.records.has('Note 1.md'));assert.ok(ctx.records.has('Note 2.md'));assert.equal(ctx.records.get('Note 1.md').fm.keep,'unchanged');
  assert.deepEqual(ctx.options.manualRowHeights,{'Note 1.md':120});assert.equal(ctx.plugin.editHistory.length,0);
});
test('duplicate or occupied filenames reject the entire paste without modifying properties',async()=>{
  const ctx=setup([1,2,3],['file.name','note.keep']);selectCells(ctx,'Note 1.md','file.name','Note 2.md','note.keep');
  await pasteCells(ctx,'Same\tA\nSame\tB');assert.equal(ctx.writes,0);
  await pasteCells(ctx,'Note 3\tA\nOther\tB');assert.equal(ctx.writes,0);
  assert.equal(ctx.records.get('Note 1.md').fm.keep,'unchanged');
});
test('paste in a single active cell replaces its full value and supports undo',async()=>{
  const ctx=setup();await ctx.view.editCell(ctx.entries[0],'note.priority');const input=editorInput(ctx);
  assert.equal((await pasteCells(ctx,'17',input)).defaultPrevented,true);assert.equal(ctx.records.get('Note 1.md').fm.priority,17);
  await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.priority,1);
});

test('single list cell receives all clipboard rows as replacement items',async()=>{
  const ctx=setup([1,2,3],['note.items']);ctx.plugin.propertyTypes.set('items','list');ctx.records.get('Note 1.md').fm.items=['old'];ctx.view.onDataUpdated();
  selectCells(ctx,'Note 1.md','note.items','Note 1.md','note.items');await pasteCells(ctx,'one\n[[Note 2]]\nthree');
  assert.deepEqual(ctx.records.get('Note 1.md').fm.items,['one','[[Note 2]]','three']);
});

test('undo refuses a later conflicting cell edit and leaves the rest of the paste intact',async()=>{
  const ctx=setup([1,2,3],['note.keep']);selectCells(ctx,'Note 1.md','note.keep','Note 2.md','note.keep');await pasteCells(ctx,'pasted');
  ctx.records.get('Note 2.md').fm.keep='external';const writes=ctx.writes;await ctx.plugin.undoEdit();
  assert.equal(ctx.writes,writes);assert.equal(ctx.records.get('Note 1.md').fm.keep,'pasted');assert.equal(ctx.records.get('Note 2.md').fm.keep,'external');assert.equal(ctx.plugin.editHistory.length,1);
});

test('a stale paste is rejected in preflight before touching any selected note',async()=>{
  const ctx=setup([1,2,3],['note.keep']),read=ctx.app.vault.read;let calls=0;
  ctx.app.vault.read=async file=>{if(++calls===3)ctx.records.get('Note 2.md').fm.keep='external';return read(file);};
  selectCells(ctx,'Note 1.md','note.keep','Note 2.md','note.keep');await pasteCells(ctx,'pasted');
  assert.equal(ctx.writes,0);assert.equal(ctx.records.get('Note 1.md').fm.keep,'unchanged');assert.equal(ctx.records.get('Note 2.md').fm.keep,'external');
});

test('empty paste and undo preserve the difference between null, false and a missing key',async()=>{
  const ctx=setup([1,2,3],['note.keep']);ctx.records.get('Note 1.md').fm.keep=null;ctx.records.get('Note 2.md').fm.keep=false;ctx.view.onDataUpdated();
  selectCells(ctx,'Note 1.md','note.keep','Note 2.md','note.keep');await pasteCells(ctx,'');await ctx.plugin.undoEdit();
  assert.equal(ctx.records.get('Note 1.md').fm.keep,null);assert.equal(ctx.records.get('Note 2.md').fm.keep,false);
});

test('repeated clicks in an open list cell retain the editor until focus leaves the cell',async()=>{
  const ctx=setup([1,2,3],['note.items']);ctx.plugin.propertyTypes.set('items','list');ctx.records.get('Note 1.md').fm.items=['[[Note 2]]','two'];ctx.view.onDataUpdated();
  const target=cell(ctx,'Note 1.md','note.items');target.click();await settle(ctx);const editor=ctx.view.editor;
  target.focus();await settle(ctx);target.click();await settle(ctx);assert.equal(ctx.view.editor,editor);
  const inputs=listInputs(ctx);inputs[0].focus();inputs[0].setSelectionRange(2,2);inputs[0].click();await settle(ctx);
  assert.equal(ctx.view.editor,editor);assert.equal(inputs[0].selectionStart,2);
  cell(ctx,'Note 2.md','note.items').focus();await settle(ctx);assert.equal(ctx.view.editor,undefined);
});

test('clicking non-focusable space outside a list cell saves and closes its editor',async()=>{
  const ctx=setup([1,2,3],['note.items']);ctx.plugin.propertyTypes.set('items','list');ctx.records.get('Note 1.md').fm.items=['one'];ctx.view.onDataUpdated();
  cell(ctx,'Note 1.md','note.items').click();await settle(ctx);const input=listInputs(ctx)[0];input.value='changed';
  ctx.dom.window.document.body.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true}));await settle(ctx);
  assert.equal(ctx.view.editor,undefined);assert.deepEqual(ctx.records.get('Note 1.md').fm.items,['changed']);
});

test('host focus loss during a click inside the list does not close its editor',async()=>{
  const ctx=setup([1,2,3],['note.items']);ctx.plugin.propertyTypes.set('items','list');ctx.records.get('Note 1.md').fm.items=['one'];ctx.view.onDataUpdated();
  cell(ctx,'Note 1.md','note.items').click();await settle(ctx);const editor=ctx.view.editor,input=listInputs(ctx)[0];
  input.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true}));
  input.dispatchEvent(new ctx.dom.window.FocusEvent('focusout',{bubbles:true,relatedTarget:ctx.dom.window.document.body}));
  await settle(ctx);assert.equal(ctx.view.editor,editor);
  input.dispatchEvent(new ctx.dom.window.FocusEvent('focusout',{bubbles:true,relatedTarget:null}));await settle(ctx);assert.equal(ctx.view.editor,editor);
  ctx.dom.window.document.body.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true}));await settle(ctx);assert.equal(ctx.view.editor,undefined);
});

test('list item shift ranges, toggles, keyboard selection and copy leave values unchanged',async()=>{
  const ctx=setup([1,2,3],['note.items']);ctx.plugin.propertyTypes.set('items','list');ctx.records.get('Note 1.md').fm.items=['one','[[Note 2]]','three','four'];ctx.view.onDataUpdated();
  cell(ctx,'Note 1.md','note.items').click();await settle(ctx);const inputs=listInputs(ctx),editor=ctx.view.editor;
  const down=(target,options={})=>target.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:0,...options}));
  down(inputs[0]);down(inputs[2],{shiftKey:true});assert.equal(editor.copyText(),'one\n[[Note 2]]\nthree');
  const bullets=[...ctx.dom.window.document.querySelectorAll('.manual-order-list-edit-bullet')];down(bullets[1],{ctrlKey:true});assert.equal(editor.copyText(),'one\nthree');
  inputs[1].dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'a',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(editor.copyText(),'one\n[[Note 2]]\nthree\nfour');
  inputs[1].dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(editor.hasItemSelection(),false);assert.equal(ctx.view.editor,editor);assert.equal(ctx.writes,0);editor.cancel();
});

test('dragging across list item rows selects entries while dragging inside one input stays native',async()=>{
  const ctx=setup([1,2,3],['note.items']);ctx.plugin.propertyTypes.set('items','list');ctx.records.get('Note 1.md').fm.items=['one','two','three'];ctx.view.onDataUpdated();cell(ctx,'Note 1.md','note.items').click();await settle(ctx);
  const inputs=listInputs(ctx),rows=[...ctx.dom.window.document.querySelectorAll('.manual-order-list-edit-item')];rows.forEach((row,i)=>row.getBoundingClientRect=()=>({top:i*24,bottom:(i+1)*24}));
  inputs[0].dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true,button:0,clientX:10,clientY:10}));
  ctx.dom.window.document.dispatchEvent(new ctx.dom.window.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:40,clientY:12}));assert.equal(ctx.view.editor.hasItemSelection(),false);
  ctx.dom.window.document.dispatchEvent(new ctx.dom.window.MouseEvent('pointermove',{bubbles:true,cancelable:true,clientX:40,clientY:60}));assert.equal(ctx.view.editor.copyText(),'one\ntwo\nthree');
  ctx.dom.window.document.dispatchEvent(new ctx.dom.window.MouseEvent('pointerup',{bubbles:true}));ctx.view.editor.cancel();
});

test('nested group headers collapse, persist across reopen and restore without writing notes',async()=>{
  const ctx=setup([1,2,3],['file.name','note.priority']);
  ctx.records.get('Note 1.md').fm.team='A';ctx.records.get('Note 2.md').fm.team='A';ctx.records.get('Note 3.md').fm.team='B';
  ctx.records.get('Note 1.md').fm.status='Ready';ctx.records.get('Note 2.md').fm.status='Waiting';ctx.records.get('Note 3.md').fm.status='Ready';
  ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.status',direction:'asc'}];ctx.view.onDataUpdated();
  const headers=()=>[...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')];
  assert.equal(headers().length,5);assert.match(headers()[0].textContent,/note.team: A/);
  selectCells(ctx,'Note 1.md','note.priority','Note 1.md','note.priority');headers()[0].click();await settle(ctx);
  assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,1);assert.equal(ctx.view.selection.getRange().length,0);assert.equal(ctx.options.manualCollapsedGroups.length,1);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();
  assert.equal(headers()[0].getAttribute('aria-expanded'),'false');assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,1);
  headers()[0].click();await settle(ctx);assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,3);assert.equal(ctx.options.manualCollapsedGroups,undefined);assert.equal(ctx.writes,0);
});

test('Groups menu adds, orders, changes and removes nested grouping levels',async()=>{
  const ctx=setup([1,2,3],['file.name','note.keep','note.priority']);
  const button=(text)=>[...ctx.dom.window.document.querySelectorAll('button')].find(button=>button.textContent===text);
  button('Groups').click();await settle(ctx);
  const choose=(selector,value)=>{const select=ctx.dom.window.document.querySelector(selector);select.value=value;select.dispatchEvent(new ctx.dom.window.Event('change',{bubbles:true}));};
  choose('[aria-label="New grouping property"]','note.keep');button('Add group by').click();await settle(ctx);
  choose('[aria-label="New grouping property"]','note.priority');button('Add group by').click();await settle(ctx);
  assert.deepEqual(ctx.options.manualGroups.map(rule=>rule.property),['note.keep','note.priority']);
  ctx.dom.window.document.querySelector('[aria-label="Move group level 2 up"]').click();await settle(ctx);
  assert.equal(ctx.options.manualGroups[0].property,'note.priority');
  choose('[aria-label="Group level 1 direction"]','desc');await settle(ctx);assert.equal(ctx.options.manualGroups[0].direction,'desc');
  ctx.dom.window.document.querySelector('[aria-label="Remove group level 2"]').click();await settle(ctx);assert.equal(ctx.options.manualGroups.length,1);
  ctx.dom.window.document.querySelector('[aria-label="Remove group level 1"]').click();await settle(ctx);assert.equal(ctx.options.manualGroups,undefined);assert.equal(ctx.writes,0);
});

test('native Bases groups stay outermost with collapsible nested groups including empty keys',async()=>{
  const ctx=setup();ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,2),key:{toString:()=> 'Native A',renderTo:el=>{el.textContent='Native A';}},hasKey:()=>true},{entries:ctx.entries.slice(2),hasKey:()=>false}];
  ctx.options.manualGroups=[{property:'note.keep',direction:'asc'}];ctx.view.onDataUpdated();
  const headers=[...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')];
  assert.match(headers[0].textContent,/Native A/);assert.match(headers[2].textContent,/No value/);assert.equal(headers.length,4);
  headers[0].click();await settle(ctx);assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,1);assert.equal(ctx.writes,0);
});

test('row reorder is scoped to the innermost group and grouping edits move notes between groups',async()=>{
  const ctx=setup([1,2,3],['file.name','note.keep','note.priority']);ctx.records.get('Note 3.md').fm.keep='Other';ctx.options.manualGroups=[{property:'note.keep',direction:'asc'}];ctx.view.onDataUpdated();
  const leaf=ctx.view.groups.findIndex(rows=>rows.length===2);await ctx.view.move('Note 2.md','Note 1.md',false,leaf);
  assert.equal(ctx.records.get('Note 2.md').fm.priority,0);assert.equal(ctx.records.get('Note 1.md').fm.priority,1);assert.equal(ctx.records.get('Note 3.md').fm.priority,3);
  cell(ctx,'Note 1.md','note.keep').click();await settle(ctx);const input=editorInput(ctx);input.value='Other';await ctx.view.editor.save();await settle(ctx);
  assert.equal(ctx.view.groups.find(rows=>rows.some(row=>row.path==='Note 3.md')).length,2);
});

test('group header links display aliases and use native opening, hover and context behavior without toggling',async()=>{
  const ctx=setup();ctx.records.get('Note 1.md').fm.team='[[Note 2#Heading|Project alias]]';ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.view.onDataUpdated();
  const link=ctx.dom.window.document.querySelector('.manual-order-group-header .internal-link'),header=link.closest('.manual-order-group-header');assert.equal(link.textContent,'Project alias');
  link.click();assert.deepEqual(ctx.opened.at(-1),['Note 2#Heading','Note 1.md',false]);assert.equal(header.getAttribute('aria-expanded'),'true');
  link.dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));assert.equal(ctx.opened.at(-1)[2],true);
  link.dispatchEvent(new ctx.dom.window.MouseEvent('auxclick',{bubbles:true,cancelable:true,button:1}));assert.equal(ctx.opened.at(-1)[2],'tab');
  link.dispatchEvent(new ctx.dom.window.MouseEvent('mouseover',{bubbles:true}));assert.equal(ctx.hovered.at(-1)[0],'hover-link');
  link.dispatchEvent(new ctx.dom.window.MouseEvent('contextmenu',{bubbles:true,cancelable:true}));assert.equal(ctx.contextMenus.at(-1)[1],'Note 2#Heading');
  link.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(header.getAttribute('aria-expanded'),'true');assert.equal(ctx.writes,0);
  header.click();await settle(ctx);assert.equal(ctx.options.manualCollapsedGroups.length,1);
});

test('nested list-valued and native group headers render every aliased link',()=>{
  const ctx=setup();ctx.records.get('Note 1.md').fm.team=['[[Note 2|Second]]','plain','[[Note 3|Third]]'];ctx.options.manualGroups=[{property:'note.keep',direction:'asc'},{property:'note.team',direction:'asc'}];ctx.view.onDataUpdated();
  assert.deepEqual([...ctx.dom.window.document.querySelectorAll('.manual-order-group-header .internal-link')].map(link=>link.textContent),['Second','Third']);
  ctx.options.manualGroups=[];ctx.view.data.groupedData=[{entries:ctx.entries,key:{toString:()=> '[[Note 3|Native alias]]'},hasKey:()=>true}];ctx.view.onDataUpdated();
  const link=ctx.dom.window.document.querySelector('.manual-order-group-header .internal-link');assert.equal(link.textContent,'Native alias');link.click();assert.equal(ctx.opened.at(-1)[0],'Note 3');
});

test('evaluated native link values retain their renderer instead of losing aliases to toString',()=>{
  const ctx=setup();let rendered=0;ctx.view.data.groupedData=[{entries:ctx.entries,key:{toString:()=> 'Note 2',renderTo:el=>{rendered++;el.createEl('a',{cls:'internal-link',text:'Rendered alias',attr:{href:'Note 2'}});}},hasKey:()=>true}];ctx.view.onDataUpdated();
  const link=ctx.dom.window.document.querySelector('.manual-order-group-header .internal-link');assert.equal(link.textContent,'Rendered alias');assert.equal(rendered,1);link.click();assert.equal(ctx.options.manualCollapsedGroups,undefined);
});

function nativeGroupingFixture(ctx) {
  const {config,data}=ctx.view;ctx.view.unload();
  const doc=ctx.dom.window.document,mount=doc.getElementById('view');
  const header=mount.createDiv({cls:'bases-header'}),item=header.createDiv({cls:'bases-toolbar-group-menu'}),button=item.createEl('button',{text:'Group'});
  const content=mount.createDiv({cls:'bases-view'});
  ctx.view=new ManualOrderView({app:ctx.app},content,ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();
  button.onclick=()=>{
    const previous=doc.querySelector('.menu.bases-toolbar-group-menu');if(previous){previous.remove();return;}
    const menu=doc.body.createDiv({cls:'menu bases-toolbar-menu bases-toolbar-group-menu'}),page=menu.createDiv({cls:'bases-group-page'});
    page.createDiv({cls:'bases-groupby-container',text:'Native Group by property'});
  };
  return {button,doc};
}

test('native Group popup exposes nested properties, saves them and retains the native first row',async()=>{
  const ctx=setup([1,2,3],['note.keep','note.priority']);ctx.options.manualGroups=[{property:'note.keep',direction:'asc'}];
  const {button,doc}=nativeGroupingFixture(ctx);
  assert.equal([...doc.querySelectorAll('.manual-order-toolbar button')].some(button=>button.textContent.startsWith('Groups')),false);
  button.click();await settle(ctx);
  assert.equal(doc.querySelectorAll('.manual-order-native-groups').length,1);assert.equal(doc.querySelector('.bases-groupby-container').textContent,'Native Group by property');
  assert.equal(doc.querySelector('[aria-label="Group level 1 property"]').value,'note.keep');
  const select=doc.querySelector('[aria-label="New grouping property"]');select.value='note.priority';
  [...doc.querySelectorAll('.manual-order-native-groups button')].find(button=>button.textContent==='Add group by').click();await settle(ctx);
  assert.deepEqual(ctx.options.manualGroups.map(rule=>rule.property),['note.keep','note.priority']);assert.equal(doc.querySelectorAll('.manual-order-native-groups').length,1);
  assert.equal(doc.querySelectorAll('.manual-order-group-header').length,4);
  button.click();await settle(ctx);assert.equal(doc.querySelector('.manual-order-native-groups'),null);
  button.click();await settle(ctx);assert.equal(doc.querySelectorAll('.manual-order-native-groups').length,1);assert.equal(doc.querySelector('[aria-label="Group level 2 property"]').value,'note.priority');
  ctx.view.unload();assert.equal(doc.querySelector('.manual-order-native-groups'),null);assert.equal(ctx.writes,0);
});

test('native menu bridge ignores unrelated menu buttons and follows a refreshed Group page',async()=>{
  const ctx=setup();const {button,doc}=nativeGroupingFixture(ctx);
  const other=doc.body.createEl('button',{text:'Other'});other.click();await settle(ctx);assert.equal(doc.querySelector('.manual-order-native-groups'),null);
  button.click();await settle(ctx);
  const menu=doc.querySelector('.menu.bases-toolbar-group-menu');menu.querySelector('.bases-group-page').remove();menu.createDiv({cls:'bases-group-page'});await settle(ctx);
  assert.equal(menu.querySelectorAll('.manual-order-native-groups').length,1);
  ctx.view.unload();button.click();button.click();await settle(ctx);assert.equal(doc.querySelector('.manual-order-native-groups'),null);
});

function groupedMoveFixture() {
  const ctx=setup([1,2,3,4],['file.name','note.team','note.stage','note.priority']);
  for(let i=1;i<=4;i++){const fm=ctx.records.get(`Note ${i}.md`).fm;fm.team=i<3?'A':'B';fm.stage=i===4?'Waiting':'Ready';}
  ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc'}];ctx.view.onDataUpdated();return ctx;
}
function groupHeader(ctx,text) {return [...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')].find(header=>header.querySelector('.manual-order-group-label').textContent===text);}
function rowGrip(ctx,path) {return cell(ctx,path,'file.name').closest('tr').querySelector('.manual-order-handle');}
test('drag threshold creates a floating row preview and source shadows, and outside drops restore the source',()=>{
  const ctx=setup(),doc=ctx.dom.window.document,handle=rowGrip(ctx,'Note 1.md'),data=dataTransfer();
  handle.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true}));assert.equal(doc.querySelector('.manual-order-row-drag-preview'),null);
  dragEvent(ctx,handle,'dragstart',data);const preview=doc.querySelector('.manual-order-row-drag-preview');assert.ok(preview);assert.equal(doc.querySelectorAll('.manual-order-row-shadow').length,1);assert.equal(preview.querySelectorAll('tr').length,1);assert.equal(preview.querySelector('[data-row-path]'),null);
  doc.body.dispatchEvent(new ctx.dom.window.MouseEvent('dragover',{bubbles:true,clientX:100,clientY:150}));assert.equal(preview.style.left,'114px');assert.equal(preview.style.top,'164px');
  doc.body.dispatchEvent(new ctx.dom.window.MouseEvent('dragover',{bubbles:true,clientX:200,clientY:250}));assert.equal(preview.style.left,'214px');
  dragEvent(ctx,doc.body,'drop',data);assert.equal(doc.querySelector('.manual-order-row-drag-preview'),null);assert.equal(doc.querySelector('.manual-order-row-shadow'),null);assert.equal(ctx.writes,0);assert.deepEqual(ctx.view.groups[0].map(row=>row.path),['Note 1.md','Note 2.md','Note 3.md']);
});
test('Escape, dragend, blur and refresh remove all row-drag visuals without writing notes',()=>{
  for(const cancel of ['escape','end','blur','refresh']) {
    const ctx=setup(),doc=ctx.dom.window.document,handle=rowGrip(ctx,'Note 1.md');dragEvent(ctx,handle,'dragstart',dataTransfer());
    if(cancel==='escape')doc.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    else if(cancel==='end')dragEvent(ctx,handle,'dragend',dataTransfer());
    else if(cancel==='blur')ctx.dom.window.dispatchEvent(new ctx.dom.window.Event('blur'));
    else ctx.view.onDataUpdated();
    assert.equal(doc.querySelector('.manual-order-row-drag-preview,.manual-order-row-shadow,.manual-order-drag-image'),null);assert.equal(ctx.writes,0);
  }
});
test('a multi-row empty-column drop keeps shadows through the pending write and clears them on success',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups[1].layout='vertical';ctx.view.onDataUpdated();const doc=ctx.dom.window.document;
  rowGrip(ctx,'Note 1.md').click();rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  let release;const gate=new Promise(resolve=>{release=resolve;}),write=ctx.app.fileManager.processFrontMatter;ctx.app.fileManager.processFrontMatter=async(...args)=>{await gate;return write(...args);};
  const a=groupHeader(ctx,'note.team: A').parentElement,target=[...a.querySelectorAll('.manual-order-group-header')].find(header=>header.querySelector('.manual-order-group-label').textContent==='note.stage: Waiting');
  const data=dataTransfer(),handle=rowGrip(ctx,'Note 1.md');dragEvent(ctx,handle,'dragstart',data);assert.equal(doc.querySelector('.manual-order-drag-count').textContent,'2 rows');assert.equal(doc.querySelectorAll('.manual-order-row-shadow').length,2);
  dragEvent(ctx,target,'drop',data);assert.equal(doc.querySelector('.manual-order-row-drag-preview'),null);assert.equal(doc.querySelectorAll('.manual-order-row-shadow').length,2);dragEvent(ctx,handle,'dragend',data);assert.equal(doc.querySelectorAll('.manual-order-row-shadow').length,2);
  release();await settle(ctx);assert.equal(doc.querySelector('.manual-order-row-shadow,.manual-order-row-drag-preview,.manual-order-drag-image'),null);
  for(const i of [1,2]){assert.equal(ctx.records.get(`Note ${i}.md`).fm.stage,'Waiting');assert.equal(ctx.records.get(`Note ${i}.md`).fm.team,'A');}
});
test('failed row drops remove the preview and restore the original rows',async()=>{
  const ctx=groupedMoveFixture(),doc=ctx.dom.window.document;ctx.app.fileManager.processFrontMatter=async()=>{throw new Error('write failed');};
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));
  assert.equal(ctx.records.get('Note 1.md').fm.team,'A');assert.equal(doc.querySelector('.manual-order-row-drag-preview,.manual-order-row-shadow'),null);assert.ok(doc.querySelector('tr[data-row-path="Note 1.md"]'));assert.match(globalThis.notices.at(-1),/write failed/);
});
test('handle pointerdown selects immediately and dragging preserves a modifier-selected block',()=>{
  const ctx=setup([1,2,3]),doc=ctx.dom.window.document;
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true,button:0}));assert.deepEqual([...ctx.view.selectedRows],['Note 1.md']);
  rowGrip(ctx,'Note 3.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true,button:0}));assert.equal(ctx.view.selectedRows.size,2);
  const data=dataTransfer();dragEvent(ctx,rowGrip(ctx,'Note 1.md'),'dragstart',data);assert.deepEqual(ctx.view.drag.paths,['Note 1.md','Note 3.md']);
  assert.equal(doc.querySelector('.manual-order-row-select'),null);assert.equal(doc.querySelector('thead input'),null);assert.equal(ctx.writes,0);
});
test('Ctrl and Cmd toggle individual handles while Shift selects the visible range in either direction',()=>{
  const ctx=setup([1,2,3,4]);const click=(i,mods={})=>rowGrip(ctx,`Note ${i}.md`).dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,...mods}));
  click(1);click(3,{ctrlKey:true});assert.deepEqual([...ctx.view.selectedRows],['Note 1.md','Note 3.md']);click(1,{ctrlKey:true});assert.deepEqual([...ctx.view.selectedRows],['Note 3.md']);
  click(4,{metaKey:true});assert.equal(ctx.view.selectedRows.size,2);click(4,{metaKey:true});assert.deepEqual([...ctx.view.selectedRows],['Note 3.md']);
  click(1);click(4,{shiftKey:true});assert.equal(ctx.view.selectedRows.size,4);click(4);click(2,{shiftKey:true});assert.deepEqual([...ctx.view.selectedRows],['Note 1.md','Note 2.md']);
  click(3);assert.deepEqual([...ctx.view.selectedRows],['Note 3.md']);assert.equal(ctx.writes,0);
});
test('clicking another cell, empty space or outside the view clears row selection and its anchor',async()=>{
  const ctx=setup([1,2,3]);const doc=ctx.dom.window.document;
  for(const target of [cell(ctx,'Note 2.md','file.name'),doc.querySelector('.manual-order-bases'),doc.body]) {
    rowGrip(ctx,'Note 1.md').click();target.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true}));assert.equal(ctx.view.selectedRows.size,0);assert.equal(ctx.view.rowAnchor,undefined);assert.equal(rowGrip(ctx,'Note 1.md').getAttribute('aria-pressed'),'false');
  }
  rowGrip(ctx,'Note 1.md').click();cell(ctx,'Note 2.md','note.priority').click();await settle(ctx);assert.equal(ctx.view.selectedRows.size,0);assert.ok(ctx.view.editor,'the cell click also starts its normal edit action');ctx.view.editor.cancel();
});
test('pressing a nonselected handle starts a fresh selection without changing file data',()=>{
  const ctx=setup([1,2,3]);rowGrip(ctx,'Note 1.md').click();rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  const third=rowGrip(ctx,'Note 3.md');third.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true}));assert.deepEqual([...ctx.view.selectedRows],['Note 3.md']);third.click();assert.deepEqual([...ctx.view.selectedRows],['Note 3.md']);assert.equal(ctx.writes,0);
});
async function dropRows(ctx,path,target) {
  const data=dataTransfer();dragEvent(ctx,rowGrip(ctx,path),'dragstart',data);const over=dragEvent(ctx,target,'dragover',data);dragEvent(ctx,target,'drop',data);await settle(ctx);return over;
}

test('moving a row to a nested group changes all ancestor values, preserves rank and is one undo',async()=>{
  const ctx=groupedMoveFixture(),destination=groupHeader(ctx,'note.team: B').parentElement;
  const header=[...destination.querySelectorAll('.manual-order-group-header')].find(header=>header.textContent.includes('Waiting'));
  assert.equal((await dropRows(ctx,'Note 1.md',header)).defaultPrevented,true);
  const fm=ctx.records.get('Note 1.md').fm;assert.equal(fm.team,'B');assert.equal(fm.stage,'Waiting');assert.equal(fm.priority,1);assert.equal(fm.keep,'unchanged');assert.equal(ctx.writes,1);assert.equal(ctx.plugin.editHistory.length,1);
  assert.equal(ctx.view.groups.find(rows=>rows.some(row=>row.path==='Note 4.md')).length,2);
  await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.team,'A');assert.equal(ctx.records.get('Note 1.md').fm.stage,'Ready');
});

test('handle ranges and modifier grip selection move several rows to a collapsed parent without changing child properties',async()=>{
  const ctx=groupedMoveFixture(),doc=ctx.dom.window.document;
  groupHeader(ctx,'note.team: B').click();await settle(ctx);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,shiftKey:true}));
  assert.equal(ctx.view.selectedRows.size,2);
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));
  for(const i of [1,2]){const fm=ctx.records.get(`Note ${i}.md`).fm;assert.equal(fm.team,'B');assert.equal(fm.stage,'Ready');}
  assert.equal(ctx.writes,2);assert.equal(ctx.plugin.editHistory.length,1);assert.equal(ctx.view.selectedRows.size,0);
  await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.team,'A');assert.equal(ctx.records.get('Note 2.md').fm.team,'A');
});

test('dropping selected rows between groups inserts the block with sparse ranks in one undo',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.view.onDataUpdated();
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  assert.equal(ctx.view.selectedRows.size,2);
  await dropRows(ctx,'Note 1.md',cell(ctx,'Note 4.md','file.name').closest('tr'));
  const rows=ctx.view.groups.find(rows=>rows.some(row=>row.path==='Note 3.md'));assert.deepEqual(rows.map(row=>row.path),['Note 3.md','Note 1.md','Note 2.md','Note 4.md']);
  assert.deepEqual(rows.map(row=>row.rank),[3,3.33,3.66,4]);assert.equal(ctx.plugin.editHistory.length,1);
  await ctx.plugin.undoEdit();assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),[1,2,3,4]);assert.equal(ctx.records.get('Note 1.md').fm.team,'A');
});

test('moving to No value removes only the destination grouping keys and undo restores them',async()=>{
  const ctx=groupedMoveFixture();delete ctx.records.get('Note 3.md').fm.team;ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.view.onDataUpdated();
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: No value'));
  assert.equal(Object.hasOwn(ctx.records.get('Note 1.md').fm,'team'),false);assert.equal(ctx.records.get('Note 1.md').fm.stage,'Ready');
  await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.team,'A');
});

test('native grouping moves use the actual native property, including a numeric zero target',async()=>{
  const ctx=groupedMoveFixture();ctx.view.config.groupBy={property:'note.score',direction:'ASC'};ctx.options.manualGroups=[];
  ctx.records.get('Note 1.md').fm.score=1;ctx.records.get('Note 2.md').fm.score=0;
  ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,1),key:{toString:()=> '1',renderTo:el=>{el.textContent='1';}},hasKey:()=>true},{entries:ctx.entries.slice(1,2),key:{toString:()=> '0',renderTo:el=>{el.textContent='0';}},hasKey:()=>true}];ctx.view.onDataUpdated();
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'0'));assert.equal(ctx.records.get('Note 1.md').fm.score,0);assert.equal(typeof ctx.records.get('Note 1.md').fm.score,'number');
  await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.score,1);
});

test('computed grouping properties reject moves that would require changing a formula',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'formula.bucket',direction:'asc'}];
  ctx.entries.forEach((entry,i)=>{const old=entry.getValue;entry.getValue=id=>id==='formula.bucket'?{toString:()=>i<2?'A':'B',renderTo:el=>{el.textContent=i<2?'A':'B';}}:old(id);});ctx.view.onDataUpdated();
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'formula.bucket: B'));assert.equal(ctx.writes,0);assert.match(globalThis.notices.at(-1),/computed/);
});

test('changed destination groups and stale drag revisions reject moves without note writes',async()=>{
  const ctx=groupedMoveFixture();const header=groupHeader(ctx,'note.team: B');ctx.records.get('Note 3.md').fm.team='Changed';
  await dropRows(ctx,'Note 1.md',header);assert.equal(ctx.writes,0);assert.match(globalThis.notices.at(-1),/destination group changed/);
  ctx.view.onDataUpdated();const data=dataTransfer();dragEvent(ctx,rowGrip(ctx,'Note 1.md'),'dragstart',data);ctx.view.onDataUpdated();dragEvent(ctx,groupHeader(ctx,'note.team: Changed'),'drop',data);await settle(ctx);assert.equal(ctx.writes,0);
});

test('failed bulk group moves roll back earlier notes and create no undo receipt',async()=>{
  const ctx=groupedMoveFixture();rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  const original=ctx.app.fileManager.processFrontMatter;ctx.app.fileManager.processFrontMatter=async(file,callback)=>{if(file.path==='Note 2.md')throw new Error('Simulated write failure');return original(file,callback);};
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));assert.equal(ctx.records.get('Note 1.md').fm.team,'A');assert.equal(ctx.records.get('Note 2.md').fm.team,'A');assert.equal(ctx.plugin.editHistory.length,0);
});

test('linked group moves preserve aliases and list types and undo exactly',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];
  ctx.records.get('Note 3.md').fm.team=['[[Note 4|Fourth alias]]','plain',false,0];ctx.view.onDataUpdated();
  const header=[...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')].find(header=>header.querySelector('.internal-link'));
  await dropRows(ctx,'Note 1.md',header);assert.deepEqual(ctx.records.get('Note 1.md').fm.team,['[[Note 4|Fourth alias]]','plain',false,0]);
  assert.equal(ctx.view.groups.find(rows=>rows.some(row=>row.path==='Note 3.md')).length,2);await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.team,'A');
});

test('moves to boolean false and numeric zero retain their primitive types',async()=>{
  for(const value of [false,0]) {
    const ctx=groupedMoveFixture();ctx.records.get('Note 3.md').fm.team=value;ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.view.onDataUpdated();
    await dropRows(ctx,'Note 1.md',groupHeader(ctx,`note.team: ${value}`));assert.equal(ctx.records.get('Note 1.md').fm.team,value);assert.equal(typeof ctx.records.get('Note 1.md').fm.team,typeof value);
  }
});

test('multi-row reorder inside a linked group preserves each notes alias instead of overwriting it',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];
  for(let i=1;i<=4;i++)ctx.records.get(`Note ${i}.md`).fm.team=`[[Note 4|Alias ${i}]]`;ctx.view.onDataUpdated();assert.equal(ctx.view.groups.length,1);
  await ctx.view.moveRowsToGroup(['Note 3.md'],ctx.view.groupTargets.find(target=>target.rows.some(row=>row.path==='Note 3.md')),{path:'Note 4.md',below:false});assert.equal(ctx.writes,0);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  await dropRows(ctx,'Note 1.md',cell(ctx,'Note 4.md','file.name').closest('tr'));
  for(let i=1;i<=4;i++)assert.equal(ctx.records.get(`Note ${i}.md`).fm.team,`[[Note 4|Alias ${i}]]`);
});

test('computed parent values can remain unchanged while a writable child group changes',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'formula.bucket',direction:'asc'},{property:'note.team',direction:'asc'}];
  ctx.entries.forEach(entry=>{const old=entry.getValue;entry.getValue=id=>id==='formula.bucket'?{toString:()=> 'Same',renderTo:el=>{el.textContent='Same';}}:old(id);});ctx.view.onDataUpdated();
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));assert.equal(ctx.records.get('Note 1.md').fm.team,'B');assert.equal(ctx.writes,1);
});

test('unknown native grouping properties reject cross-group moves rather than guessing a property',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[];
  ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,2),key:{toString:()=> 'A',renderTo:el=>{el.textContent='A';}},hasKey:()=>true},{entries:ctx.entries.slice(2),key:{toString:()=> 'B',renderTo:el=>{el.textContent='B';}},hasKey:()=>true}];ctx.view.onDataUpdated();
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'B'));assert.equal(ctx.writes,0);assert.match(globalThis.notices.at(-1),/native grouping property could not be identified/);
});

test('bulk handle selection survives refresh and selected handles expose pressed state',()=>{
  const ctx=groupedMoveFixture(),doc=ctx.dom.window.document;
  rowGrip(ctx,'Note 1.md').click();assert.equal(rowGrip(ctx,'Note 1.md').getAttribute('aria-pressed'),'true');
  ctx.view.onDataUpdated();assert.equal(rowGrip(ctx,'Note 1.md').getAttribute('aria-pressed'),'true');
  rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));assert.equal(ctx.view.selectedRows.size,2);
  assert.equal(doc.querySelector('.manual-order-row-select'),null);assert.equal(doc.querySelector('thead input'),null);
  assert.equal(doc.querySelector('.manual-order-clear-rows'),null);
  doc.querySelector('.manual-order-toolbar').click();assert.equal(ctx.view.selectedRows.size,0);
});

test('positioned group moves respect descending order and undo restores every rank',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.options.orderDirection='desc';ctx.view.onDataUpdated();
  await dropRows(ctx,'Note 1.md',cell(ctx,'Note 3.md','file.name').closest('tr'));
  const rows=ctx.view.groups.find(rows=>rows.some(row=>row.path==='Note 4.md'));assert.deepEqual(rows.map(row=>row.path),['Note 4.md','Note 1.md','Note 3.md']);assert.deepEqual(rows.map(row=>row.rank),[4,3.5,3]);
  await ctx.plugin.undoEdit();assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),[1,2,3,4]);
});

test('writable folder grouping moves the file and restores its location in the same undo',async()=>{
  const ctx=groupedMoveFixture(),record=ctx.records.get('Note 3.md');ctx.records.delete('Note 3.md');record.file.path='Existing/Note 3.md';ctx.records.set(record.file.path,record);
  ctx.entries.forEach(entry=>{const old=entry.getValue;entry.getValue=id=>id==='file.folder'?{toString:()=>entry.file.path.includes('/')?'Existing':'',renderTo:el=>{el.textContent=entry.file.path.includes('/')?'Existing':'';}}:old(id);});
  ctx.options.manualGroups=[{property:'file.folder',direction:'asc'}];ctx.view.onDataUpdated();
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'file.folder: Existing'));assert.equal(ctx.records.has('Existing/Note 1.md'),true);assert.equal(ctx.plugin.editHistory.length,1);
  await ctx.plugin.undoEdit();assert.equal(ctx.records.has('Note 1.md'),true);assert.equal(ctx.records.has('Existing/Note 1.md'),false);
});

function filterToFirst(ctx,count) {const entries=ctx.entries.slice(0,count);ctx.view.data={data:entries,groupedData:[{entries,hasKey:()=>false}]};ctx.view.onDataUpdated();}

test('empty groups remain drop targets when a filtered-out vault note still has the complete grouping path',async()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 4.md').fm.team='A';ctx.records.get('Note 4.md').fm.stage='Ready';filterToFirst(ctx,3);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));
  const parent=groupHeader(ctx,'note.team: A');assert.ok(parent);assert.equal(parent.querySelector('.manual-order-group-count').textContent,'0');
  const child=parent.parentElement.querySelector('.manual-order-group-body .manual-order-group-header');assert.equal(child.querySelector('.manual-order-group-count').textContent,'0');
  assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,3);assert.equal(ctx.dom.window.document.querySelector('[data-row-path="Note 4.md"]'),null);
  await dropRows(ctx,'Note 1.md',child);assert.equal(ctx.records.get('Note 1.md').fm.team,'A');assert.equal(ctx.records.get('Note 1.md').fm.stage,'Ready');assert.equal(ctx.records.get('Note 4.md').fm.team,'A');
  await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.team,'B');assert.equal(groupHeader(ctx,'note.team: A').querySelector('.manual-order-group-count').textContent,'0');
});

test('retained empty groups survive reopen and keep their collapsed state',async()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 4.md').fm.team='A';ctx.records.get('Note 4.md').fm.stage='Ready';filterToFirst(ctx,3);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));
  groupHeader(ctx,'note.team: A').click();await settle(ctx);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();
  assert.equal(groupHeader(ctx,'note.team: A').getAttribute('aria-expanded'),'false');assert.equal(groupHeader(ctx,'note.team: A').querySelector('.manual-order-group-count').textContent,'0');
  const writes=ctx.writes;ctx.view.onDataUpdated();assert.equal(ctx.writes,writes);assert.ok(ctx.options.manualKnownGroups);
});

test('empty groups persist after the last vault occurrence changes and unrelated outside values are not added',async()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 4.md').fm.team='A';ctx.records.get('Note 4.md').fm.stage='Ready';filterToFirst(ctx,3);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));assert.ok(groupHeader(ctx,'note.team: A'));
  ctx.records.get('Note 4.md').fm.team='Unrelated';ctx.view.refreshGroupAvailability();assert.ok(groupHeader(ctx,'note.team: A'));assert.equal(groupHeader(ctx,'note.team: Unrelated'),undefined);
  assert.equal(ctx.options.manualKnownGroups.groups.some(group=>group.label==='A'),true);
});

test('nested retention preserves previously seen parent-child combinations without vault evidence',async()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 4.md').fm.team='A';ctx.records.get('Note 4.md').fm.stage='Waiting';filterToFirst(ctx,3);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));
  const parent=groupHeader(ctx,'note.team: A');assert.ok(parent);assert.equal(parent.parentElement.querySelectorAll('.manual-order-group-body .manual-order-group-header').length,1);
  assert.match(parent.parentElement.textContent,/No matching files/);assert.equal(ctx.records.get('Note 4.md').fm.stage,'Waiting');
});

test('group history resets when grouping properties change',()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.keep',direction:'asc'}];ctx.view.onDataUpdated();
  assert.equal(groupHeader(ctx,'note.team: A'),undefined);assert.equal(ctx.options.manualKnownGroups.groups.some(group=>group.property==='note.team'),false);
});

test('native empty group retention uses its original typed key during metadata refresh and accepts moves back',async()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 4.md').fm.team='A';filterToFirst(ctx,3);ctx.options.manualGroups=[];ctx.view.config.groupBy={property:'note.team',direction:'ASC'};
  class NativeString {static type='string';constructor(value){this.value=value;}toString(){return this.value;}renderTo(el){el.textContent=this.value;}}
  ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,2),key:new NativeString('A'),hasKey:()=>true},{entries:ctx.entries.slice(2,3),key:new NativeString('B'),hasKey:()=>true}];ctx.view.onDataUpdated();
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await dropRows(ctx,'Note 1.md',groupHeader(ctx,'B'));
  assert.equal(ctx.options.manualKnownGroups.groups.find(group=>group.label==='A').bindings[0].value.value,'A');
  ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,3),key:new NativeString('B'),hasKey:()=>true}];ctx.view.onDataUpdated();
  assert.equal(groupHeader(ctx,'A').querySelector('.manual-order-group-count').textContent,'0');
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'A'));assert.equal(ctx.records.get('Note 1.md').fm.team,'A');assert.equal(ctx.records.get('Note 4.md').fm.team,'A');
});

test('retention keeps false and zero distinct and still works when the filtered Base becomes empty',()=>{
  const ctx=setup([1,2,3],['note.team']);ctx.records.get('Note 1.md').fm.team=false;ctx.records.get('Note 2.md').fm.team=0;ctx.records.get('Note 3.md').fm.team='never shown';ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];filterToFirst(ctx,2);
  filterToFirst(ctx,0);assert.ok(groupHeader(ctx,'note.team: false'));assert.ok(groupHeader(ctx,'note.team: 0'));assert.equal(groupHeader(ctx,'note.team: never shown'),undefined);assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,0);assert.equal(ctx.writes,0);
});

test('retained linked group headers keep aliases and links and never write the outside note',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.records.get('Note 1.md').fm.team='[[Note 3|Visible alias]]';ctx.records.get('Note 4.md').fm.team='[[Note 3|Outside alias]]';filterToFirst(ctx,3);
  await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: A'));
  const header=[...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')].find(header=>header.querySelector('.internal-link'));
  assert.equal(header.querySelector('.manual-order-group-count').textContent,'0');assert.equal(header.querySelector('.internal-link').textContent,'Outside alias');header.querySelector('.internal-link').click();assert.equal(ctx.opened.at(-1)[0],'Note 3');
  await dropRows(ctx,'Note 2.md',header);assert.equal(ctx.records.get('Note 2.md').fm.team,'[[Note 3|Outside alias]]');assert.equal(ctx.records.get('Note 4.md').fm.team,'[[Note 3|Outside alias]]');
});

test('removing the last outside supporting note keeps the empty header without changing visible notes',async()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 4.md').fm.team='A';filterToFirst(ctx,3);ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.view.onDataUpdated();
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));assert.ok(groupHeader(ctx,'note.team: A'));
  ctx.records.delete('Note 4.md');const writes=ctx.writes;ctx.view.refreshGroupAvailability();assert.ok(groupHeader(ctx,'note.team: A'));assert.equal(ctx.writes,writes);
});

test('vertical grouping creates side-by-side column containers with the chosen table properties',()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'},{property:'note.stage',direction:'asc'}];ctx.view.onDataUpdated();
  const board=ctx.dom.window.document.querySelector('.manual-order-bases > .manual-order-group-board');assert.ok(board);assert.equal(board.children.length,2);assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-board-column').length,2);
  assert.equal(board.querySelectorAll('table').length,3);for(const table of board.querySelectorAll('table'))assert.deepEqual([...table.querySelectorAll('th')].slice(1).map(th=>th.textContent),['file.name','note.team','note.stage','note.priority']);assert.equal(ctx.writes,0);
});

test('vertical subgroups can nest inside horizontal groups or other vertical groups',()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  assert.equal(ctx.dom.window.document.querySelector('.manual-order-bases > .manual-order-group-board'),null);assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-group-board').length,2);assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-board-column').length,4);
  ctx.options.manualGroups[0].layout='vertical';ctx.view.onDataUpdated();assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-board-column').length,5);assert.equal(ctx.writes,0);
});

test('per-property layout controls in the group menu persist and leave grouping values unchanged',async()=>{
  const ctx=groupedMoveFixture(),doc=ctx.dom.window.document;[...doc.querySelectorAll('.manual-order-toolbar button')].find(button=>button.textContent==='Groups (2)').click();await settle(ctx);
  const layout=doc.querySelector('[aria-label="Group level 1 layout"]');layout.value='vertical';layout.dispatchEvent(new ctx.dom.window.Event('change',{bubbles:true}));await settle(ctx);
  assert.equal(ctx.options.manualGroups[0].layout,'vertical');assert.equal(ctx.options.manualGroups[1].layout,undefined);assert.equal(doc.querySelectorAll('.manual-order-board-column').length,2);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},doc.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.equal(doc.querySelectorAll('.manual-order-board-column').length,2);assert.equal(ctx.writes,0);
});

test('native primary grouping can be vertical independently of nested properties',async()=>{
  const ctx=groupedMoveFixture();ctx.view.config.groupBy={property:'note.team',direction:'ASC'};ctx.options.manualGroups=[{property:'note.stage',direction:'asc'}];ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,2),key:{toString:()=> 'A',renderTo:el=>{el.textContent='A';}},hasKey:()=>true},{entries:ctx.entries.slice(2),key:{toString:()=> 'B',renderTo:el=>{el.textContent='B';}},hasKey:()=>true}];ctx.view.onDataUpdated();
  const doc=ctx.dom.window.document;[...doc.querySelectorAll('button')].find(button=>button.textContent==='Groups (1)').click();await settle(ctx);
  const layout=doc.querySelector('[aria-label="Primary group layout"]');layout.value='vertical';layout.dispatchEvent(new ctx.dom.window.Event('change',{bubbles:true}));await settle(ctx);
  assert.equal(ctx.options.manualNativeGroupLayout,'vertical');assert.equal(doc.querySelectorAll('.manual-order-board-column').length,2);assert.equal(ctx.options.manualGroups[0].layout,undefined);assert.equal(ctx.writes,0);
});

test('dropping rows on a board column body moves group membership and undo restores it',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const target=groupHeader(ctx,'note.team: B').parentElement.querySelector(':scope > .manual-order-group-body');await dropRows(ctx,'Note 1.md',target);
  assert.equal(ctx.records.get('Note 1.md').fm.team,'B');assert.equal(ctx.records.get('Note 1.md').fm.priority,1);await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 1.md').fm.team,'A');
});

test('retained empty vertical columns show table headers and accept row drops',async()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 4.md').fm.team='A';ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];filterToFirst(ctx,3);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));
  const header=groupHeader(ctx,'note.team: A'),column=header.parentElement;assert.equal(header.querySelector('.manual-order-group-count').textContent,'0');assert.equal(column.querySelectorAll('table th').length,5);assert.equal(column.querySelectorAll('tbody tr').length,0);assert.equal(column.querySelector('thead input'),null);
  await dropRows(ctx,'Note 1.md',column.querySelector('.manual-order-empty-group'));assert.equal(ctx.records.get('Note 1.md').fm.team,'A');
});

test('changing orientation retains collapsed group state and previously empty groups',async()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 4.md').fm.team='A';ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];filterToFirst(ctx,3);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));groupHeader(ctx,'note.team: A').click();await settle(ctx);
  ctx.options.manualGroups[0].layout='vertical';ctx.view.onDataUpdated();assert.equal(groupHeader(ctx,'note.team: A').getAttribute('aria-expanded'),'false');assert.equal(groupHeader(ctx,'note.team: A').querySelector('.manual-order-group-count').textContent,'0');assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-board-column').length,2);
});

test('board table horizontal scroll survives an edit-driven refresh',()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const body=ctx.dom.window.document.querySelector('[data-group-scroll-key]');body.scrollLeft=90;const key=body.dataset.groupScrollKey;ctx.view.onDataUpdated();assert.equal([...ctx.dom.window.document.querySelectorAll('[data-group-scroll-key]')].find(body=>body.dataset.groupScrollKey===key).scrollLeft,90);
});

function resizeGroup(ctx,header,dx) {
  const handle=header.parentElement.querySelector(':scope > .manual-order-column-resize');
  const dispatch=(type,x,target)=>{const event=new ctx.dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x});Object.defineProperty(event,'pointerId',{value:1});target.dispatchEvent(event);};
  dispatch('pointerdown',100,handle);dispatch('pointermove',100+dx,ctx.dom.window.document);dispatch('pointerup',100+dx,ctx.dom.window.document);
}

test('individual board widths persist through refresh and reopen without changing notes',()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const key=groupHeader(ctx,'note.team: A').parentElement.dataset.groupWidthKey;resizeGroup(ctx,groupHeader(ctx,'note.team: A'),120);
  assert.equal(ctx.options.manualGroupWidths[key],760);assert.equal(groupHeader(ctx,'note.team: A').parentElement.style.getPropertyValue('--manual-order-column-width'),'760px');assert.equal(groupHeader(ctx,'note.team: B').parentElement.style.getPropertyValue('--manual-order-column-width'),'');
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.equal(groupHeader(ctx,'note.team: A').parentElement.style.getPropertyValue('--manual-order-column-width'),'760px');assert.equal(ctx.writes,0);
});

test('collapsed vertical groups become rails and expanding restores the independently saved width',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();resizeGroup(ctx,groupHeader(ctx,'note.team: A'),-120);
  groupHeader(ctx,'note.team: A').click();await settle(ctx);let column=groupHeader(ctx,'note.team: A').parentElement;assert.equal(column.classList.contains('is-board-collapsed'),true);assert.equal(column.querySelector('.manual-order-group-body'),null);assert.equal(column.querySelector('.manual-order-column-resize'),null);
  groupHeader(ctx,'note.team: A').click();await settle(ctx);column=groupHeader(ctx,'note.team: A').parentElement;assert.equal(column.classList.contains('is-board-collapsed'),false);assert.equal(column.style.getPropertyValue('--manual-order-column-width'),'520px');assert.ok(column.querySelector('table'));assert.equal(ctx.writes,0);
});

test('resizing defers metadata redraw until release and supports resetting only that group',()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const header=groupHeader(ctx,'note.team: A'),handle=header.parentElement.querySelector('.manual-order-column-resize'),revision=ctx.view.revision;
  const event=new ctx.dom.window.MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:0,clientX:100});Object.defineProperty(event,'pointerId',{value:1});handle.dispatchEvent(event);
  ctx.view.onDataUpdated();assert.equal(ctx.view.revision,revision);ctx.dom.window.document.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(ctx.options.manualGroupWidths,undefined);
  resizeGroup(ctx,groupHeader(ctx,'note.team: A'),-100);resizeGroup(ctx,groupHeader(ctx,'note.team: B'),-50);
  groupHeader(ctx,'note.team: A').parentElement.querySelector('.manual-order-column-resize').dispatchEvent(new ctx.dom.window.MouseEvent('dblclick',{bubbles:true,cancelable:true}));assert.equal(Object.keys(ctx.options.manualGroupWidths).length,1);assert.equal(ctx.writes,0);
});

test('collapsed rails remain row-drop targets without expanding or losing their saved width',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();resizeGroup(ctx,groupHeader(ctx,'note.team: B'),-80);const key=groupHeader(ctx,'note.team: B').parentElement.dataset.groupWidthKey;
  groupHeader(ctx,'note.team: B').click();await settle(ctx);await dropRows(ctx,'Note 1.md',groupHeader(ctx,'note.team: B'));
  assert.equal(ctx.records.get('Note 1.md').fm.team,'B');assert.equal(groupHeader(ctx,'note.team: B').parentElement.classList.contains('is-board-collapsed'),true);assert.equal(ctx.options.manualGroupWidths[key],560);
});

test('vertical row dragover does not auto-scroll at viewport edges for single or selected rows',async()=>{
  for(const multiple of [false,true]) {
    const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
    const root=ctx.dom.window.document.querySelector('.manual-order-bases');Object.defineProperties(root,{scrollWidth:{value:2000},clientWidth:{value:600},scrollHeight:{value:1600},clientHeight:{value:500}});root.getBoundingClientRect=()=>({left:0,right:600,top:0,bottom:500});root.scrollLeft=120;root.scrollTop=60;
    if(multiple){rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));}
    const header=groupHeader(ctx,'note.team: B'),data=dataTransfer();dragEvent(ctx,rowGrip(ctx,'Note 1.md'),'dragstart',data);
    for(let i=0;i<5;i++){const event=new ctx.dom.window.MouseEvent('dragover',{bubbles:true,cancelable:true,clientX:599,clientY:499});Object.defineProperty(event,'dataTransfer',{value:data});header.dispatchEvent(event);}
    assert.equal(root.scrollLeft,120);assert.equal(root.scrollTop,60);
    dragEvent(ctx,header,'drop',data);await settle(ctx);assert.equal(root.scrollLeft,120);assert.equal(root.scrollTop,60);assert.equal(ctx.records.get('Note 1.md').fm.team,'B');if(multiple)assert.equal(ctx.records.get('Note 2.md').fm.team,'B');
    root.scrollLeft=200;root.dispatchEvent(new ctx.dom.window.Event('scroll'));assert.equal(root.scrollLeft,200,'normal scrolling resumes after the move');
  }
});

test('cancelled or refreshed row drags release the board scroll lock',()=>{
  for(const cancel of ['escape','refresh']) {
    const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
    const root=ctx.dom.window.document.querySelector('.manual-order-bases');Object.defineProperties(root,{scrollWidth:{value:2000},clientWidth:{value:600},scrollHeight:{value:1500},clientHeight:{value:500}});root.scrollLeft=120;
    dragEvent(ctx,rowGrip(ctx,'Note 1.md'),'dragstart',dataTransfer());
    if(cancel==='escape')ctx.dom.window.document.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));else ctx.view.onDataUpdated();
    root.scrollLeft=240;root.dispatchEvent(new ctx.dom.window.Event('scroll'));assert.equal(root.scrollLeft,240);assert.equal(ctx.view.drag,undefined);assert.equal(ctx.writes,0);
  }
});

test('matching vertical values under different horizontal groups share one persisted width',()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const ready=()=>[...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')].filter(header=>header.querySelector('.manual-order-group-label').textContent==='note.stage: Ready');
  assert.equal(ready().length,2);assert.notEqual(ready()[0].parentElement.dataset.groupKey,ready()[1].parentElement.dataset.groupKey);assert.equal(ready()[0].parentElement.dataset.groupWidthKey,ready()[1].parentElement.dataset.groupWidthKey);
  resizeGroup(ctx,ready()[0],-100);for(const header of ready())assert.equal(header.parentElement.style.getPropertyValue('--manual-order-column-width'),'540px');assert.equal(groupHeader(ctx,'note.stage: Waiting').parentElement.style.getPropertyValue('--manual-order-column-width'),'');assert.equal(Object.keys(ctx.options.manualGroupWidths).length,1);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();for(const header of ready())assert.equal(header.parentElement.style.getPropertyValue('--manual-order-column-width'),'540px');assert.equal(ctx.writes,0);
});

test('hidden horizontal parents and collapsed matching columns use the new shared width when reopened',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const ready=()=>[...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')].filter(header=>header.querySelector('.manual-order-group-label').textContent==='note.stage: Ready');
  ready()[1].click();await settle(ctx);resizeGroup(ctx,ready()[0],-80);assert.equal(ready()[1].parentElement.classList.contains('is-board-collapsed'),true);ready()[1].click();await settle(ctx);assert.equal(ready()[1].parentElement.style.getPropertyValue('--manual-order-column-width'),'560px');
  groupHeader(ctx,'note.team: B').click();await settle(ctx);resizeGroup(ctx,ready()[0],40);groupHeader(ctx,'note.team: B').click();await settle(ctx);for(const header of ready())assert.equal(header.parentElement.style.getPropertyValue('--manual-order-column-width'),'600px');assert.equal(ctx.writes,0);
});

test('aliased links to the same note link their column widths across horizontal parents',()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 1.md').fm.stage='[[Note 4|First alias]]';ctx.records.get('Note 2.md').fm.stage='[[Note 4|First alias]]';ctx.records.get('Note 3.md').fm.stage='[[Note 4|Other alias]]';ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const headers=[...ctx.dom.window.document.querySelectorAll('.manual-order-board-column > .manual-order-group-header')].filter(header=>header.querySelector('.internal-link'));assert.equal(headers.length,2);assert.equal(headers[0].parentElement.dataset.groupWidthKey,headers[1].parentElement.dataset.groupWidthKey);resizeGroup(ctx,headers[0],-120);
  for(const header of ctx.dom.window.document.querySelectorAll('.manual-order-board-column > .manual-order-group-header'))if(header.querySelector('.internal-link'))assert.equal(header.parentElement.style.getPropertyValue('--manual-order-column-width'),'520px');assert.equal(ctx.records.get('Note 3.md').fm.stage,'[[Note 4|Other alias]]');assert.equal(ctx.writes,0);
});

test('native horizontal parents share matching nested vertical column widths',()=>{
  const ctx=groupedMoveFixture();ctx.view.config.groupBy={property:'note.team',direction:'ASC'};ctx.options.manualGroups=[{property:'note.stage',direction:'asc',layout:'vertical'}];
  ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,2),key:{toString:()=> 'A',renderTo:el=>{el.textContent='A';}},hasKey:()=>true},{entries:ctx.entries.slice(2),key:{toString:()=> 'B',renderTo:el=>{el.textContent='B';}},hasKey:()=>true}];ctx.view.onDataUpdated();
  const ready=[...ctx.dom.window.document.querySelectorAll('.manual-order-board-column > .manual-order-group-header')].filter(header=>header.querySelector('.manual-order-group-label').textContent==='note.stage: Ready');assert.equal(ready.length,2);resizeGroup(ctx,ready[1],-100);
  for(const header of ctx.dom.window.document.querySelectorAll('.manual-order-board-column > .manual-order-group-header'))if(header.querySelector('.manual-order-group-label').textContent==='note.stage: Ready')assert.equal(header.parentElement.style.getPropertyValue('--manual-order-column-width'),'540px');assert.equal(ctx.writes,0);
});

test('vertical groups reserve the same sorted column slots under sparse horizontal parents',()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 1.md').fm.stage='Ready';ctx.records.get('Note 2.md').fm.stage='Ready';ctx.records.get('Note 3.md').fm.stage='Backlog';ctx.records.get('Note 4.md').fm.stage='Waiting';ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const boards=[...ctx.dom.window.document.querySelectorAll('.manual-order-aligned-board')];assert.equal(boards.length,2);assert.equal(boards[0].style.gridTemplateColumns,boards[1].style.gridTemplateColumns);
  const ready=groupHeader(ctx,'note.stage: Ready').parentElement,backlog=groupHeader(ctx,'note.stage: Backlog').parentElement,waiting=groupHeader(ctx,'note.stage: Waiting').parentElement;
  assert.equal(backlog.style.gridColumn,'1');assert.equal(ready.style.gridColumn,'2');assert.equal(waiting.style.gridColumn,'3');assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-board-column').length,6);assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,4);assert.equal(ctx.writes,0);
});

test('aligned positions respect descending group order without persisting artificial combinations',()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 1.md').fm.stage='Ready';ctx.records.get('Note 2.md').fm.stage='Ready';ctx.records.get('Note 3.md').fm.stage='Backlog';ctx.records.get('Note 4.md').fm.stage='Waiting';ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'desc',layout:'vertical'}];ctx.view.onDataUpdated();
  assert.equal(groupHeader(ctx,'note.stage: Waiting').parentElement.style.gridColumn,'1');assert.equal(groupHeader(ctx,'note.stage: Ready').parentElement.style.gridColumn,'2');assert.equal(groupHeader(ctx,'note.stage: Backlog').parentElement.style.gridColumn,'3');assert.equal(ctx.options.manualKnownGroups.groups.filter(group=>group.property==='note.stage').length,4);assert.equal(ctx.writes,0);
});

test('collapsed matches retain alignment tracks and shared resizing updates those tracks live',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const ready=()=>[...ctx.dom.window.document.querySelectorAll('.manual-order-board-column > .manual-order-group-header')].filter(header=>header.querySelector('.manual-order-group-label').textContent==='note.stage: Ready');
  ready()[0].click();await settle(ctx);const boards=()=>[...ctx.dom.window.document.querySelectorAll('.manual-order-aligned-board')];assert.equal(boards()[0].style.gridTemplateColumns,'640px 640px');assert.equal(boards()[1].style.gridTemplateColumns,boards()[0].style.gridTemplateColumns);
  resizeGroup(ctx,ready()[1],-100);assert.equal(boards()[0].style.gridTemplateColumns,'540px 640px');assert.equal(boards()[1].style.gridTemplateColumns,boards()[0].style.gridTemplateColumns);assert.equal(ready()[0].parentElement.classList.contains('is-board-collapsed'),true);assert.equal(ctx.writes,0);
});

test('native horizontal parents reserve the same nested vertical value positions',()=>{
  const ctx=groupedMoveFixture();ctx.records.get('Note 3.md').fm.stage='Backlog';ctx.view.config.groupBy={property:'note.team',direction:'ASC'};ctx.options.manualGroups=[{property:'note.stage',direction:'asc',layout:'vertical'}];
  ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,2),key:{toString:()=> 'A',renderTo:el=>{el.textContent='A';}},hasKey:()=>true},{entries:ctx.entries.slice(2),key:{toString:()=> 'B',renderTo:el=>{el.textContent='B';}},hasKey:()=>true}];ctx.view.onDataUpdated();
  assert.equal(ctx.dom.window.document.querySelectorAll('.manual-order-aligned-board').length,2);assert.equal(groupHeader(ctx,'note.stage: Ready').parentElement.style.gridColumn,'2');assert.equal(groupHeader(ctx,'note.stage: Backlog').parentElement.style.gridColumn,'1');assert.equal(groupHeader(ctx,'note.stage: Waiting').parentElement.style.gridColumn,'3');assert.equal(ctx.writes,0);
});

function groupGrip(header) {return header.querySelector('.manual-order-group-move');}
async function dropGroup(ctx,source,target,after=false) {
  const data=dataTransfer();dragEvent(ctx,groupGrip(source),'dragstart',data);target.parentElement.getBoundingClientRect=()=>({left:0,width:400});
  for(const type of ['dragover','drop']){const event=new ctx.dom.window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:after?390:10});Object.defineProperty(event,'dataTransfer',{value:data});target.dispatchEvent(event);}await settle(ctx);
}
function stageColumns(ctx) {return [...ctx.dom.window.document.querySelectorAll('.manual-order-group-board')].map(board=>[...board.children].map(column=>column.querySelector('.manual-order-group-label').textContent));}

test('missing vertical values are empty row-drop destinations using the destination horizontal bindings',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups[1].layout='vertical';ctx.view.onDataUpdated();
  const a=groupHeader(ctx,'note.team: A').parentElement;
  const waiting=[...a.querySelectorAll('.manual-order-group-header')].find(header=>header.querySelector('.manual-order-group-label').textContent==='note.stage: Waiting');
  assert.equal(waiting.querySelector('.manual-order-group-count').textContent,'0');assert.equal(waiting.parentElement.querySelectorAll('table').length,1);assert.equal(waiting.parentElement.querySelectorAll('tbody tr').length,0);assert.equal(ctx.writes,0);
  await dropRows(ctx,'Note 4.md',waiting.parentElement.querySelector('.manual-order-group-body'));
  assert.equal(ctx.records.get('Note 4.md').fm.team,'A');assert.equal(ctx.records.get('Note 4.md').fm.stage,'Waiting');assert.equal(ctx.records.get('Note 4.md').fm.priority,4);await ctx.plugin.undoEdit();assert.equal(ctx.records.get('Note 4.md').fm.team,'B');
});
test('vertical columns continue through multiple horizontal levels without duplicating notes or group keys',()=>{
  const ctx=groupedMoveFixture();let index=0;for(const record of ctx.records.values())record.fm.sprint=index++%2?'Y':'X';
  ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.sprint',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const boards=stageColumns(ctx);assert.equal(boards.length,4);for(const board of boards)assert.deepEqual(board,['note.stage: Ready','note.stage: Waiting']);
  assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,4);const keys=[...ctx.dom.window.document.querySelectorAll('[data-group-key]')].map(el=>el.dataset.groupKey);assert.equal(new Set(keys).size,keys.length);assert.equal(ctx.writes,0);
});
test('consecutive vertical levels populate newly empty parents while keeping distinct ancestor scopes separate',()=>{
  const ctx=groupedMoveFixture();for(const record of ctx.records.values())record.fm.lane=record.fm.stage==='Ready'?'Doing':'Queued';
  ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'},{property:'note.lane',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const stages=[...ctx.dom.window.document.querySelectorAll('.manual-order-board-column')].filter(el=>el.querySelector(':scope > .manual-order-group-header .manual-order-group-label').textContent==='note.stage: Waiting');assert.equal(stages.length,2);
  for(const stage of stages)assert.deepEqual([...stage.querySelectorAll(':scope > .manual-order-group-body > .manual-order-group-board > .manual-order-board-column > .manual-order-group-header .manual-order-group-label')].map(el=>el.textContent),['note.lane: Queued']);
  assert.equal(ctx.dom.window.document.querySelectorAll('tbody tr').length,4);assert.equal(ctx.writes,0);
});

test('dragging vertical groups reorders matching columns together and persists across reopen without editing notes',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();const before=JSON.stringify([...ctx.records.values()].map(record=>record.fm));
  await dropGroup(ctx,groupHeader(ctx,'note.stage: Waiting'),groupHeader(ctx,'note.stage: Ready'));
  assert.deepEqual(stageColumns(ctx),[['note.stage: Waiting','note.stage: Ready'],['note.stage: Waiting','note.stage: Ready']]);const boards=[...ctx.dom.window.document.querySelectorAll('.manual-order-aligned-board')];for(const board of boards)for(const column of board.children)if(column.querySelector('.manual-order-group-label').textContent==='note.stage: Ready')assert.equal(column.style.gridColumn,'2');
  assert.ok(ctx.options.manualVerticalGroupOrder);assert.equal(JSON.stringify([...ctx.records.values()].map(record=>record.fm)),before);assert.equal(ctx.writes,0);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.deepEqual(stageColumns(ctx),[['note.stage: Waiting','note.stage: Ready'],['note.stage: Waiting','note.stage: Ready']]);
});

test('group grips do not collapse headers and keyboard reordering can reset to the configured sort',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();groupGrip(groupHeader(ctx,'note.team: A')).click();assert.equal(groupHeader(ctx,'note.team: A').getAttribute('aria-expanded'),'true');assert.equal(ctx.options.manualVerticalGroupOrder,undefined);
  groupGrip(groupHeader(ctx,'note.team: A')).dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true,cancelable:true}));await settle(ctx);assert.deepEqual(stageColumns(ctx),[['note.team: B','note.team: A']]);
  [...ctx.dom.window.document.querySelectorAll('.manual-order-toolbar button')].find(button=>button.textContent==='Groups (1)').click();await settle(ctx);ctx.dom.window.document.querySelector('.manual-order-reset-group-order').click();await settle(ctx);assert.equal(ctx.options.manualVerticalGroupOrder,undefined);assert.deepEqual(stageColumns(ctx),[['note.team: A','note.team: B']]);assert.equal(ctx.writes,0);
});

test('native primary groups keep their native order until the user repositions a group',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[];ctx.options.manualNativeGroupLayout='vertical';ctx.view.config.groupBy={property:'note.team',direction:'DESC'};
  ctx.view.data.groupedData=[{entries:ctx.entries.slice(2),key:{toString:()=> 'B',renderTo:el=>{el.textContent='B';}},hasKey:()=>true},{entries:ctx.entries.slice(0,2),key:{toString:()=> 'A',renderTo:el=>{el.textContent='A';}},hasKey:()=>true}];ctx.view.onDataUpdated();assert.deepEqual(stageColumns(ctx),[['B','A']]);
  await dropGroup(ctx,groupHeader(ctx,'A'),groupHeader(ctx,'B'));assert.deepEqual(stageColumns(ctx),[['A','B']]);assert.ok(ctx.options.manualVerticalGroupOrder);assert.equal(ctx.writes,0);
});

test('groups cannot be dragged into a different nested alignment scope',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'},{property:'note.stage',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  const ready=[...ctx.dom.window.document.querySelectorAll('.manual-order-group-header')].filter(header=>header.querySelector('.manual-order-group-label').textContent==='note.stage: Ready');await dropGroup(ctx,ready[0],groupHeader(ctx,'note.stage: Waiting'));assert.equal(ctx.options.manualVerticalGroupOrder,undefined);assert.equal(ctx.writes,0);
});

test('collapsed group rails can be repositioned without changing collapsed state or saved widths',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();resizeGroup(ctx,groupHeader(ctx,'note.team: A'),-100);const widths=JSON.stringify(ctx.options.manualGroupWidths);groupHeader(ctx,'note.team: A').click();await settle(ctx);
  await dropGroup(ctx,groupHeader(ctx,'note.team: A'),groupHeader(ctx,'note.team: B'),true);assert.deepEqual(stageColumns(ctx),[['note.team: B','note.team: A']]);assert.equal(groupHeader(ctx,'note.team: A').getAttribute('aria-expanded'),'false');assert.equal(JSON.stringify(ctx.options.manualGroupWidths),widths);assert.equal(ctx.writes,0);
});

test('failed group-position saves leave the original order intact',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();const save=ctx.view.config.set;ctx.view.config.set=(key,value)=>{if(key==='manualVerticalGroupOrder')throw new Error('save failed');save(key,value);};
  await dropGroup(ctx,groupHeader(ctx,'note.team: B'),groupHeader(ctx,'note.team: A'));assert.deepEqual(stageColumns(ctx),[['note.team: A','note.team: B']]);assert.equal(ctx.options.manualVerticalGroupOrder,undefined);assert.match(globalThis.notices.at(-1),/save failed/);assert.equal(ctx.writes,0);
});

test('cancelled or refreshed group drags do not persist an order',()=>{
  for(const cancel of ['escape','refresh']) {
    const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();dragEvent(ctx,groupGrip(groupHeader(ctx,'note.team: B')),'dragstart',dataTransfer());assert.equal(ctx.view.boardOrder.active,true);
    if(cancel==='escape')ctx.dom.window.document.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));else ctx.view.onDataUpdated();assert.equal(ctx.view.boardOrder.active,false);assert.equal(ctx.options.manualVerticalGroupOrder,undefined);assert.equal(ctx.writes,0);
  }
});

test('manual group positions retain temporarily absent values when another value is repositioned',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();await dropGroup(ctx,groupHeader(ctx,'note.team: B'),groupHeader(ctx,'note.team: A'));assert.deepEqual(stageColumns(ctx),[['note.team: B','note.team: A']]);
  ctx.records.get('Note 3.md').fm.team='C';ctx.records.get('Note 4.md').fm.team='C';ctx.view.onDataUpdated();await dropGroup(ctx,groupHeader(ctx,'note.team: C'),groupHeader(ctx,'note.team: A'));assert.deepEqual(stageColumns(ctx),[['note.team: B','note.team: C','note.team: A']]);
  ctx.records.get('Note 3.md').fm.team='B';ctx.view.onDataUpdated();assert.deepEqual(stageColumns(ctx),[['note.team: B','note.team: C','note.team: A']]);assert.equal(ctx.writes,0);
});


test('reserved native summary settings load, persist and reopen independently of custom view options',async()=>{
  const ctx=setup();summaryAPI(ctx);const saved={'note.priority':'Sum'},doc=ctx.dom.window.document;
  ctx.view.config.getSummaryKey=property=>saved[property]??null;
  ctx.view.config.setSummaryKey=(property,key)=>{if(key===null)delete saved[property];else saved[property]=key;};
  ctx.view.onDataUpdated();assert.equal(totalSummary(ctx),'6');assert.equal(ctx.options.summaries,undefined);
  doc.querySelector('button[aria-label="Summarize note.priority"]').click();[...doc.querySelectorAll('.mock-menu button')].find(button=>button.textContent==='None').click();await settle(ctx);
  assert.deepEqual(saved,{});assert.equal(totalSummary(ctx),undefined);
  doc.querySelector('button[aria-label="Summarize note.priority"]').click();[...doc.querySelectorAll('.mock-menu button')].find(button=>button.textContent==='Sum').click();await settle(ctx);
  assert.deepEqual(saved,{'note.priority':'Sum'});assert.equal(ctx.options.summaries,undefined);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},doc.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.equal(totalSummary(ctx),'6');assert.equal(ctx.writes,0);
});


test('view decimal precision survives reopen without writes and controls fractional insertion',async()=>{
  const ctx=setup([1,1.1,3]);ctx.options.orderDecimals='2';ctx.view.onDataUpdated();assert.equal(ctx.writes,0);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.equal(ctx.writes,0);
  await ctx.view.move('Note 3.md','Note 2.md',false,0);
  assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),[1,1.1,1.05]);assert.equal(ctx.writes,1);
  await ctx.plugin.undo();assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),[1,1.1,3]);
  ctx.options.orderDecimals='0';ctx.view.onDataUpdated();const before=ctx.writes;
  await ctx.view.move('Note 3.md','Note 2.md',false,0);assert.equal(ctx.writes-before,2);
  assert.ok([...ctx.plugin.undoReceipt.changes].every(change=>Number.isInteger(change.after)));
  await ctx.plugin.undo();assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),[1,1.1,3]);
});
test('multi-row drops preserve destination anchors and unchanged-position drops write nothing',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.options.orderDecimals='1';ctx.view.onDataUpdated();
  await ctx.view.moveRowsToGroup(['Note 3.md'],ctx.view.groupTargets.find(target=>target.rows.some(row=>row.path==='Note 3.md')),{path:'Note 4.md',below:false});assert.equal(ctx.writes,0);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  await dropRows(ctx,'Note 1.md',cell(ctx,'Note 4.md','file.name').closest('tr'));
  assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),[3.3,3.6,3,4]);assert.equal(ctx.writes,2);
  await ctx.plugin.undoEdit();assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),[1,2,3,4]);
});


const viewPaths=ctx=>ctx.view.groups.flat().map(row=>row.path);
function viewStorage(ctx){ctx.options.orderStorage='view';ctx.view.onDataUpdated();}
test('Base view ordering saves once, reads/writes no notes, preserves cells and supports undo',async()=>{
  const ctx=setup();viewStorage(ctx);let reads=0,saves=0;ctx.app.vault.read=async()=>{reads++;throw new Error('Unexpected note read');};
  const set=ctx.view.config.set;ctx.view.config.set=(key,value)=>{if(key==='manualViewRanks')saves++;set(key,value);};
  const table=ctx.dom.window.document.querySelector('table');
  await ctx.view.move('Note 3.md','Note 2.md',false,0);
  assert.equal(reads,0);assert.equal(ctx.writes,0);assert.equal(saves,1);assert.equal(ctx.options.manualViewRanks['Note 3.md'],1.5);
  assert.deepEqual(viewPaths(ctx),['Note 1.md','Note 3.md','Note 2.md']);assert.equal(ctx.dom.window.document.querySelector('table'),table);
  assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),[1,2,3]);
  await ctx.plugin.undo();assert.equal(ctx.options.manualViewRanks,undefined);assert.deepEqual(viewPaths(ctx),['Note 1.md','Note 2.md','Note 3.md']);assert.equal(ctx.writes,0);
});
test('Base view order reopens, is independent per view and leaves note-mode ranks unchanged',async()=>{
  const ctx=setup();viewStorage(ctx);await ctx.view.move('Note 3.md','Note 2.md',false,0);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();
  assert.deepEqual(viewPaths(ctx),['Note 1.md','Note 3.md','Note 2.md']);
  ctx.options.orderStorage='note';ctx.view.onDataUpdated();assert.deepEqual(viewPaths(ctx),['Note 1.md','Note 2.md','Note 3.md']);
  ctx.options.orderStorage='view';ctx.view.onDataUpdated();assert.deepEqual(viewPaths(ctx),['Note 1.md','Note 3.md','Note 2.md']);
  const host=ctx.dom.window.document.createElement('div');ctx.dom.window.document.body.append(host);const other=new ManualOrderView({app:ctx.app},host,ctx.plugin);
  other.config={...config,get:key=>key==='manualViewRanks'?undefined:config.get(key)};other.data=data;other.onDataUpdated();assert.deepEqual(other.groups.flat().map(row=>row.path),['Note 1.md','Note 2.md','Note 3.md']);assert.equal(ctx.writes,0);other.unload();
});
test('view ranks survive filters and new query results append until manually positioned',async()=>{
  const ctx=setup([1,2,3,0]);ctx.view.data.data=ctx.entries.slice(0,3);ctx.view.data.groupedData=[{entries:ctx.entries.slice(0,3),hasKey:()=>false}];viewStorage(ctx);
  await ctx.view.move('Note 3.md','Note 2.md',false,0);const hidden=ctx.options.manualViewRanks['Note 2.md'];
  ctx.view.data.data=[ctx.entries[0],ctx.entries[2]];ctx.view.data.groupedData=[{entries:ctx.view.data.data,hasKey:()=>false}];ctx.view.onDataUpdated();await ctx.view.move('Note 3.md','Note 1.md',false,0);
  assert.equal(ctx.options.manualViewRanks['Note 2.md'],hidden);
  ctx.view.data.data=ctx.entries;ctx.view.data.groupedData=[{entries:ctx.entries,hasKey:()=>false}];ctx.view.onDataUpdated();assert.deepEqual(viewPaths(ctx),['Note 3.md','Note 1.md','Note 2.md','Note 4.md']);assert.equal(ctx.writes,0);
});
test('non-numeric note ranks do not prevent Base view ordering or get overwritten',async()=>{
  const ctx=setup(['high','low','medium']);viewStorage(ctx);assert.equal(ctx.view.valid,true);
  await ctx.view.move('Note 3.md','Note 1.md',false,0);assert.deepEqual(viewPaths(ctx),['Note 3.md','Note 1.md','Note 2.md']);assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),['high','low','medium']);assert.equal(ctx.writes,0);
});
test('failed Base view saves restore visible order and conflicting settings block undo',async()=>{
  const ctx=setup();viewStorage(ctx);const save=ctx.view.config.set;ctx.view.config.set=(key,value)=>{if(key==='manualViewRanks')throw new Error('disk full');save(key,value);};
  await ctx.view.move('Note 3.md','Note 2.md',false,0);assert.deepEqual(viewPaths(ctx),['Note 1.md','Note 2.md','Note 3.md']);assert.equal(ctx.options.manualViewRanks,undefined);assert.match(globalThis.notices.at(-1),/disk full/);
  ctx.view.config.set=save;await ctx.view.move('Note 3.md','Note 2.md',false,0);ctx.options.manualViewRanks={...ctx.options.manualViewRanks,'Note 3.md':9};ctx.view.onDataUpdated();await ctx.plugin.undo();assert.equal(ctx.options.manualViewRanks['Note 3.md'],9);assert.match(globalThis.notices.at(-1),/view order changed/);assert.equal(ctx.writes,0);
});
test('renames migrate saved view ranks and reorder undo follows the renamed file',async()=>{
  const ctx=setup();viewStorage(ctx);await ctx.view.move('Note 2.md','Note 1.md',false,0);
  await ctx.view.editCell(ctx.entries[1],'file.name');editorInput(ctx).value='Renamed.md';await ctx.view.editor.save();
  assert.equal(ctx.options.manualViewRanks['Renamed.md'],0);assert.equal(ctx.options.manualViewRanks['Note 2.md'],undefined);
  await ctx.plugin.undo();assert.equal(ctx.options.manualViewRanks,undefined);assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority).sort(),[1,2,3]);
});
test('positioned group moves save view order and membership together and undo both',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];viewStorage(ctx);
  rowGrip(ctx,'Note 1.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));rowGrip(ctx,'Note 2.md').dispatchEvent(new ctx.dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  await dropRows(ctx,'Note 1.md',cell(ctx,'Note 4.md','file.name').closest('tr'));
  assert.deepEqual([...ctx.records.values()].map(record=>record.fm.priority),[1,2,3,4]);assert.equal(ctx.writes,2);
  assert.equal(ctx.options.manualViewRanks['Note 1.md'],3.33);assert.equal(ctx.options.manualViewRanks['Note 2.md'],3.66);
  await ctx.plugin.undoEdit();assert.equal(ctx.options.manualViewRanks,undefined);assert.equal(ctx.records.get('Note 1.md').fm.team,'A');assert.equal(ctx.records.get('Note 2.md').fm.team,'A');
});
test('failed group property writes roll view ordering back without adding undo history',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];viewStorage(ctx);ctx.app.fileManager.processFrontMatter=async()=>{throw new Error('write failed');};
  await dropRows(ctx,'Note 1.md',cell(ctx,'Note 4.md','file.name').closest('tr'));
  assert.equal(ctx.options.manualViewRanks,undefined);assert.equal(ctx.records.get('Note 1.md').fm.team,'A');assert.equal(ctx.plugin.editHistory.length,0);
});
test('note ordering reads a bounded number of changed notes and anchors in a large group',async()=>{
  const ctx=setup(Array.from({length:250},(_,i)=>i+1));let reads=0;const read=ctx.app.vault.read;ctx.app.vault.read=async file=>{reads++;return read(file);};
  await ctx.view.move('Note 250.md','Note 2.md',false,0);assert.equal(ctx.writes,1);assert.ok(reads<=7,`expected bounded reads, received ${reads}`);assert.equal(ctx.records.get('Note 250.md').fm.priority,1.5);
});

test('saved Base view ranks are pruned for deleted files on the next move',async()=>{
  const ctx=setup([1,2,3,4]);viewStorage(ctx);await ctx.view.move('Note 3.md','Note 2.md',false,0);assert.equal(ctx.options.manualViewRanks['Note 4.md'],4);
  ctx.records.delete('Note 4.md');ctx.view.data.data=ctx.entries.slice(0,3);ctx.view.data.groupedData=[{entries:ctx.view.data.data,hasKey:()=>false}];ctx.view.onDataUpdated();
  await ctx.view.move('Note 3.md','Note 1.md',false,0);assert.equal(ctx.options.manualViewRanks['Note 4.md'],undefined);assert.equal(ctx.writes,0);
});
test('descending Base view ordering uses fractional ranks without changing note ranks',async()=>{
  const ctx=setup();ctx.options.orderDirection='desc';viewStorage(ctx);await ctx.view.move('Note 1.md','Note 2.md',false,0);
  assert.equal(ctx.options.manualViewRanks['Note 1.md'],2.5);assert.deepEqual(viewPaths(ctx),['Note 3.md','Note 1.md','Note 2.md']);assert.equal(ctx.writes,0);
});
test('failed undo of group membership restores the saved view order and retains history',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];viewStorage(ctx);await dropRows(ctx,'Note 1.md',cell(ctx,'Note 4.md','file.name').closest('tr'));
  const saved=structuredClone(ctx.options.manualViewRanks);ctx.records.get('Note 1.md').fm.team='External';await ctx.plugin.undoEdit();
  assert.deepEqual(ctx.options.manualViewRanks,saved);assert.equal(ctx.records.get('Note 1.md').fm.team,'External');assert.equal(ctx.plugin.editHistory.length,1);
});

test('a failed rank migration does not turn an already successful file rename into a failed note edit',async()=>{
  const ctx=setup();viewStorage(ctx);await ctx.view.move('Note 2.md','Note 1.md',false,0);const save=ctx.view.config.set;
  ctx.view.config.set=(key,value)=>{if(key==='manualViewRanks')throw new Error('read-only Base');save(key,value);};
  await ctx.view.editCell(ctx.entries[1],'file.name');editorInput(ctx).value='Renamed.md';assert.equal(await ctx.view.editor.save(),true);
  assert.equal(ctx.records.has('Renamed.md'),true);assert.equal(ctx.plugin.editHistory.length,1);assert.ok(globalThis.notices.some(message=>/rank could not be saved/.test(message)));
});


function addCatalogueValue(ctx,property,text){const form=valueMenu(ctx,property).querySelector('form');form.querySelector('input').value=text;form.dispatchEvent(new ctx.dom.window.Event('submit',{cancelable:true}));}
test('horizontal group values can be added, remain when unused, and survive reopen',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.view.onDataUpdated();addCatalogueValue(ctx,'note.team','Future');await settle(ctx);
  assert.ok(groupHeader(ctx,'note.team: Future'));assert.equal(groupHeader(ctx,'note.team: Future').querySelector('.manual-order-group-count').textContent,'0');
  for(const record of ctx.records.values())record.fm.team='B';ctx.view.onDataUpdated();assert.ok(groupHeader(ctx,'note.team: A'));assert.equal(ctx.writes,0);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.ok(groupHeader(ctx,'note.team: A'));assert.ok(groupHeader(ctx,'note.team: Future'));
});
test('removing used group values changes only the view and explicit re-add restores their notes',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc',layout:'vertical'}];ctx.view.onDataUpdated();
  valueMenu(ctx,'note.team').querySelector('[aria-label="Remove group A"]').click();await settle(ctx);assert.equal(groupHeader(ctx,'note.team: A'),undefined);assert.equal(valueMenu(ctx,'note.team').querySelector('[aria-label="Remove group A"]'),null);assert.equal(ctx.writes,0);assert.equal(ctx.records.get('Note 1.md').fm.team,'A');
  ctx.view.onDataUpdated();assert.equal(groupHeader(ctx,'note.team: A'),undefined);
  const {config,data}=ctx.view;ctx.view.unload();ctx.view=new ManualOrderView({app:ctx.app},ctx.dom.window.document.getElementById('view'),ctx.plugin);ctx.view.config=config;ctx.view.data=data;ctx.view.onDataUpdated();assert.equal(groupHeader(ctx,'note.team: A'),undefined);
  addCatalogueValue(ctx,'note.team','A');await settle(ctx);assert.ok(groupHeader(ctx,'note.team: A'));assert.equal(ctx.view.groups.flat().length,4);assert.equal(ctx.writes,0);
});
test('an empty filtered Base can add and remove horizontal and nested group destinations',async()=>{
  const ctx=setup([]);ctx.options.manualGroups=[{property:'note.team',direction:'asc'},{property:'note.status',direction:'asc'}];ctx.view.onDataUpdated();
  addCatalogueValue(ctx,'note.team','Project');await settle(ctx);addCatalogueValue(ctx,'note.status','Ready');await settle(ctx);assert.ok(groupHeader(ctx,'note.team: Project'));assert.ok(groupHeader(ctx,'note.status: Ready'));
  valueMenu(ctx,'note.status').querySelector('[aria-label="Remove group Ready"]').click();await settle(ctx);assert.equal(groupHeader(ctx,'note.status: Ready'),undefined);assert.equal(ctx.writes,0);
});
test('typed numeric values persist and duplicate additions stay deduplicated',async()=>{
  const ctx=setup([0,1]);ctx.options.manualGroups=[{property:'note.priority',direction:'asc'}];ctx.view.onDataUpdated();
  addCatalogueValue(ctx,'note.priority','2');await settle(ctx);addCatalogueValue(ctx,'note.priority','2');await settle(ctx);
  assert.equal(ctx.options.manualGroupValues['note.priority'].added.filter(value=>value===2).length,1);assert.ok(groupHeader(ctx,'note.priority: 0'));assert.ok(groupHeader(ctx,'note.priority: 2'));assert.equal(ctx.writes,0);
});
test('failed removal saves retain the previous catalogue and visible rows',async()=>{
  const ctx=groupedMoveFixture();ctx.options.manualGroups=[{property:'note.team',direction:'asc'}];ctx.view.onDataUpdated();const previous=structuredClone(ctx.options.manualGroupValues),save=ctx.view.config.set;
  ctx.view.config.set=(key,value)=>{if(key==='manualGroupValues')throw new Error('catalogue write failed');save(key,value);};
  valueMenu(ctx,'note.team').querySelector('[aria-label="Remove group A"]').click();await settle(ctx);assert.ok(groupHeader(ctx,'note.team: A'));assert.deepEqual(ctx.options.manualGroupValues,previous);assert.equal(ctx.writes,0);
});

test('No value groups persist as empty values and can be removed and explicitly restored',async()=>{
  const ctx=setup([undefined,2]);ctx.options.manualGroups=[{property:'note.priority',direction:'asc'}];ctx.view.onDataUpdated();assert.ok(groupHeader(ctx,'note.priority: No value'));
  valueMenu(ctx,'note.priority').querySelector('[aria-label="Remove group No value"]').click();await settle(ctx);assert.equal(groupHeader(ctx,'note.priority: No value'),undefined);
  valueMenu(ctx,'note.priority').querySelector('[aria-label="Add empty note.priority group"]').click();await settle(ctx);assert.ok(groupHeader(ctx,'note.priority: No value'));assert.equal(ctx.writes,0);
  assert.equal(ctx.options.manualGroupValues['note.priority'].known.some(value=>value==='No value'),false);
});
