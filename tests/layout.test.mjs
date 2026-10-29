import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,access} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import path from 'node:path';

const candidates=[process.env.OBSIDIAN_TEST_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
let executablePath;
for(const candidate of candidates) {try {await access(candidate);executablePath=candidate;break;} catch {}}

test('real browser: stable cell dimensions and autocomplete mouse/keyboard focus', {skip:!executablePath}, async()=>{
  await mkdir('test-build',{recursive:true});
  await build({entryPoints:['src/cell-editor.ts'],bundle:true,platform:'browser',format:'iife',globalName:'EditorModule',outfile:'test-build/editor-browser.js',alias:{obsidian:path.resolve('tests/obsidian-mock.mjs')}});
  const browser=await chromium.launch({executablePath,headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:800}});
    const styles=await readFile('styles.css','utf8');
    await page.setContent(`<style>
      :root {--font-ui-small:14px;--text-normal:#ddd;--interactive-accent:#888;--background-primary:#222;--background-modifier-border:#444;}
      body {font:16px/1.5 Arial;background:#222;color:#ddd;}
      input,textarea {min-width:200px;height:30px;padding:4px;border:1px solid gray;}
      ${styles}
    </style><div class="manual-order-bases"><table class="manual-order-table"><thead><tr><th>Name</th><th>Value</th><th>Other</th></tr></thead><tbody>
    <tr><td class="manual-order-editable">Note 1 <button class="manual-order-rename">✎</button></td><td class="manual-order-editable" id="target">Original value</td><td>Other column</td></tr>
    <tr><td>Note 2</td><td>A longer value that also affects the column width</td><td>Some other long column content</td></tr>
    </tbody></table></div>`);
    await page.addScriptTag({path:path.resolve('test-build/editor-browser.js')});
    await page.evaluate(()=>{
      HTMLElement.prototype.createEl=function(tag,options={}){const el=document.createElement(tag);if(options.cls)el.className=options.cls;if(options.text)el.textContent=options.text;for(const [k,v] of Object.entries(options.attr??{}))el.setAttribute(k,v);this.append(el);return el;};
      HTMLElement.prototype.createDiv=function(options){return this.createEl('div',options);};
      HTMLElement.prototype.addClass=function(...classes){this.classList.add(...classes);};
      HTMLElement.prototype.setText=function(text){this.textContent=text;};
      window.dimensions=()=>[...document.querySelectorAll('table,th,td,tr')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
    });
    for(const [type,value] of [['text','Original value'],['number',123],['date','2026-10-28'],['datetime','2026-10-28T09:30'],['list',['alpha','beta','gamma']],['yaml',{nested:{a:1,b:true}}]]) {
      const result=await page.evaluate(({type,value})=>{
        const cell=document.getElementById('target');
        cell.textContent=Array.isArray(value)?value.join(', '):String(value);
        const original=cell.innerHTML;
        const before=window.dimensions();
        const editor=new EditorModule.CellEditor({cell,snapshot:{property:'note.test',value,exists:true},type,save:async()=>{},close:()=>{cell.innerHTML=original;cell.classList.remove('is-editing');}});
        editor.focus();
        const focused=window.dimensions();
        const input=cell.querySelector('input,textarea');
        if(type==='text'||type==='list'||type==='yaml') input.value='Long draft '.repeat(50)+'\nAnother line\nAnother line';
        input.dispatchEvent(new Event('input',{bubbles:true}));
        const typing=window.dimensions();
        const inputRect=input.getBoundingClientRect(),cellRect=cell.getBoundingClientRect();
        editor.cancel();
        return {before,focused,typing,after:window.dimensions(),inputFits:inputRect.width<=cellRect.width && inputRect.height<=cellRect.height};
      },{type,value});
      assert.deepEqual(result.focused,result.before,`${type}: focus must not resize the table`);
      assert.deepEqual(result.typing,result.before,`${type}: typing must not resize the table`);
      assert.deepEqual(result.after,result.before,`${type}: cancel must restore the same dimensions`);
      assert.equal(result.inputFits,true,`${type}: input must fit inside the cell`);
    }
    for(const type of ['text','list']) {
      const before=await page.evaluate(type=>{
        const cell=document.getElementById('target');cell.textContent='First [[Target 1]] then';
        window.saved=null;
        const files=[{path:'Target 1.md',basename:'Target 1'},{path:'Target 2.md',basename:'Target 2'}];
        window.opened=[];
        const app={vault:{getFiles:()=>files},metadataCache:{getFileCache:()=>({}),fileToLinktext:file=>file.basename},workspace:{openLinkText:async(...args)=>{window.opened.push(args);}}};
        window.editor=new EditorModule.CellEditor({app,cell,snapshot:{path:'Source.md',property:'note.links',value:type==='list'?['First [[Target 1]] then']:'First [[Target 1]] then',exists:true},type,save:async next=>{window.saved=next;},close:()=>{cell.textContent='Closed';cell.classList.remove('is-editing');}});
        window.editor.focus();return window.dimensions();
      },type);
      await page.locator('.manual-order-editor-input').fill('[[Target 2]]');
      const linkPoint=await page.locator('.manual-order-editor-input').evaluate(input=>{
        const canvas=document.createElement('canvas');const context=canvas.getContext('2d');
        const style=getComputedStyle(input);context.font=style.font;
        const lineHeight=parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.5;
        return {x:Math.min(input.clientWidth-2,context.measureText('[[Tar').width+1),y:Math.min(input.clientHeight/2,lineHeight/2)};
      });
      await page.locator('.manual-order-editor-input').click({position:linkPoint,modifiers:['Control']});
      assert.deepEqual(await page.evaluate(()=>window.opened),[['Target 2','Source.md',true]],'modifier-click opens the raw link in the editor');
      assert.equal(await page.evaluate(()=>window.saved),null);
      await page.locator('.manual-order-editor-input').fill('First [[Target 1]] then [[Target 2');
      await page.locator('.manual-order-link-suggestions [role=option]').first().click();
      assert.equal(await page.locator('.manual-order-editor-input').inputValue(),'First [[Target 1]] then [[Target 2]]');
      assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('manual-order-editor-input')),true);
      assert.equal(await page.evaluate(()=>window.saved),null,'choosing with the mouse must not blur-save');
      assert.deepEqual(await page.evaluate(()=>window.dimensions()),before,'popup and inserted link must not affect table dimensions');
      await page.locator('.manual-order-editor-input').fill('First [[Target 1]] then [[Target 2]] and [[Target 1');
      await page.locator('.manual-order-editor-input').press('Enter');
      assert.equal(await page.locator('.manual-order-editor-input').inputValue(),'First [[Target 1]] then [[Target 2]] and [[Target 1]]');
      assert.equal(await page.evaluate(()=>window.saved),null);
      await page.locator('.manual-order-editor-input').press('Enter');
      assert.deepEqual(await page.evaluate(()=>window.saved),{exists:true,value:type==='list'?['First [[Target 1]] then [[Target 2]] and [[Target 1]]']:'First [[Target 1]] then [[Target 2]] and [[Target 1]]'});
      assert.equal(await page.locator('.manual-order-link-suggestions').count(),0);
    }
  } finally {await browser.close();}
});
