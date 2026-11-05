import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/property-paste.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/property-paste.mjs'});
const {PropertyPaste,nativeListTarget}=await import(pathToFileURL(`${process.cwd()}/test-build/property-paste.mjs`));
const links='[[North/Shared.md]]\n[[South/Shared.md]]\n[[South/Review (draft).md]]';
function fixture(type='text') {
 const dom=new JSDOM(`<div class="metadata-property" data-property-key="example"><div class="metadata-property-value" data-property-type="${type}"><div contenteditable="true" class="${type==='text'?'metadata-input-longtext':'multi-select-input'}"></div></div></div><div contenteditable="true" id="body"></div>`);
 const doc=dom.window.document,target=doc.querySelector('[data-property-type] > div'),messages=[],saved=[];let clock=1;
 let native;const adapter=new PropertyPaste(message=>messages.push(message),()=>clock,element=>nativeListTarget({workspace:{iterateAllLeaves:visit=>{if(native)visit({view:native});}}},element));adapter.bind(doc);adapter.remember(links);
 return {dom,doc,target,messages,saved,adapter,installList:(values=[])=>{
   const value=target.parentElement,root=doc.createElement('div');root.className='multi-select-container';value.append(root);root.append(target);
   const widget={inputEl:target,rootEl:root,values:[...values],setValues(next){this.values=[...next];saved.push([...next]);return this;}};
   native={metadataEditor:{rendered:[{containerEl:target.closest('.metadata-property'),rendered:{type:'multitext',multiselect:widget}}]}};
   return widget;
 },advance:()=>{clock+=120001;}};
}
function paste(ctx,target,text=links){const event=new ctx.dom.window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=>text}});target.dispatchEvent(event);return event;}
function select(ctx,start,end=start){const range=ctx.doc.createRange(),node=ctx.target.firstChild;range.setStart(node,start);range.setEnd(node,end);const selection=ctx.doc.getSelection();selection.removeAllRanges();selection.addRange(range);}
test('simulated native Text widget commits every link at the selection',()=>{
 const ctx=fixture();ctx.target.textContent='before REPLACE after';select(ctx,7,14);
 // Simulate the native widget: its input listener observes the draft and blur commits it.
 let draft='';ctx.target.addEventListener('input',()=>{draft=ctx.target.textContent;});ctx.target.addEventListener('blur',()=>ctx.saved.push(draft));
 const event=paste(ctx,ctx.target,links.replaceAll('\n','\r\n'));assert.equal(event.defaultPrevented,true);
 ctx.target.dispatchEvent(new ctx.dom.window.Event('blur'));
 assert.equal(ctx.saved[0],'before [[North/Shared.md]] [[South/Shared.md]] [[South/Review (draft).md]] after');
});
test('native List adapter commits all copied links with existing items in one update',()=>{
 const ctx=fixture('multitext'),widget=ctx.installList(['existing','other']);let nativePastes=0;
 ctx.target.addEventListener('paste',()=>nativePastes++);
 assert.equal(paste(ctx,ctx.target).defaultPrevented,true);assert.equal(nativePastes,0);
 assert.deepEqual(widget.values,['existing','other',...links.split('\n')]);assert.deepEqual(ctx.saved,[widget.values]);assert.equal(ctx.messages.length,0);
});
test('List paste preserves unselected draft text as items around the links',()=>{
 const ctx=fixture('multitext'),widget=ctx.installList(['existing']);ctx.target.textContent='before REPLACE after';select(ctx,7,14);
 paste(ctx,ctx.target,links.replaceAll('\n','\r\n'));
 assert.deepEqual(widget.values,['existing','before',...links.split('\n'),'after']);assert.equal(ctx.target.textContent,'');assert.equal(ctx.saved.length,1);
});
test('unknown List widgets and unsafe caret positions preserve drafts',()=>{
 let ctx=fixture('multitext');ctx.target.textContent='pending';paste(ctx,ctx.target);assert.equal(ctx.target.textContent,'pending');assert.match(ctx.messages[0],/List editor safely/);
 ctx=fixture('multitext');const widget=ctx.installList(['existing']);ctx.target.textContent='pending';paste(ctx,ctx.target);assert.deepEqual(widget.values,['existing']);assert.equal(ctx.target.textContent,'pending');assert.equal(ctx.saved.length,0);
});
test('List adapter resolves the exact property DOM owner rather than another pane',()=>{
 const ctx=fixture('multitext');ctx.installList(['correct']);
 const property=ctx.target.closest('.metadata-property'),root=ctx.target.closest('.multi-select-container');
 const wrong={values:['wrong'],inputEl:ctx.target,rootEl:root,setValues(){throw new Error('wrong widget');}};
 const found=nativeListTarget({workspace:{iterateAllLeaves:visit=>{
  visit({view:{metadataEditor:{rendered:[{containerEl:ctx.doc.querySelector('#body'),rendered:{type:'multitext',multiselect:wrong}}]}}});
  visit({view:{metadataEditor:{rendered:[{containerEl:property,rendered:{type:'multitext',multiselect:{...wrong,values:['correct'],setValues(){}}}}]}}});
 }}},ctx.target);
 assert.deepEqual(found.values,['correct']);
});
test('List callback failures restore the draft and existing widget values',()=>{
 const ctx=fixture('multitext'),widget=ctx.installList(['existing']);ctx.target.textContent='draft';select(ctx,5);
 const original=widget.setValues;widget.setValues=function(next){if(next.length>1)throw new Error('native failure');return original.call(this,next);};
 paste(ctx,ctx.target);assert.deepEqual(widget.values,['existing']);assert.equal(ctx.target.textContent,'draft');assert.match(ctx.messages[0],/native failure/);
});
test('duplicate List handlers insert once and single-link paste remains native',()=>{
 const ctx=fixture('multitext'),widget=ctx.installList(['existing']);ctx.adapter.bind(ctx.doc);paste(ctx,ctx.target);assert.equal(ctx.saved.length,1);assert.equal(widget.values.length,4);
 const single='[[North/Shared.md]]';ctx.adapter.remember(single);assert.equal(paste(ctx,ctx.target,single).defaultPrevented,false);
});

test('body paste, ordinary data, unsupported widgets, expired or replaced clipboard stay native',()=>{
 for(const text of ['ordinary\nlines','[[North/Shared.md]]\t[[South/Shared.md]]']) {const ctx=fixture();assert.equal(paste(ctx,ctx.target,text).defaultPrevented,false);}
 let ctx=fixture();assert.equal(paste(ctx,ctx.doc.querySelector('#body')).defaultPrevented,false);
 ctx=fixture('number');assert.equal(paste(ctx,ctx.target).defaultPrevented,false);
 ctx=fixture();ctx.advance();assert.equal(paste(ctx,ctx.target).defaultPrevented,false);
 ctx=fixture();ctx.doc.dispatchEvent(new ctx.dom.window.Event('copy',{bubbles:true}));assert.equal(paste(ctx,ctx.target).defaultPrevented,false);
});
test('missing selection blocks lossy paste and duplicate handlers process the event once',()=>{
 const ctx=fixture();ctx.adapter.bind(ctx.doc);let inputs=0;ctx.target.addEventListener('input',()=>inputs++);
 assert.equal(paste(ctx,ctx.target).defaultPrevented,true);assert.match(ctx.messages[0],/caret/);
 ctx.target.textContent='X';select(ctx,1);assert.equal(paste(ctx,ctx.target).defaultPrevented,true);assert.equal(inputs,1);assert.equal(ctx.target.textContent,`X ${links.replaceAll('\n',' ')}`);
});
