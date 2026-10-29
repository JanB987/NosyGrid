import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
await build({entryPoints:['src/board-alignment.ts'],outfile:'test-build/board-alignment.mjs',format:'esm'});
const {BoardAlignment,collectBoardPlans}=await import(pathToFileURL(`${process.cwd()}/test-build/board-alignment.mjs`));
const node=(property,value,children=[])=>({key:`${property}:${value}`,property,label:value,rows:[],children,bindings:[{property,sourcePath:'Note.md',value:{exists:true,value}}]});
const stage=value=>node('note.stage',value),identity=group=>group.key,compare=(a,b)=>a.label.localeCompare(b.label);
test('native primary boards preserve the order supplied by Bases before manual overrides',()=>{
  const groups=[{...stage('Waiting'),property:undefined},{...stage('Ready'),property:undefined}];const plans=collectBoardPlans(groups,()=>true,identity,compare);assert.deepEqual([...plans.values()][0].slots,['note.stage:Waiting','note.stage:Ready']);
});
test('column slots use the sorted union of values across horizontal parents',()=>{
  const groups=[node('note.team','A',[stage('Ready'),stage('Waiting')]),node('note.team','B',[stage('Waiting')]),node('note.team','C',[stage('Backlog'),stage('Ready')])];
  const plans=collectBoardPlans(groups,group=>group.property==='note.stage',identity,compare);assert.equal(plans.size,1);assert.deepEqual([...plans.values()][0],{count:3,slots:['note.stage:Backlog','note.stage:Ready','note.stage:Waiting']});
});
test('parallel vertical ancestors keep separate alignment scopes',()=>{
  const groups=[node('note.project','P1',[node('note.team','A',[stage('Ready')]),node('note.team','B',[stage('Waiting')])]),node('note.project','P2',[node('note.team','A',[stage('Blocked')]),node('note.team','B',[stage('Done')])])];
  const plans=collectBoardPlans(groups,group=>group.property!=='note.team',identity,compare);const scopes=[...plans.values()].filter(plan=>plan.count===2);assert.equal(scopes.length,2);assert.deepEqual(scopes[0].slots,['note.stage:Ready','note.stage:Waiting']);assert.deepEqual(scopes[1].slots,['note.stage:Blocked','note.stage:Done']);
});
test('shared grids reserve missing slots without adding artificial groups',()=>{
  const dom=new JSDOM('<div id="a"><section class="manual-order-board-column" data-group-width-key="Ready"></section><section class="manual-order-board-column" data-group-width-key="Waiting"></section></div><div id="b"><section class="manual-order-board-column" data-group-width-key="Backlog"></section><section class="manual-order-board-column" data-group-width-key="Waiting"></section></div>');
  const a=dom.window.document.getElementById('a'),b=dom.window.document.getElementById('b'),widths=new Map([['Backlog',400],['Ready',500],['Waiting',700]]),alignment=new BoardAlignment(key=>widths.get(key));
  alignment.begin(new Map([['stage',{count:2,slots:['Backlog','Ready','Waiting']}]]));alignment.register(a,'stage');alignment.register(b,'stage');alignment.update();
  assert.equal(a.style.gridTemplateColumns,'400px 500px 700px');assert.equal(b.style.gridTemplateColumns,a.style.gridTemplateColumns);assert.deepEqual([...a.children].map(column=>column.style.gridColumn),['2','3']);assert.deepEqual([...b.children].map(column=>column.style.gridColumn),['1','3']);assert.equal(a.children.length,2);assert.equal(b.children.length,2);
});
test('collapse reserves the expanded matching track until every displayed match is collapsed',()=>{
  const dom=new JSDOM('<div id="a"><section class="manual-order-board-column is-board-collapsed" data-group-width-key="Ready"></section></div><div id="b"><section class="manual-order-board-column" data-group-width-key="Ready"></section></div>'),a=dom.window.document.getElementById('a'),b=dom.window.document.getElementById('b');
  const alignment=new BoardAlignment(()=>500);alignment.begin(new Map([['stage',{count:2,slots:['Ready']}]]));alignment.register(a,'stage');alignment.register(b,'stage');alignment.update();assert.equal(a.style.gridTemplateColumns,'500px');
  b.firstElementChild.classList.add('is-board-collapsed');alignment.update();assert.equal(a.style.gridTemplateColumns,'44px');assert.equal(b.style.gridTemplateColumns,'44px');
});
test('live explicit width previews update all aligned tracks and a single board keeps its ordinary layout',()=>{
  const dom=new JSDOM('<div id="a"><section class="manual-order-board-column" data-group-width-key="Ready"></section></div><div id="b"><section class="manual-order-board-column" data-group-width-key="Ready"></section></div>'),a=dom.window.document.getElementById('a'),b=dom.window.document.getElementById('b');
  const alignment=new BoardAlignment(()=>500);alignment.begin(new Map([['stage',{count:2,slots:['Ready']}]]));alignment.register(a,'stage');alignment.register(b,'stage');for(const board of [a,b])board.firstElementChild.style.setProperty('--manual-order-column-width','380px');alignment.update();assert.equal(a.style.gridTemplateColumns,'380px');assert.equal(b.style.gridTemplateColumns,'380px');
  const single=dom.window.document.createElement('div');alignment.begin(new Map([['stage',{count:1,slots:['Ready']}]]));alignment.register(single,'stage');alignment.update();assert.equal(single.classList.contains('manual-order-aligned-board'),false);
});
