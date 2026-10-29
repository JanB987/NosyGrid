import { type CellSnapshot, type CellValue, type EditorType, formatValue, parseEditorValue } from './editing';
import {Keymap,type App} from 'obsidian';
import {LinkSuggest} from './link-suggest';
import {wikilinkAt} from './link-syntax';
import {appendTextLink,bindSelectedLinkDrag} from './link-drag';

export interface EditorOptions {
  cell: HTMLElement;
  snapshot: CellSnapshot;
  type: EditorType;
  app?: App;
  onInput?:()=>void;
  save: (next: CellValue) => Promise<void>;
  close: (navigation: number) => void;
}

/** A single borderless input in the existing cell. Property types are resolved by the view. */
export class CellEditor {
  readonly element: HTMLElement;
  private input: HTMLInputElement | HTMLTextAreaElement;
  private error: HTMLElement;
  private pending?: Promise<boolean>;
  private closed = false;
  private initialValue: string;
  private initialChecked: boolean;
  private suggest?:LinkSuggest;
  private removeLinkDrag?:()=>void;
  private readonly linkClick=(event:Event)=>{
    const mouse=event as MouseEvent;
    if(this.closed || this.pending || !this.options.app || !Keymap.isModEvent(mouse))return;
    const position=this.input.selectionStart;
    if(position===null || position!==this.input.selectionEnd)return;
    const link=wikilinkAt(this.input.value,position);
    if(!link?.target)return;
    event.preventDefault();event.stopImmediatePropagation();this.suggest?.dismiss();
    void this.options.app.workspace.openLinkText(link.target,this.options.snapshot.path,Keymap.isModEvent(mouse));
  };

  constructor(private options: EditorOptions) {
    const {cell,snapshot,type} = options;
    // Keep the rendered value in flow so table auto-layout retains exactly the
    // same intrinsic column widths and row height. The input overlays that value.
    const textColor=cell.ownerDocument.defaultView?.getComputedStyle(cell).color;
    cell.addClass('is-editing');
    this.element=cell.createDiv({cls:'manual-order-editor'});
    if(textColor) this.element.style.color=textColor;
    this.element.onclick=event=>event.stopPropagation();
    const multiline=['text','list','yaml'].includes(type) && snapshot.property.startsWith('note.');
    this.input=multiline ? this.element.createEl('textarea') : this.element.createEl('input');
    this.input.className='manual-order-editor-input';
    this.input.setAttribute('aria-label',`Value for ${snapshot.property}`);
    if(multiline) (this.input as HTMLTextAreaElement).rows=1;
    else {
      const input=this.input as HTMLInputElement;
      input.type=({checkbox:'checkbox',date:'date',datetime:'datetime-local'} as Record<string,string>)[type]??'text';
      if(type==='number') input.inputMode='decimal';
      if(type==='datetime') input.step='1';
      if(type==='checkbox') input.checked=snapshot.value===true;
    }
    this.input.value=formatValue(snapshot.value,type);
    this.initialValue=this.input.value;
    this.initialChecked=(this.input as HTMLInputElement).checked;
    this.error=this.element.createDiv({cls:'manual-order-editor-error',attr:{role:'alert'}});
    this.error.hidden=true;
    this.input.oninput=()=>{this.error.hidden=true;this.input.removeAttribute('aria-invalid');options.onInput?.();};
    if(options.app && snapshot.property.startsWith('note.') && (type==='text'||type==='list')) {
      this.suggest=new LinkSuggest(options.app,this.input,snapshot.path);
      this.input.addEventListener('click',this.linkClick,true);
      this.removeLinkDrag=bindSelectedLinkDrag(this.input,options.app,snapshot.path);
    }
    this.element.onkeydown=event=>{
      if(event.isComposing || this.suggest?.handleKey(event))return;
      if(event.key==='Escape') {event.preventDefault();event.stopPropagation();this.cancel();}
      else if(event.key==='Tab') {event.preventDefault();event.stopPropagation();void this.save(event.shiftKey?-1:1);}
      else if(event.key==='Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();event.stopPropagation();void this.save();
      }
    };
    this.element.addEventListener('focusout',()=>queueMicrotask(()=>{
      if(!this.closed && !this.element.contains(this.element.ownerDocument.activeElement)) void this.save();
    }));
  }

  copyText():string {return this.options.type==='checkbox'?String((this.input as HTMLInputElement).checked):this.input.value;}

  focus(position?:number) {
    this.input.focus();
    if(this.input.type!=='checkbox') {
      const caret=position??this.input.value.length;
      try {this.input.setSelectionRange(caret,caret);} catch { /* Date controls manage their own selection. */ }
    }
  }

  save(navigation=0, explicit?:CellValue): Promise<boolean> {
    if(this.closed) return Promise.resolve(true);
    if(this.pending) return this.pending;
    const run=async()=>{
      try {
        if(!explicit && this.input.value===this.initialValue && (this.input as HTMLInputElement).checked===this.initialChecked) {
          this.closed=true;this.dispose();this.options.close(navigation);return true;
        }
        if(!explicit && !this.input.validity.valid) throw new Error('Complete the value or clear the field before saving.');
        const next=explicit??parseEditorValue(this.input.value,this.options.type,(this.input as HTMLInputElement).checked);
        this.input.readOnly=true;
        this.suggest?.close();
        await this.options.save(next);
        this.closed=true;this.dispose();this.options.close(navigation);
        return true;
      } catch(error) {
        this.input.readOnly=false;
        this.input.setAttribute('aria-invalid','true');
        this.error.setText(error instanceof Error ? error.message : String(error));
        this.error.hidden=false;
        this.input.focus();
        return false;
      }
    };
    this.pending=run().finally(()=>{this.pending=undefined;});
    return this.pending;
  }

  async addLink(link:string):Promise<boolean> {
    if(this.pending)await this.pending;
    if(this.closed||this.options.type!=='text')return false;
    this.input.value=appendTextLink(this.input.value,link);
    this.suggest?.close();return this.save();
  }

  cancel() {if(!this.pending && !this.closed) {this.closed=true;this.dispose();this.options.close(0);}}
  dispose() {this.closed=true;this.removeLinkDrag?.();this.input.removeEventListener('click',this.linkClick,true);this.suggest?.destroy();this.suggest=undefined;}
}
