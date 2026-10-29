import { Plugin, BasesView, Notice, Keymap, Menu, parseYaml, getFrontMatterInfo, setIcon,
  type QueryController, type BasesEntry, type BasesPropertyId, type Value, type TFile, type BasesAllOptions } from 'obsidian';
import { applyChanges, numericRank, planMove, propertyName, sortRows, type Change, type Row, type Direction } from './order';
import { editableProperty, readCell, readCells, writeCell, sameValue, inferType, parsePropertyTypes, formatValue, renameTarget, type CellSnapshot, type CellValue, type EditorType } from './editing';
import { CellEditor } from './cell-editor';
import {renderPropertyLinks} from './link-render';
import {RowLayout,ROW_HEIGHT_KEY} from './row-layout';
import {ListCellEditor} from './list-cell-editor';
import {appendLinkValue,clearLinkDropTargets,hasLinkDrag,linkForDestination,makeLinkDraggable,readLinkDrag,type DraggedLink} from './link-drag';
import {CellSelection} from './cell-selection';
import {mapClipboard,parseClipboard,parsePastedValue,serializeClipboard} from './clipboard';
import {applyCellBatch,type CellChange,type CellEdit} from './batch-edit';
import {GROUPS_KEY,COLLAPSED_KEY,NATIVE_LAYOUT_KEY,readGroupRules,groupRows,groupValueKey,type RowGroup} from './grouping';
import {renderGroupMenu} from './group-menu';
import {NativeGroupMenu} from './native-group-menu';
import {ROW_DRAG_TYPE,nativeGroupProperty,nativeGroupScope,nativeGroupValue,rebaseGroupValue,groupIdentity,type GroupBinding} from './group-move';
import {RETAINED_GROUPS_KEY,retainGroups,type DisplayGroup} from './retained-groups';
import {BoardLayout,BOARD_WIDTHS_KEY,linkedBoardWidthKey} from './board-layout';
import {RowDragScroll} from './row-drag-scroll';
import {RowDragPreview} from './row-drag-preview';
import {BoardAlignment,boardScopeKey,collectBoardPlans} from './board-alignment';
import {BoardOrder,BOARD_ORDER_KEY,readBoardOrders,applyBoardOrder} from './board-order';
import {GROUP_VALUES_KEY,readValueSettings,addGroupValues,type ValueSection} from './group-values';
import {renderValueMenu} from './group-values-menu';
import {completeVerticalGroups} from './continuous-groups';
import {GROUP_COLORS_KEY,readGroupColors,applyGroupColors} from './group-colors';
import {Summaries,readViewSummaries,setViewSummary,summaryMenu} from './summaries';

import {expectRecord,fileProperties,boardProperty} from './validation';
import {caretRangeAtPoint} from './caret-position';

const VIEW = 'manual-order-table';
interface TableRow extends Row { entry: BasesEntry }
interface GroupTarget {key:string;bindings:GroupBinding[];rows:TableRow[];leaf:boolean;nativeId?:string;unknownNative?:boolean}
interface Receipt { property: string; changes: Change[]; originals: Map<string, {exists:boolean; value:unknown}>; baseline?: Row[] }
type EditHistory=CellEdit|{changes:CellEdit[]};

export default class ManualOrderPlugin extends Plugin {
  private availabilityTimer?:number;
  busy = false;
  batchWriting=false;
  views = new Set<ManualOrderView>();
  undoReceipt?: Receipt;
  editorOwner?: ManualOrderView;
  editHistory: EditHistory[] = [];
  cellOverrides = new Map<string,{snapshot:CellSnapshot; until:number}>();
  propertyTypes = new Map<string,EditorType>();
  private inferredTypes = new Map<string,EditorType>();
  // Bridge the delay between a successful write and Bases' metadata refresh.
  pending = new Map<string, {property:string; rank:number|undefined}>();

  async onload() {
    await this.loadPropertyTypes();
    this.registerHoverLinkSource('manual-order-bases',{display:'NosyGrid',defaultMod:true});
    const registered = this.registerBasesView(VIEW, {
      name: 'NosyGrid', icon: 'list-ordered',
      factory: (controller, container) => new ManualOrderView(controller, container, this),
      options: ():BasesAllOptions[] => [
        {type:'text',key:'orderProperty',displayName:'Ordering property',default:'priority',placeholder:'priority'},
        {type:'dropdown',key:'orderDirection',displayName:'Order direction',default:'asc',options:{asc:'A → Z (lowest first)',desc:'Z → A (highest first)'}},
        {type:'dropdown',key:NATIVE_LAYOUT_KEY,displayName:'Primary group layout',default:'horizontal',options:{horizontal:'Horizontal groups',vertical:'Vertical board columns'}},
      ],
    });
    if (!registered) new Notice('NosyGrid: enable the Bases core plugin, then reload this plugin.');
    this.addCommand({id:'undo-reorder',name:'Undo last row reorder',callback:()=>void this.undo()});
    this.addCommand({id:'undo-cell-edit',name:'Undo last table cell edit',callback:()=>void this.undoEdit()});
    const availability=()=>{
      if(this.availabilityTimer!==undefined)window.clearTimeout(this.availabilityTimer);
      this.availabilityTimer=window.setTimeout(()=>{this.availabilityTimer=undefined;for(const view of this.views)view.refreshGroupAvailability();},150);
    };
    this.registerEvent(this.app.metadataCache.on('changed',availability));
    this.registerEvent(this.app.vault.on('delete',availability));
    this.registerEvent(this.app.vault.on('rename',availability));
    this.register(()=>{if(this.availabilityTimer!==undefined)window.clearTimeout(this.availabilityTimer);});
  }

  refresh() { for (const view of this.views) view.onDataUpdated(); }

  async loadPropertyTypes() {
    // The public API has no property-type accessor. Read Obsidian's saved definitions
    // through the public vault adapter; never change the global type configuration.
    if(!this.app.vault.adapter) return;
    const path=`${this.app.vault.configDir}/types.json`;
    try {
      this.propertyTypes=await this.app.vault.adapter.exists(path)
        ? parsePropertyTypes(await this.app.vault.adapter.read(path)) : new Map<string,EditorType>();
      this.inferredTypes.clear();
    } catch(error) { console.warn('NosyGrid: unable to read property types; keeping the last known definitions.',error); }
  }

  propertyType(property:BasesPropertyId, entries:BasesEntry[]): EditorType {
    if(!property.startsWith('note.')) return 'text';
    const name=property.slice(5);
    const defined=this.propertyTypes.get(name);
    if(defined) return defined;
    if(['tags','aliases','cssclasses'].includes(name)) return 'list';
    const cached=this.inferredTypes.get(name);
    if(cached) return cached;
    // Infer once per property across the vault, never from the clicked cell.
    const files=this.app.vault.getMarkdownFiles?.()??entries.map(entry=>entry.file);
    const sample=[...files].sort((a,b)=>a.path.localeCompare(b.path))
      .map(file=>fileProperties(this.app,file)[name])
      .find(value=>value!==undefined && value!==null && value!=='');
    const type=inferType(sample,name);
    if(sample!==undefined) this.inferredTypes.set(name,type);
    return type;
  }

  async commitCell(before:CellSnapshot, next:CellValue, record=true): Promise<CellSnapshot> {
    if(this.busy) throw new Error('Another change is saving. Please try again.');
    if(sameValue(before,next)) return before;
    this.busy=true;
    this.refresh();
    try {
      const after=await writeCell(this.app,before,next);
      this.recordSuccess({before,after});
      if(record)this.remember({before,after});
      return after;
    } finally {this.busy=false;this.refresh();}
  }

  private recordSuccess({before,after}:CellEdit) {
    if(before.property.startsWith('file.')) {
        if(before.path!==after.path)for(const view of this.views)view.renameRow(before.path,after.path);
        if(this.undoReceipt) {
          for(const change of this.undoReceipt.changes) if(change.path===before.path) change.path=after.path;
          const original=this.undoReceipt.originals.get(before.path);
          if(original) {this.undoReceipt.originals.delete(before.path);this.undoReceipt.originals.set(after.path,original);}
        }
        // Older edit receipts refer to the same TFile, but require its new location.
        for(const history of this.editHistory)for(const receipt of 'changes' in history?history.changes:[history])for(const snapshot of [receipt.before,receipt.after]) {
          if(snapshot.file===before.file&&snapshot.property.startsWith('note.'))snapshot.path=after.path;
        }
        this.pending.delete(before.path);
      } else {
        this.cellOverrides.set(`${after.path}\0${after.property}`,{snapshot:after,until:Date.now()+2500});
        if(after.property===`note.${this.pending.get(after.path)?.property}`) this.pending.delete(after.path);
      }
  }
  private remember(history:EditHistory) {this.editHistory.push(history);if(this.editHistory.length>50)this.editHistory.shift();}

  async commitBatch(changes:CellChange[],record=true):Promise<CellEdit[]> {
    if(this.busy||this.editorOwner)throw new Error('Finish the active edit before pasting.');
    this.busy=true;this.refresh();this.batchWriting=true;
    try {
      const edits=await applyCellBatch(this.app,changes);
      // Migrate paths before installing note overlays, so they use the final filenames.
      for(const edit of edits.filter(edit=>edit.before.property.startsWith('file.')))this.recordSuccess(edit);
      for(const edit of edits.filter(edit=>edit.before.property.startsWith('note.')))this.recordSuccess(edit);
      if(record&&edits.length)this.remember({changes:edits});
      return edits;
    } catch(error) {
      for(const {before} of changes){this.cellOverrides.delete(`${before.file.path}\0${before.property}`);if(before.property===`note.${this.pending.get(before.file.path)?.property}`)this.pending.delete(before.file.path);}
      throw error;
    } finally {this.batchWriting=false;this.busy=false;this.refresh();}
  }

  async undoEdit() {
    if(this.busy || this.editorOwner) return;
    const receipt=this.editHistory.at(-1);
    if(!receipt) return;
    try {
      if('changes' in receipt)await this.commitBatch(receipt.changes.map(change=>({before:change.after,after:change.before})),false);
      else await this.commitCell(receipt.after,receipt.before,false);
      this.editHistory.pop();this.refresh();
      new Notice('Table cell edit undone.');
    } catch(error) {new Notice(`Could not undo: ${error instanceof Error?error.message:String(error)}`,8000);}
  }

  async execute(receipt: Receipt, undo = false) {
    if (this.busy || this.editorOwner) return;
    this.busy = true;
    this.refresh();
    const changes = undo ? receipt.changes.map(c=>({path:c.path,before:c.after,after:c.before})) : receipt.changes;
    try {
      // Check the entire group, including unchanged ranks that a concurrent edit could move.
      const checks = !undo && receipt.baseline
        ? receipt.baseline.map(row=>({path:row.path,before:row.rank})) : changes;
      for (const change of checks) {
        const file = this.app.vault.getFileByPath(change.path);
        if (!file || file.extension !== 'md') throw new Error(`Cannot write ${change.path}.`);
        const text = await this.app.vault.read(file);
        const info = getFrontMatterInfo(text);
        const parsed:unknown=info.exists ? parseYaml(info.frontmatter) ?? {} : {};
        const fm=expectRecord(parsed);
        if (numericRank(fm[receipt.property]) !== change.before) throw new Error(`${file.basename} changed. Please try again.`);
        if (!undo) receipt.originals.set(change.path,{exists:Object.hasOwn(fm,receipt.property),value:fm[receipt.property]});
      }
      await applyChanges(changes, async change => {
        const file = this.app.vault.getFileByPath(change.path);
        if (!file) throw new Error(`Missing note: ${change.path}`);
        await this.app.fileManager.processFrontMatter(file, (raw:unknown) => {
          const fm=expectRecord(raw);
          if (numericRank(fm[receipt.property]) !== change.before) throw new Error(`${file.basename} changed during the reorder.`);
          const original = receipt.originals.get(change.path);
          // Restore empty/null values exactly on undo or rollback.
          if (change.after === undefined && original?.exists) fm[receipt.property] = original.value;
          else if (change.after === undefined) delete fm[receipt.property];
          else fm[receipt.property] = change.after;
        });
      });
      for (const c of changes) {
        this.pending.set(c.path,{property:receipt.property,rank:c.after});
        this.cellOverrides.delete(`${c.path}\0note.${receipt.property}`);
      }
      this.undoReceipt = undo ? undefined : receipt;
      new Notice(undo ? 'Row reorder undone.' : `Updated ${changes.length} note${changes.length===1?'':'s'}.`);
    } catch (error) {
      console.error('NosyGrid', error);
      new Notice(`NosyGrid: ${error instanceof Error ? error.message : String(error)}`,10000);
    } finally { this.busy=false; this.refresh(); }
  }

  async undo() {
    if (this.undoReceipt) await this.execute(this.undoReceipt,true);
    else new Notice('No row reorder to undo in this session.');
  }
}

export class ManualOrderView extends BasesView {
  readonly type = VIEW;
  private root: HTMLElement;
  private drag?: {path:string;paths:string[]; group:number; revision:number};
  private revision = 0;
  private groups: TableRow[][] = [];
  private groupTargets:GroupTarget[]=[];
  private selectedRows=new Set<string>();
  private rowAnchor?:string;
  private readonly rowSelectionPointer=(event:MouseEvent)=>{
    const handle=(event.target as Element)?.closest?.<HTMLButtonElement>('.manual-order-handle');
    if(handle&&this.root.contains(handle)&&!handle.disabled) {
      this.selection.clear();
      const path=handle.closest<HTMLElement>('tr')?.dataset.rowPath;
      if(path&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!this.selectedRows.has(path))this.selectRow(path,event);
      return;
    }
    if(this.selectedRows.size){this.selectedRows.clear();this.rowAnchor=undefined;this.paintRowSelection();}
  };
  private readonly rowSelectionClick=(event:MouseEvent)=>{
    if(!(event.target as Element)?.closest?.('.manual-order-handle')||!this.root.contains(event.target as Node))this.rowSelectionPointer(event);
  };
  private movingRows=false;
  private property = 'priority';
  private direction: Direction = 'asc';
  private valid = true;
  private editor?: CellEditor|ListCellEditor;
  private loadingEditor=false;
  private disposed=false;
  private rowLayout:RowLayout;
  private selection:CellSelection;
  private pasting=false;
  private groupMenuOpen=false;
  private nativeGroupMenu:NativeGroupMenu;
  private boardScroll=new Map<string,number>();
  private boardLayout:BoardLayout;
  private boardAlignment:BoardAlignment;
  private boardOrder:BoardOrder;
  private valueSections:ValueSection[]=[];
  private valueMenuOpen=new Set<string>();
  private rowDragScroll:RowDragScroll;
  private rowDragPreview:RowDragPreview;
  private rowDropPending=false;
  private renderedLayout?:string;
  private renderedCells=new Map<string,string>();
  private summaries:Summaries;
  private readonly cancelRowDrag=(event?:Event)=>{
    if(event?.type==='keydown'&&(event as KeyboardEvent).key!=='Escape')return;
    if(this.rowDropPending||!this.drag)return;
    this.drag=undefined;this.rowDragPreview.stop();this.rowDragScroll.unlock();this.clearIndicators();
  };
  get orderingProperty() {return this.property;}

  constructor(controller: QueryController, parent: HTMLElement, private plugin: ManualOrderPlugin) {
    super(controller);
    this.root = parent.createDiv({cls:'manual-order-bases'});
    this.rowDragScroll=new RowDragScroll(this.root);
    this.rowDragPreview=new RowDragPreview(this.root);this.register(()=>this.rowDragPreview.destroy());
    this.summaries=new Summaries(this.root,controller,this.app,()=>readViewSummaries(this.config,this.summaryColumns()),property=>this.config.getDisplayName(property),(property,event)=>this.openSummaryMenu(property,event));
    this.boardOrder=new BoardOrder(this.root,()=>this.config.get(BOARD_ORDER_KEY),value=>this.config.set(BOARD_ORDER_KEY,value),()=>this.onDataUpdated(),error=>new Notice(`Could not save group positions: ${String(error)}`),()=>!this.plugin.busy&&!this.plugin.editorOwner&&!this.movingRows&&!this.rowDropPending&&!this.boardLayout.active);
    const doc=this.root.ownerDocument;
    doc.addEventListener('pointerdown',this.rowSelectionPointer,true);doc.addEventListener('click',this.rowSelectionClick,true);
    this.register(()=>{doc.removeEventListener('pointerdown',this.rowSelectionPointer,true);doc.removeEventListener('click',this.rowSelectionClick,true);});
    doc.addEventListener('dragend',this.cancelRowDrag,true);doc.addEventListener('drop',this.cancelRowDrag);doc.addEventListener('keydown',this.cancelRowDrag,true);doc.defaultView?.addEventListener('blur',this.cancelRowDrag);
    this.register(()=>{doc.removeEventListener('dragend',this.cancelRowDrag,true);doc.removeEventListener('drop',this.cancelRowDrag);doc.removeEventListener('keydown',this.cancelRowDrag,true);doc.defaultView?.removeEventListener('blur',this.cancelRowDrag);});
    this.nativeGroupMenu=new NativeGroupMenu(this.root,host=>this.renderGroupControls(host,true));
    this.selection=new CellSelection(this.root);
    this.root.addEventListener('paste',this.onPaste,true);
    this.root.addEventListener('copy',this.onCopy,true);
    this.rowLayout=new RowLayout(this.root,()=>this.config.get(ROW_HEIGHT_KEY),value=>this.config.set(ROW_HEIGHT_KEY,value),error=>new Notice(`Could not save row height: ${String(error)}`));
    this.boardAlignment=new BoardAlignment(key=>this.boardLayout.widthFor(key),()=>this.boardLayout.measure());
    this.boardLayout=new BoardLayout(this.root,()=>this.config.get(BOARD_WIDTHS_KEY),value=>this.config.set(BOARD_WIDTHS_KEY,value),()=>{this.rowLayout.measure();this.onDataUpdated();},error=>new Notice(`Could not save group width: ${String(error)}`),()=>!this.plugin.busy&&!this.movingRows&&!this.loadingEditor&&!this.boardOrder.active,()=>this.boardAlignment.update());
    plugin.views.add(this);
    this.register(()=>{ this.disposed=true; this.boardOrder.destroy();this.rowDragScroll.destroy(); this.boardAlignment.destroy(); this.boardLayout.destroy(); this.nativeGroupMenu.destroy(); this.editor?.dispose(); this.rowLayout.destroy(); this.selection.destroy(); if(plugin.editorOwner===this) plugin.editorOwner=undefined; plugin.views.delete(this); this.root.remove(); });
  }

  onDataUpdated() {
    if (!this.data || this.disposed) return;
    this.updateLiveControls();
    if(this.editor || this.loadingEditor || this.plugin.batchWriting || this.plugin.busy)return;
    if(this.boardLayout.active){this.boardLayout.deferRefresh();return;}
    this.boardOrder.cancel();
    this.cancelRowDrag();
    if(this.patchCells())return;
    this.revision++;
    const active=this.root.ownerDocument.activeElement as HTMLElement|null;
    const focusedGroup=active&&this.root.contains(active)&&active.matches('.manual-order-group-header,.manual-order-column-resize,.manual-order-group-move')?{key:active.closest<HTMLElement>('[data-group-key]')?.dataset.groupKey,selector:active.classList.contains('manual-order-column-resize')?':scope > .manual-order-column-resize':active.classList.contains('manual-order-group-move')?':scope > .manual-order-group-header > .manual-order-group-move':':scope > .manual-order-group-header'}:undefined;
    this.selection.beforeRender();
    this.rowLayout.begin();
    this.boardLayout.begin();
    this.rowDragScroll.restore();
    const top=this.root.scrollTop, left=this.root.scrollLeft;
    for(const body of this.root.querySelectorAll<HTMLElement>('[data-group-scroll-key]'))this.boardScroll.set(body.dataset.groupScrollKey!,body.scrollLeft);
    this.root.empty();
    this.summaries.begin();
    this.valid=true;
    try { this.property=propertyName(this.config.get('orderProperty')); }
    catch (error) { this.valid=false; this.root.createDiv({cls:'manual-order-error',text:String(error)}); }
    this.direction=this.config.get('orderDirection')==='desc'?'desc':'asc';
    const bar=this.root.createDiv({cls:'manual-order-toolbar'});
    bar.createSpan({text:`${this.property} · ${this.direction==='asc'?'A → Z':'Z → A'} · ${this.data.data.length} notes`});
    const undo=bar.createEl('button',{text:'Undo reorder'});
    undo.disabled=this.plugin.busy || !!this.plugin.editorOwner || !this.plugin.undoReceipt;
    undo.onclick=()=>void this.plugin.undo();
    const undoEdit=bar.createEl('button',{text:'Undo edit'});
    undoEdit.disabled=this.plugin.busy || !!this.plugin.editorOwner || !this.plugin.editHistory.length;
    undoEdit.onclick=()=>void this.plugin.undoEdit();
    const rules=readGroupRules(this.config.get(GROUPS_KEY));
    if(!this.nativeGroupMenu.available) {
    const groupButton=bar.createEl('button',{text:`Groups${rules.length?` (${rules.length})`:''}`,attr:{'aria-expanded':String(this.groupMenuOpen)}});
    groupButton.disabled=this.plugin.busy;
    groupButton.onclick=()=>{
      void (async()=>{
        if(this.editor&&!(await this.editor.save()))return;
        this.groupMenuOpen=!this.groupMenuOpen;this.onDataUpdated();
      })();
    };
    if(this.groupMenuOpen)this.renderGroupControls(this.root.createDiv({cls:'manual-order-group-menu'}));
    }
    bar.createSpan({cls:'manual-order-hint',text:this.plugin.busy?'Saving…':'Click to edit · Drag across cells to select · Drag ⋮⋮ to reorder'});
    bar.createSpan({cls:'manual-order-row-selection-status'});
    const nativeRows = this.data.groupedData.map(group=>sortRows(group.entries.map(entry=> {
      let rank: number|undefined;
      try {
        // Read the underlying YAML type so strings like "1" are not silently overwritten.
        rank=numericRank(this.cellValue(entry,`note.${this.property}`).value);
      } catch { this.valid=false; }
      const pending=this.plugin.pending.get(entry.file.path);
      if (pending?.property===this.property) {
        if (pending.rank===rank) this.plugin.pending.delete(entry.file.path);
        else rank=pending.rank;
      }
      if (entry.file.extension!=='md') this.valid=false;
      return {path:entry.file.path,rank,entry};
    }),this.direction));
    if (!this.valid) this.root.createDiv({cls:'manual-order-error',text:'Reordering is unavailable. Choose a numeric note property and filter the Base to Markdown notes. Existing text values will not be overwritten.'});
    const columns=this.config.getOrder();
    const visible: BasesPropertyId[]=columns.length ? columns : ['file.name',`note.${this.property}`];
    this.groups=[];this.groupTargets=[];
    const savedCollapsed=this.config.get(COLLAPSED_KEY);
    const collapsed=new Set<string>(Array.isArray(savedCollapsed)?savedCollapsed.filter((key):key is string=>typeof key==='string'):[]);
    const value=(row:TableRow,property:BasesPropertyId):unknown=>property.startsWith('note.')?this.cellValue(row.entry,property).value:row.entry.getValue(property)?.toString();
    const renderTable=(rows:TableRow[],parent:HTMLElement,target:GroupTarget)=>{
      const groupIndex=this.groups.length;this.groups.push(rows);
      this.groupTargets.push(target);
      const table=parent.createEl('table',{cls:'manual-order-table'});
      if(parent!==this.root)table.style.minWidth=`${visible.length*120+38}px`;
      table.setAttribute('role','grid');table.setAttribute('aria-multiselectable','true');
      const header=table.createEl('thead').createEl('tr');
      header.createEl('th',{cls:'manual-order-handle-cell',attr:{'aria-label':'Row handles'}});
      for (const property of visible) {
        const th=header.createEl('th',{text:this.config.getDisplayName(property)});
        th.oncontextmenu=event=>{event.preventDefault();this.openSummaryMenu(property,event);};
        const summary=th.createEl('button',{cls:'manual-order-summary-trigger',attr:{'aria-label':`Summarize ${this.config.getDisplayName(property)}`,title:'Summarize…'}});setIcon(summary,'calculator');summary.onclick=event=>{event.stopPropagation();this.openSummaryMenu(property,event);};
      }
      const body=table.createEl('tbody');
      rows.forEach((row,index)=>this.renderRow(body,row,index,groupIndex,visible));
    };
    const decorate=(group:RowGroup<TableRow>,ancestors:GroupBinding[]=[],nativeValue?:Value,nativeId?:string,unknownNative=false):DisplayGroup<TableRow>=>{
      const bindings=[...ancestors];
      if(group.property&&group.rows[0])bindings.push(this.groupBinding(group.property,group.rows[0]));
      return {...group,bindings,nativeValue,nativeId,unknownNative,children:group.children.map(child=>decorate(child,bindings,undefined,nativeId,unknownNative))};
    };
    const groupWidthKey=(group:DisplayGroup<TableRow>)=>{
      const binding=group.property?[...group.bindings].reverse().find(binding=>binding.property===group.property):group.bindings[0];
      return binding?linkedBoardWidthKey(binding.property,groupValueKey(groupIdentity(binding.value.value,this.app,binding.sourcePath))):group.key;
    };
    const verticalGroup=(group:DisplayGroup<TableRow>)=>group.property?rules.find(rule=>rule.property===group.property)?.layout==='vertical':this.config.get(NATIVE_LAYOUT_KEY)==='vertical';
    const hiddenChildren=new Set<string>();
    const summaryEntries=(group:DisplayGroup<TableRow>):BasesEntry[]=>hiddenChildren.has(group.key)?[]:group.children.length?group.children.flatMap(summaryEntries):group.rows.map(row=>row.entry);
    const renderGroup=(group:DisplayGroup<TableRow>,parent:HTMLElement,depth:number,vertical=false,ancestors:string[]=[])=>{
      const {bindings,nativeValue,nativeId,unknownNative}=group;
      const target:GroupTarget={key:group.key,bindings,rows:group.rows,leaf:!group.children.length,nativeId,unknownNative};
      const section=parent.createDiv({cls:'manual-order-group-section'});
      if(vertical){section.classList.add('manual-order-board-column');section.setAttribute('role','listitem');}
      section.dataset.groupKey=group.key;section.style.setProperty('--manual-group-depth',String(depth));
      section.dataset.groupColorKey=groupWidthKey(group);
      section.dataset.groupDepth=String(depth);
      const closed=collapsed.has(group.key);
      // A focusable header container allows real links without nesting anchors in a button.
      const header=section.createDiv({cls:'manual-order-group-header',attr:{role:'button',tabindex:'0','aria-expanded':String(!closed)}});
      header.createSpan({cls:'manual-order-group-chevron',text:closed?'▸':'▾'});
      const label=header.createSpan({cls:'manual-order-group-label'});
      if(group.property)label.createSpan({text:`${this.config.getDisplayName(group.property)}: `});
      const display=label.createSpan({cls:'manual-order-group-value'});
      const displayBinding=group.property?[...bindings].reverse().find(binding=>binding.property===group.property):bindings[0];
      const source=displayBinding?.sourcePath??group.rows[0]?.entry.file.path??'';
      const raw=displayBinding?.property.startsWith('note.')?displayBinding.value.value:group.label;
      if(!renderPropertyLinks(display,raw,this.app,source)) {
        const evaluated=nativeValue??(group.property&&!group.property.startsWith('note.')?group.rows[0]?.entry.getValue(group.property):undefined);
        if(evaluated&&group.label!=='No value')evaluated.renderTo(display,this.app.renderContext);
        else display.setText(group.label);
      }
      header.createSpan({cls:'manual-order-group-count',text:String(group.rows.length)});
      this.summaries.group(header,summaryEntries(group));
      if(vertical){
        const widthKey=groupWidthKey(group);
        this.boardLayout.column(section,group.key,closed,label.textContent??group.label,widthKey);if(closed)header.title=label.textContent??group.label;
        this.boardOrder.column(section,boardScopeKey(group,ancestors),widthKey,label.textContent??group.label,header);
      }
      header.ondragover=event=>{
        if(!this.drag||this.drag.revision!==this.revision||this.plugin.busy)return;
        event.preventDefault();event.stopPropagation();this.clearIndicators();header.classList.add('manual-order-group-drop-target');
        this.scrollRowDrag(event);
        if(event.dataTransfer)event.dataTransfer.dropEffect='move';
      };
      header.ondragleave=()=>header.classList.remove('manual-order-group-drop-target');
      header.ondrop=event=>{
        if(!this.drag)return;
        event.preventDefault();event.stopPropagation();const drag=this.drag;this.drag=undefined;this.clearIndicators();
        if(drag.revision===this.revision)this.runRowDrop(()=>this.moveRowsToGroup(drag.paths,target));else {this.rowDragPreview.stop();this.rowDragScroll.unlock();}
      };
      section.ondragover=event=>{
          if(!this.drag||this.drag.revision!==this.revision||this.plugin.busy||(event.target as Element).closest('tr[data-row-path]'))return;
          event.preventDefault();event.stopPropagation();this.clearIndicators();section.classList.add('manual-order-group-drop-target');this.scrollRowDrag(event);
          if(event.dataTransfer)event.dataTransfer.dropEffect='move';
      };
      section.ondragleave=event=>{if(!section.contains(event.relatedTarget as Node))section.classList.remove('manual-order-group-drop-target');};
      section.ondrop=event=>{
          if(!this.drag||(event.target as Element).closest('tr[data-row-path]'))return;
          event.preventDefault();event.stopPropagation();const drag=this.drag;this.drag=undefined;this.clearIndicators();
          if(drag.revision===this.revision)this.runRowDrop(()=>this.moveRowsToGroup(drag.paths,target));else {this.rowDragPreview.stop();this.rowDragScroll.unlock();}
      };
      header.onclick=event=>{
        if((event.target as Element).closest('a,[role=link],button'))return;
        void (async()=>{
          if(this.editor&&!(await this.editor.save()))return;
          if(collapsed.has(group.key))collapsed.delete(group.key);else collapsed.add(group.key);
          try {this.config.set(COLLAPSED_KEY,collapsed.size?[...collapsed]:null);this.onDataUpdated();}
          catch(error){new Notice(`Could not save group state: ${String(error)}`);}
        })();
      };
      header.onkeydown=event=>{
        if(event.target!==header||!['Enter',' '].includes(event.key))return;
        event.preventDefault();header.click();
      };
      if(closed)return;
      const content=section.createDiv({cls:'manual-order-group-body'});
      if(vertical)content.dataset.groupScrollKey=group.key;
      if(hiddenChildren.has(group.key)){content.createDiv({cls:'manual-order-empty-group',text:'All group values are hidden. Show them in the Group menu.'});return;}
      if(group.children.length)renderGroups(group.children,content,depth+1,vertical?[...ancestors,groupWidthKey(group)]:ancestors);
      else {
        if(group.rows.length||vertical||section.closest('.manual-order-board-column'))renderTable(group.rows,content,target);
        if(!group.rows.length)content.createDiv({cls:'manual-order-empty-group',text:'No matching files. Drop rows here to move them into this group.'});
      }
    };
    const renderGroups=(groups:DisplayGroup<TableRow>[],parent:HTMLElement,depth:number,ancestors:string[]=[])=>{
      if(!groups.length)return;
      const property=groups[0].property;
      const vertical=verticalGroup(groups[0]);
      const host=vertical?parent.createDiv({cls:'manual-order-group-board',attr:{role:'list','aria-label':`${property?this.config.getDisplayName(property):'Primary'} groups`}}):parent;
      if(vertical)this.boardAlignment.register(host,boardScopeKey(groups[0],ancestors));
      const slots=vertical?this.boardOrder.slots(boardScopeKey(groups[0],ancestors)):[];
      const positions=new Map(slots.map((slot,index)=>[slot,index]));
      const ordered=vertical?[...groups].sort((a,b)=>(positions.get(groupWidthKey(a))??0)-(positions.get(groupWidthKey(b))??0)):groups;
      for(const group of ordered)renderGroup(group,host,depth,vertical,ancestors);
    };
    const hasNativeGroups=!!nativeGroupProperty(this.config)||this.data.groupedData.length>1||this.data.groupedData.some(group=>group.hasKey());
    const liveGroups:DisplayGroup<TableRow>[]=[];
    nativeRows.forEach((rows,index)=> {
      const native=this.data.groupedData[index];
      const nativeKey=native.key?.toString()??'';
      const nativeType=native.key?(native.key.constructor as typeof Value).type??'value':'empty';
      const parent=hasNativeGroups?['native',nativeType,nativeKey]:[];
      const children=groupRows(rows,rules,value,parent,(row,property,raw)=>groupIdentity(raw,this.app,row.path));
      const nativeProperty=nativeGroupProperty(this.config);
      const nativeBindings:GroupBinding[]=hasNativeGroups&&nativeProperty?[this.nativeBinding(nativeProperty,rows,native.key)]:[];
      if(hasNativeGroups)liveGroups.push(decorate({key:JSON.stringify(parent),label:nativeKey||'No value',rows,children},nativeBindings,native.key,JSON.stringify(parent),!nativeProperty));
      else if(children.length)for(const child of children)liveGroups.push(decorate(child));
      else if(!rules.length)renderTable(rows,this.root,{key:'ungrouped',bindings:[],rows,leaf:true});
    });
    const signature=JSON.stringify([nativeGroupScope(this.config),rules.map(rule=>rule.property)]);
    const indexes=new Map<string,Map<string,GroupBinding[]>>();
    const findVaultGroup=(bindings:GroupBinding[])=>{
      const properties=bindings.map(binding=>binding.property),schema=JSON.stringify(properties);
      const identity=(bindings:GroupBinding[])=>JSON.stringify(bindings.map(binding=>groupValueKey(groupIdentity(binding.value.value,this.app,binding.sourcePath))));
      let index=indexes.get(schema);
      if(!index) {
        index=new Map();indexes.set(schema,index);
        for(const file of this.app.vault.getMarkdownFiles()) {
          const values=properties.map(property=>this.vaultGroupBinding(file,property));
          if(values.some(value=>!value))continue;
          const found=values as GroupBinding[],key=identity(found);if(!index.has(key))index.set(key,found);
        }
      }
      return index.get(identity(bindings));
    };
    const valueSettings=readValueSettings(this.config.get(GROUP_VALUES_KEY));
    // A filtered/empty Base can still offer explicitly added outer columns.
    if(!liveGroups.length&&!hasNativeGroups&&rules[0]?.layout==='vertical') {
      const property=rules[0].property;
      for(const value of valueSettings[property]?.added??[]) {
        const token=groupValueKey(groupIdentity(value,this.app,''));
        liveGroups.push({key:JSON.stringify([property,token]),property,label:String(value),rows:[],children:[],bindings:[this.bindingValue(property,'',{exists:true,value})]});
      }
    }
    const saved=this.config.get(RETAINED_GROUPS_KEY);
    const retained=retainGroups(liveGroups,saved,signature,findVaultGroup);
    addGroupValues(retained.groups,valueSettings,verticalGroup,groupWidthKey,(template,value)=>{
      const property=template.property??template.bindings[0].property;
      const ancestors=template.bindings.filter(binding=>binding.property!==property);
      const binding=this.bindingValue(property,'',{exists:true,value});
      const token=groupValueKey(groupIdentity(value,this.app,''));
      const path=JSON.parse(template.key) as unknown[];
      const key=template.property?JSON.stringify([...path.slice(0,-1),token]):JSON.stringify(['native-added',property,token]);
      return {key,label:value===null||value===undefined||value===''?'No value':Array.isArray(value)?value.map(String).join(', '):String(value),property:template.property,bindings:[...ancestors,binding],rows:[],children:[],nativeId:template.property?template.nativeId:key};
    });
    const levels=[...(hasNativeGroups?[{property:nativeGroupProperty(this.config)??'native',vertical:this.config.get(NATIVE_LAYOUT_KEY)==='vertical'}]:[]),...rules.map(rule=>({property:rule.property,vertical:rule.layout==='vertical'}))];
    completeVerticalGroups(retained.groups,levels,groupWidthKey,(template,parent)=>{
      const property=template.property??template.bindings[0]?.property;
      const own=[...template.bindings].reverse().find(binding=>binding.property===property);
      const prefix=parent?JSON.parse(parent.key) as unknown[]:[];
      const token=own?groupValueKey(groupIdentity(own.value.value,this.app,own.sourcePath)):template.label;
      return {...template,key:JSON.stringify([...prefix,property??'native',token]),rows:[],children:[],
        bindings:[...(parent?.bindings??[]),...(own?[own]:[])],nativeId:parent?.nativeId??template.nativeId,unknownNative:parent?.unknownNative??template.unknownNative};
    });
    const compareGroups=(a:DisplayGroup<TableRow>,b:DisplayGroup<TableRow>)=>{
        const left=a.bindings.at(-1),right=b.bindings.at(-1);
        if(!left||!right)return a.label.localeCompare(b.label,undefined,{numeric:true});
        const order=typeof left.value.value==='number'&&typeof right.value.value==='number'?left.value.value-right.value.value:groupValueKey(groupIdentity(left.value.value,this.app,left.sourcePath)).localeCompare(groupValueKey(groupIdentity(right.value.value,this.app,right.sourcePath)),undefined,{numeric:true});
        return rules.find(rule=>rule.property===a.property)?.direction==='desc'?-order:order;
    };
    const sortGroups=(groups:DisplayGroup<TableRow>[])=>{
      if(groups.length&&groups.every(group=>group.property))groups.sort(compareGroups);
      for(const group of groups)sortGroups(group.children);
    };
    sortGroups(retained.groups);
    const boardPlans=collectBoardPlans(retained.groups,verticalGroup,groupWidthKey,compareGroups);
    for(const [scope,plan]of boardPlans) {
      const property=boardProperty(scope);
      plan.slots=applyBoardOrder(plan.slots,property?valueSettings[property]?.order:undefined);
    }
    this.boardOrder.begin(boardPlans);this.boardAlignment.begin(boardPlans);
    const sections=new Map<string,ValueSection>();
    const collectValues=(groups:DisplayGroup<TableRow>[],ancestors:string[]=[])=>{
      if(!groups.length)return;
      const vertical=verticalGroup(groups[0]),property=groups[0].property??groups[0].bindings[0]?.property;
      if(property) {
        const section=sections.get(property)??{property,items:[],scopes:[],vertical};sections.set(property,section);
        const scope=boardScopeKey(groups[0],ancestors);if(vertical&&!section.scopes.includes(scope))section.scopes.push(scope);
        for(const group of groups) {
          const id=groupWidthKey(group),existing=section.items.find(item=>item.id===id),binding=group.bindings.find(binding=>binding.property===property);
          if(existing)existing.count+=group.rows.length;
          else section.items.push({id,label:group.label,count:group.rows.length,value:binding?.value.value??group.label,source:binding?.sourcePath??''});
        }
      }
      for(const group of groups)collectValues(group.children,vertical?[...ancestors,groupWidthKey(group)]:ancestors);
    };
    collectValues(retained.groups);
    for(const rule of rules)if(!sections.has(rule.property))sections.set(rule.property,{property:rule.property,items:[],scopes:[],vertical:rule.layout==='vertical'});
    const primary=nativeGroupProperty(this.config);if(primary&&!sections.has(primary))sections.set(primary,{property:primary,items:[],scopes:[],vertical:this.config.get(NATIVE_LAYOUT_KEY)==='vertical'});
    this.valueSections=[...sections.values()];
    for(const section of this.valueSections) {
      const order=applyBoardOrder(section.items.map(item=>item.id),this.boardOrder.slots(section.scopes[0]));
      section.items.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    }
    // Hidden values stay in the catalogue and order settings, but reserve no board space.
    const hideValues=(groups:DisplayGroup<TableRow>[])=>{
      for(let i=0;i<groups.length;) {
        const group=groups[i],property=group.property??group.bindings[0]?.property;
        if(verticalGroup(group)&&property&&valueSettings[property]?.hidden.includes(groupWidthKey(group)))groups.splice(i,1);
        else{const hadChildren=group.children.length>0;hideValues(group.children);if(hadChildren&&!group.children.length)hiddenChildren.add(group.key);i++;}
      }
    };
    hideValues(retained.groups);
    for(const [scope,plan]of boardPlans) {
      const hidden=valueSettings[boardProperty(scope)??'']?.hidden??[];plan.slots=plan.slots.filter(id=>!hidden.includes(id));
    }
    const menu=this.root.querySelector<HTMLElement>('.manual-order-group-menu');if(menu){menu.empty();this.renderGroupControls(menu);}
    this.nativeGroupMenu.refresh();
    renderGroups(retained.groups,this.root,0);
    this.summaries.total(hasNativeGroups||rules.length?retained.groups.flatMap(summaryEntries):nativeRows.flat().map(row=>row.entry));
    this.summaries.refresh(this.data,visible);
    applyGroupColors(this.root,readGroupColors(this.config.get(GROUP_COLORS_KEY)));
    if(JSON.stringify(saved??null)!==JSON.stringify(retained.memory)) {
      try {this.config.set(RETAINED_GROUPS_KEY,retained.memory);}
      catch(error){new Notice(`Could not save known groups: ${String(error)}`);}
    }
    if (!this.data.data.length) this.root.createDiv({cls:'manual-order-empty',text:'No notes match this Base.'});
    this.boardAlignment.update();this.boardLayout.measure();this.rowLayout.measure();
    for(const body of this.root.querySelectorAll<HTMLElement>('[data-group-scroll-key]'))body.scrollLeft=this.boardScroll.get(body.dataset.groupScrollKey!)??0;
    this.selection.refresh();
    const visibleRows=new Set([...this.root.querySelectorAll<HTMLElement>('tr[data-row-path]')].map(row=>row.dataset.rowPath!));
    this.selectedRows=new Set([...this.selectedRows].filter(path=>visibleRows.has(path)));
    this.paintRowSelection();
    this.root.scrollTop=top; this.root.scrollLeft=left;
    if(focusedGroup?.key) {
      const section=[...this.root.querySelectorAll<HTMLElement>('[data-group-key]')].find(section=>section.dataset.groupKey===focusedGroup.key);
      section?.querySelector<HTMLElement>(focusedGroup.selector)?.focus({preventScroll:true});
    }
    this.rowDragScroll.restore();
    this.renderedLayout=this.layoutStamp();
    this.renderedCells.clear();
    const renderedRows=new Map(this.groups.flat().map(row=>[row.path,row]));
    for(const cell of this.root.querySelectorAll<HTMLElement>('td[data-property]')) {
      const row=renderedRows.get(cell.dataset.path!);
      if(row)this.renderedCells.set(`${row.path}\0${cell.dataset.property}`,this.cellStamp(row.entry,cell.dataset.property as BasesPropertyId));
    }
    this.updateLiveControls();
  }

  /** Separate query/layout changes from value changes; no DOM teardown for an ordinary edit. */
  private layoutStamp():string {
    const rules=readGroupRules(this.config.get(GROUPS_KEY)),primary=nativeGroupProperty(this.config);
    const properties=[...new Set([...rules.map(rule=>rule.property),...(primary?[primary]:[])])];
    const value=(entry:BasesEntry,property:BasesPropertyId)=>property.startsWith('note.')?this.cellValue(entry,property):entry.getValue(property)?.toString();
    return JSON.stringify([
      ['orderProperty','orderDirection',GROUPS_KEY,COLLAPSED_KEY,NATIVE_LAYOUT_KEY,BOARD_WIDTHS_KEY,BOARD_ORDER_KEY,GROUP_VALUES_KEY,RETAINED_GROUPS_KEY].map(key=>this.config.get(key)),
      this.config.getOrder().map(id=>[id,this.config.getDisplayName(id)]),this.groupMenuOpen,nativeGroupScope(this.config),
      this.data.data.map(entry=>entry.file.path).sort(),this.data.data.every(entry=>this.rankState(entry).valid),
      this.data.groupedData.map(group=>[group.key?.toString(),group.hasKey(),group.entries.map(entry=>[entry.file.path,entry.file.name,properties.map(property=>value(entry,property))]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]),
      // Empty retained groups depend on evidence outside the Base as well.
      properties.length?this.app.vault.getMarkdownFiles().map(file=>[file.path,properties.map(property=>this.vaultGroupBinding(file,property)?.value)]):[],
    ]);
  }

  private cellStamp(entry:BasesEntry,property:BasesPropertyId):string {
    return JSON.stringify([property.startsWith('note.')?this.cellValue(entry,property):undefined,this.plugin.propertyType(property,this.data.data),entry.getValue(property)?.toString(),property===`note.${this.property}`?this.rankState(entry).rank:undefined]);
  }

  private rankState(entry:BasesEntry):{rank:number|undefined;valid:boolean} {
    try {
      const rank=numericRank(this.cellValue(entry,`note.${this.property}`).value),pending=this.plugin.pending.get(entry.file.path);
      return {rank:pending?.property===this.property?pending.rank:rank,valid:entry.file.extension==='md'};
    } catch{return {rank:undefined,valid:false};}
  }

  private patchCells():boolean {
    if(!this.renderedLayout||this.renderedLayout!==this.layoutStamp())return false;
    this.rowLayout.syncHeights();
    const entries=new Map(this.data.data.map(entry=>[entry.file.path,entry]));
    const rows=new Map(this.groups.flat().map(row=>[row.path,row]));
    // Existing event handlers capture these row objects; keep their Bases entries current.
    for(const row of rows.values()){const entry=entries.get(row.path);if(entry){row.entry=entry;row.rank=this.rankState(entry).rank;}}
    let changed=false;
    for(const cell of this.root.querySelectorAll<HTMLElement>('td[data-property]')) {
      const row=rows.get(cell.dataset.path!),property=cell.dataset.property as BasesPropertyId;if(!row)continue;
      const key=`${row.path}\0${property}`,stamp=this.cellStamp(row.entry,property);
      if(this.renderedCells.get(key)===stamp)continue;
      if(!changed)this.selection.beforeRender();
      this.rowLayout.forgetCell(cell);
      const replacement=this.renderCell(cell.closest<HTMLTableRowElement>('tr')!,row,property);
      cell.replaceWith(replacement);this.renderedCells.set(key,stamp);changed=true;
    }
    const elements=new Map([...this.root.querySelectorAll<HTMLTableRowElement>('tr[data-row-path]')].map(row=>[row.dataset.rowPath!,row]));
    for(const group of this.groups) {
      const next=sortRows(group,this.direction);if(next.every((row,index)=>row===group[index]))continue;
      if(!changed)this.selection.beforeRender();changed=true;
      group.splice(0,group.length,...next);
      const body=elements.get(group[0].path)?.parentElement;if(!body)continue;
      next.forEach((row,index)=>{const element=elements.get(row.path)!;if(body.children[index]!==element)body.insertBefore(element,body.children[index]??null);});
    }
    if(changed)this.selection.refresh();
    this.rowLayout.measure();this.boardLayout.measure();
    applyGroupColors(this.root,readGroupColors(this.config.get(GROUP_COLORS_KEY)));
    this.summaries.refresh(this.data,this.summaryColumns());
    this.updateLiveControls();return true;
  }

  private summaryColumns():BasesPropertyId[] {const columns=this.config.getOrder();return columns.length?columns:['file.name',`note.${this.property}`];}
  private openSummaryMenu(property:BasesPropertyId,event:MouseEvent) {
    const sample=this.data.data.map(entry=>entry.getValue(property)).find(value=>value&&(value.constructor as typeof Value).type!=='null');
    const type=(sample?.constructor as typeof Value|undefined)?.type??this.plugin.propertyType(property,this.data.data);
    summaryMenu(this.app,property,this.config.getDisplayName(property),type,readViewSummaries(this.config,[property])[property],event,key=>{
      void (async()=>{
        if(this.editor&&!(await this.editor.save()))return;
        try{setViewSummary(this.config,property,key);this.onDataUpdated();}catch(error){new Notice(`Could not save summary: ${String(error)}`);}
      })();
    });
  }

  private updateLiveControls() {
    const locked=this.plugin.busy||!!this.plugin.editorOwner;
    const toolbar=this.root.querySelector('.manual-order-toolbar');
    for(const button of toolbar?.querySelectorAll<HTMLButtonElement>('button')??[]) {
      if(button.textContent==='Undo reorder')button.disabled=locked||!this.plugin.undoReceipt;
      else if(button.textContent==='Undo edit')button.disabled=locked||!this.plugin.editHistory.length;
    }
    const hint=toolbar?.querySelector<HTMLElement>('.manual-order-hint');if(hint)hint.setText(this.plugin.busy?'Saving…':'Click to edit · Drag across cells to select · Drag ⋮⋮ to reorder');
    const handles=new Map([...this.root.querySelectorAll<HTMLButtonElement>('.manual-order-handle')].map(handle=>[handle.closest<HTMLElement>('tr')?.dataset.rowPath,handle]));
    for(const [index,rows]of this.groups.entries())for(const row of rows) {
      const handle=handles.get(row.path);
      if(handle){handle.disabled=locked;handle.draggable=!locked&&!!(this.valid||this.groupTargets[index]?.bindings.length);}
    }
    for(const checkbox of this.root.querySelectorAll<HTMLInputElement>('td[data-property] input[type=checkbox]'))checkbox.disabled=locked;
    for(const handle of this.root.querySelectorAll<HTMLButtonElement>('.manual-order-group-move')) {
      const scope=handle.closest('.manual-order-board-column')?.parentElement?.dataset.boardAlignmentKey;
      handle.disabled=locked||!scope||this.boardOrder.slots(scope).length<2;handle.draggable=!handle.disabled;
    }
  }

  private renderGroupControls(host:HTMLElement,native=false) {
    if(!this.data||this.disposed)return;
    const rules=readGroupRules(this.config.get(GROUPS_KEY));
    const settings=readValueSettings(this.config.get(GROUP_VALUES_KEY));
    const renderValues=(section:ValueSection,target:HTMLElement)=>{
      const current=settings[section.property]??{hidden:[],added:[],order:[]};
      renderValueMenu(target,section,current,this.config.getDisplayName(section.property),(element,item)=>{
        if(!renderPropertyLinks(element,item.value,this.app,item.source))element.setText(item.label);
      },(next,reorder)=>{
        void (async()=>{
          if(this.editor&&!(await this.editor.save()))return;
          const previous=this.config.get(GROUP_VALUES_KEY),previousOrder=this.config.get(BOARD_ORDER_KEY);
          try {
            if(reorder) {
              const orders=readBoardOrders(previousOrder);for(const scope of section.scopes)orders.set(scope,next.order);
              this.config.set(BOARD_ORDER_KEY,Object.fromEntries(orders));
            }
            this.config.set(GROUP_VALUES_KEY,{...settings,[section.property]:next});this.onDataUpdated();this.nativeGroupMenu.refresh();
          } catch(error) {
            try{this.config.set(GROUP_VALUES_KEY,previous??null);this.config.set(BOARD_ORDER_KEY,previousOrder??null);}catch(rollbackError){console.error('NosyGrid: could not restore view settings.',rollbackError);}
            new Notice(`Could not save group values: ${String(error)}`);this.onDataUpdated();this.nativeGroupMenu.refresh();
          }
        })();
      },text=>parsePastedValue(text,this.plugin.propertyType(section.property,this.data.data)).value,error=>new Notice(`Could not add group: ${String(error)}`),{
        get:id=>readGroupColors(this.config.get(GROUP_COLORS_KEY))[id],
        set:(id,color)=>{
          void (async()=>{
            if(this.editor&&!(await this.editor.save()))return;
            const previous=this.config.get(GROUP_COLORS_KEY),colors=readGroupColors(previous);
            if(color)colors[id]=color;else delete colors[id];
            try{this.config.set(GROUP_COLORS_KEY,Object.keys(colors).length?colors:null);this.onDataUpdated();}
            catch(error){try{this.config.set(GROUP_COLORS_KEY,previous??null);}catch(rollbackError){console.error('NosyGrid: could not restore view settings.',rollbackError);}new Notice(`Could not save group color: ${String(error)}`);applyGroupColors(this.root,readGroupColors(previous));}
            const menu=this.root.querySelector<HTMLElement>('.manual-order-group-menu');if(menu){menu.empty();this.renderGroupControls(menu);}this.nativeGroupMenu.refresh();
          })();
        },
      });
      const details=target.lastElementChild as HTMLDetailsElement;details.open=this.valueMenuOpen.has(section.property);
      details.ontoggle=()=>{if(!details.isConnected)return;if(details.open)this.valueMenuOpen.add(section.property);else this.valueMenuOpen.delete(section.property);};
    };
    if(readBoardOrders(this.config.get(BOARD_ORDER_KEY)).size) {
      const reset=host.createEl('button',{text:'Reset vertical group positions',cls:'manual-order-reset-group-order'});
      reset.onclick=()=>{
        void (async()=>{
          if(this.editor&&!(await this.editor.save()))return;
          try{this.config.set(BOARD_ORDER_KEY,null);this.config.set(GROUP_VALUES_KEY,Object.fromEntries(Object.entries(settings).map(([property,value])=>[property,{...value,order:[]}])));this.onDataUpdated();this.nativeGroupMenu.refresh();}
          catch(error){new Notice(`Could not reset group positions: ${String(error)}`);}
        })();
      };
    }
    if(native||nativeGroupProperty(this.config)) {
      const row=host.createDiv({cls:'manual-order-group-rule manual-order-primary-layout'});
      row.createEl('label',{text:'Primary group layout'});
      const layout=row.createEl('select',{attr:{'aria-label':'Primary group layout'}});
      layout.createEl('option',{text:'Horizontal',attr:{value:'horizontal'}});layout.createEl('option',{text:'Vertical',attr:{value:'vertical'}});
      layout.value=this.config.get(NATIVE_LAYOUT_KEY)==='vertical'?'vertical':'horizontal';
      layout.onchange=()=>{
        void (async()=>{
          if(this.editor&&!(await this.editor.save()))return;
          try {this.config.set(NATIVE_LAYOUT_KEY,layout.value==='vertical'?'vertical':null);this.onDataUpdated();this.nativeGroupMenu.refresh();}
          catch(error){new Notice(`Could not save group layout: ${String(error)}`);}
        })();
      };
    }
    const primaryValues=this.valueSections.find(section=>section.property===nativeGroupProperty(this.config));if(primaryValues)renderValues(primaryValues,host);
    const properties=[...new Set([...(this.allProperties??[]),...this.config.getOrder(),...rules.map(rule=>rule.property)])];
    for(const entry of this.data.data)for(const name of Object.keys(this.app.metadataCache.getFileCache(entry.file)?.frontmatter??{})) {
      const id=`note.${name}` as BasesPropertyId;if(name!=='position'&&!properties.includes(id))properties.push(id);
    }
    properties.sort((a,b)=>this.config.getDisplayName(a).localeCompare(this.config.getDisplayName(b)));
    renderGroupMenu(host,rules,properties,id=>this.config.getDisplayName(id),next=>{
      void (async()=>{
        if(this.editor&&!(await this.editor.save()))return;
        try {this.config.set(GROUPS_KEY,next.length?next:null);this.onDataUpdated();this.nativeGroupMenu.refresh();}
        catch(error){new Notice(`Could not save grouping: ${String(error)}`);}
      })();
    },native,(host,rule)=>{const section=this.valueSections.find(section=>section.property===rule.property);if(section)renderValues(section,host);});
  }

  private groupBinding(property:BasesPropertyId,row:TableRow):GroupBinding {
    const original=property.startsWith('note.')?this.cellValue(row.entry,property):{exists:true,value:row.entry.getValue(property)?.toString()};
    return this.bindingValue(property,row.path,original);
  }

  private nativeBinding(property:BasesPropertyId,rows:TableRow[],key:Value|undefined):GroupBinding {
    const existing=rows[0]?this.groupBinding(property,rows[0]):undefined;
    if(existing&&!(key?.constructor as typeof Value|undefined)?.type)return existing;
    const value=nativeGroupValue(key),sourcePath=existing?.sourcePath??'';
    if(existing&&groupValueKey(groupIdentity(existing.value.value,this.app,sourcePath))===groupValueKey(groupIdentity(value.value,this.app,sourcePath)))return existing;
    // Metadata can reflect a completed move before groupedData catches up.
    // Never replace an old native group's key with its representative's new value.
    return {property,value,sourcePath,original:existing?.original};
  }

  private bindingValue(property:BasesPropertyId,sourcePath:string,original:CellValue):GroupBinding {
    const empty=property.startsWith('note.')&&(original.value===null||original.value===undefined||original.value==='');
    return {property,sourcePath,original:structuredClone(original),value:empty?{exists:false,value:undefined}:structuredClone(original)};
  }

  private vaultGroupBinding(file:TFile,property:BasesPropertyId):GroupBinding|undefined {
    if(property.startsWith('note.')) {
      if(!this.app.metadataCache.getFileCache(file))return;
      return this.bindingValue(property,file.path,this.cellValue({file} as BasesEntry,property));
    }
    let value:string;
    switch(property) {
      case 'file.folder':value=file.path.includes('/')?file.path.slice(0,file.path.lastIndexOf('/')):'';break;
      case 'file.path':value=file.path;break;
      case 'file.name':value=file.name;break;
      case 'file.basename':value=file.basename;break;
      case 'file.ext':case 'file.extension':value=file.extension;break;
      case 'file.size':value=String(file.stat.size);break;
      default:return;
    }
    return this.bindingValue(property,file.path,{exists:true,value});
  }

  refreshGroupAvailability() {
    if(this.data&&(readGroupRules(this.config.get(GROUPS_KEY)).length||nativeGroupProperty(this.config)))this.onDataUpdated();
  }

  private paintRowSelection() {
    for(const row of this.root.querySelectorAll<HTMLElement>('tr[data-row-path]')) {
      const selected=this.selectedRows.has(row.dataset.rowPath!);
      row.classList.toggle('manual-order-row-selected',selected);
      row.setAttribute('aria-selected',String(selected));row.querySelector('.manual-order-handle')?.setAttribute('aria-pressed',String(selected));
    }
    const status=this.root.querySelector<HTMLElement>('.manual-order-row-selection-status');
    if(status)status.setText(this.selectedRows.size?`${this.selectedRows.size} row${this.selectedRows.size===1?'':'s'} selected`:'');
  }

  private selectRow(path:string,event:MouseEvent) {
    const rows=[...this.root.querySelectorAll<HTMLElement>('tr[data-row-path]')].map(row=>row.dataset.rowPath!);
    if(event.shiftKey&&this.rowAnchor&&rows.includes(this.rowAnchor)) {
      const a=rows.indexOf(this.rowAnchor),b=rows.indexOf(path);
      if(!event.ctrlKey&&!event.metaKey)this.selectedRows.clear();
      for(const path of rows.slice(Math.min(a,b),Math.max(a,b)+1))this.selectedRows.add(path);
    } else {
      if(event.ctrlKey||event.metaKey){if(this.selectedRows.has(path))this.selectedRows.delete(path);else this.selectedRows.add(path);}
      else this.selectedRows=new Set([path]);
      this.rowAnchor=path;
    }
    this.paintRowSelection();
  }

  private async moveRowsToGroup(paths:string[],target:GroupTarget,position?:{path:string;below:boolean}) {
    if(this.movingRows||this.plugin.busy)return;
    this.movingRows=true;
    const revision=this.revision;
    try {
      if(this.plugin.editorOwner)throw new Error('Finish the active cell edit before moving rows.');
      const entries=new Map(this.data.data.map(entry=>[entry.file.path,entry]));
      const moved=[...new Set(paths)];if(!moved.length)return;
      if(target.unknownNative) {
        const sourceNative=this.data.groupedData.find(group=>group.entries.some(entry=>entry.file.path===target.rows[0]?.path));
        if(!sourceNative||moved.some(path=>!sourceNative.entries.some(entry=>entry.file.path===path)))throw new Error('The native grouping property could not be identified. Reopen the Base before moving across native groups.');
      }
      const bindings=new Map<BasesPropertyId,GroupBinding>();
      for(const binding of target.bindings) {
        const previous=bindings.get(binding.property);
        if(previous&&!sameValue({exists:true,value:groupIdentity(previous.value.value,this.app,previous.sourcePath)},{exists:true,value:groupIdentity(binding.value.value,this.app,binding.sourcePath)}))throw new Error('The destination has conflicting grouping values.');
        bindings.set(binding.property,binding);
        if(binding.property.startsWith('note.')&&binding.sourcePath&&binding.original) {
          const file=this.app.vault.getFileByPath(binding.sourcePath);if(!file)throw new Error('The destination note disappeared.');
          if(!sameValue(await readCell(this.app,file,binding.property),binding.original))throw new Error('The destination group changed. Try the move again.');
        }
      }
      const changes:CellChange[]=[];
      for(const path of moved) {
        const entry=entries.get(path);if(!entry)throw new Error(`Missing row: ${path}`);
        let destinationPath=path;
        const renameSnapshots=new Map<BasesPropertyId,CellSnapshot>();
        for(const binding of bindings.values())if(binding.property.startsWith('file.')&&editableProperty(binding.property,entry.file.extension)) {
          const before=await readCell(this.app,entry.file,binding.property);
          if(!sameValue(before,binding.value)) {
            if(renameSnapshots.size)throw new Error('A group move can change only one filename, folder or path property at once.');
            destinationPath=renameTarget(before,binding.value.value);renameSnapshots.set(binding.property,before);
          }
        }
        for(const binding of bindings.values()) {
          const property=binding.property;
          if(!editableProperty(property,entry.file.extension)) {
            const current=entry.getValue(property)?.toString();
            if(current!==binding.value.value)throw new Error(`${this.config.getDisplayName(property)} is computed and cannot be changed by moving a row.`);
            continue;
          }
          const before=renameSnapshots.get(property)??await readCell(this.app,entry.file,property);
          if(sameValue({exists:true,value:groupIdentity(before.value,this.app,path)},{exists:true,value:groupIdentity(binding.value.value,this.app,binding.sourcePath)}))continue;
          const after={...binding.value,value:property.startsWith('note.')?rebaseGroupValue(binding.value.value,this.app,binding.sourcePath,destinationPath):binding.value.value};
          if(property===`note.${this.property}`&&after.exists)numericRank(after.value);
          changes.push({before,after});
        }
      }
      // A positioned drop renumbers only the destination leaf; parent-header drops
      // change membership while retaining the rows' existing ordering values.
      const rankProperty=`note.${this.property}` as BasesPropertyId;
      if(position&&target.leaf&&!bindings.has(rankProperty)) {
        if(!this.valid)throw new Error('Choose a numeric ordering property before positioning rows.');
        const order=target.rows.map(row=>row.path).filter(path=>!moved.includes(path));
        const index=order.indexOf(position.path);if(index<0)return;
        order.splice(index+(position.below?1:0),0,...moved);
        for(let i=0;i<order.length;i++) {
          const entry=entries.get(order[i]);if(!entry)throw new Error('The destination rows changed.');
          const before=await readCell(this.app,entry.file,rankProperty);
          const rank=this.direction==='asc'?i+1:order.length-i;
          changes.push({before,after:{exists:true,value:rank}});
        }
      }
      if(this.disposed||revision!==this.revision)throw new Error('The table changed during the move. Try again.');
      await this.plugin.commitBatch(changes);
      new Notice(`Moved ${moved.length} row${moved.length===1?'':'s'}. Use Undo edit to restore.`);
    } catch(error){new Notice(`Could not move rows: ${error instanceof Error?error.message:String(error)}`,8000);}
    finally {this.movingRows=false;}
  }

  private renderRow(body: HTMLElement, row: TableRow, index:number, group:number, columns:BasesPropertyId[]) {
    const tr=body.createEl('tr');
    this.rowLayout.row(tr,row.path);
    const gripCell=tr.createEl('td',{cls:'manual-order-handle-cell'}).createDiv({cls:'manual-order-cell-content manual-order-row-controls'});
    const handle=gripCell.createEl('button',{cls:'manual-order-handle',attr:{'aria-label':`Move ${row.entry.file.basename}`,'title':'Drag to reorder or move groups; Ctrl/Cmd-click or Shift-click to select rows'}});
    setIcon(handle,'grip-vertical');
    const movable=this.valid||this.groupTargets[group]?.bindings.length>0;
    handle.draggable=movable && !this.plugin.busy && !this.plugin.editorOwner;
    handle.disabled=this.plugin.busy || !!this.plugin.editorOwner;
    handle.ondragstart=event=> {
      if(this.rowDropPending||!handle.draggable){event.preventDefault();return;}
      this.rowDragScroll.lock();
      if(!this.selectedRows.has(row.path)){this.selectedRows=new Set([row.path]);this.rowAnchor=row.path;this.paintRowSelection();}
      const paths=[...this.root.querySelectorAll<HTMLElement>('tr[data-row-path]')].map(row=>row.dataset.rowPath!).filter(path=>this.selectedRows.has(path));
      this.drag={path:row.path,paths,group,revision:this.revision};
      event.dataTransfer?.setData(ROW_DRAG_TYPE,JSON.stringify(paths));
      event.dataTransfer?.setData('text/plain',row.path);
      if (event.dataTransfer) event.dataTransfer.effectAllowed='move';
      this.rowDragPreview.start(paths,tr,event);
    };
    handle.ondragend=()=>{this.drag=undefined; this.clearIndicators();if(!this.rowDropPending){this.rowDragPreview.stop();this.rowDragScroll.unlock();}};
    handle.onkeydown=event=> {
      if (!event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const below=event.key==='ArrowDown';
      const liveIndex=this.groups[group].indexOf(row),target=this.groups[group][liveIndex+(below?1:-1)];
      if (target) void this.move(row.path,target.path,below,group);
    };
    handle.onclick=event=> {
      event.preventDefault();this.selection.clear();
      if(event.ctrlKey||event.metaKey||event.shiftKey||!this.selectedRows.has(row.path))this.selectRow(row.path,event);
    };
    handle.oncontextmenu=event=> {
      event.preventDefault();
      if(!this.selectedRows.has(row.path))this.selectRow(row.path,event);
      const menu=new Menu();
      const liveIndex=this.groups[group].indexOf(row);
      menu.addItem(item=>item.setTitle('Move up').setIcon('arrow-up').setDisabled(liveIndex===0 || !this.valid || this.plugin.busy).onClick(()=>void this.move(row.path,this.groups[group][liveIndex-1].path,false,group)));
      menu.addItem(item=>item.setTitle('Move down').setIcon('arrow-down').setDisabled(liveIndex===this.groups[group].length-1 || !this.valid || this.plugin.busy).onClick(()=>void this.move(row.path,this.groups[group][liveIndex+1].path,true,group)));
      menu.showAtMouseEvent(event);
    };
    tr.ondragover=event=> {
      if (!this.drag || this.drag.revision!==this.revision || this.plugin.busy) return;
      event.preventDefault();
      this.clearIndicators();
      tr.addClass(event.clientY>tr.getBoundingClientRect().top+tr.clientHeight/2?'drop-below':'drop-above');
      this.scrollRowDrag(event);
    };
    tr.ondrop=event=> {
      event.preventDefault();
      const drag=this.drag; this.drag=undefined; this.clearIndicators();
      if (!drag || drag.revision!==this.revision){this.rowDragPreview.stop();this.rowDragScroll.unlock();return;}
      const below=event.clientY>tr.getBoundingClientRect().top+tr.clientHeight/2;
      if(drag.paths.includes(row.path)){this.rowDragPreview.stop();this.rowDragScroll.unlock();return;}
      if(drag.group===group&&drag.paths.length===1)this.runRowDrop(()=>this.move(drag.path,row.path,below,group));
      else this.runRowDrop(()=>this.moveRowsToGroup(drag.paths,this.groupTargets[group],{path:row.path,below}));
    };
    for (const property of columns)this.renderCell(tr,row,property);
  }

  private renderCell(tr:HTMLTableRowElement,row:TableRow,property:BasesPropertyId):HTMLTableCellElement {
      const cell=tr.createEl('td');
      const content=cell.createDiv({cls:'manual-order-cell-content'});
      cell.dataset.path=row.path;cell.dataset.property=property;
      cell.addEventListener('dragover',event=>{
        if(!hasLinkDrag(event.dataTransfer))return;
        event.stopPropagation();
        if(this.acceptsLinkDrop(row.entry,property)) {
          event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';cell.classList.add('manual-order-link-drop-target');
        }
      },true);
      cell.addEventListener('dragleave',event=>{
        if(!event.relatedTarget || !cell.contains(event.relatedTarget as Node))cell.classList.remove('manual-order-link-drop-target');
      });
      cell.addEventListener('drop',event=>{
        if(!hasLinkDrag(event.dataTransfer))return;
        event.preventDefault();event.stopImmediatePropagation();clearLinkDropTargets(cell.ownerDocument);
        const link=readLinkDrag(event.dataTransfer);
        if(!link) {new Notice('The dragged link is invalid.');return;}
        void this.dropLink(row.entry,property,link);
      },true);
      const editable=editableProperty(property,row.entry.file.extension);
      if(editable) {
        cell.addClass('manual-order-editable');cell.tabIndex=0;
        cell.setAttribute('aria-label',`${this.config.getDisplayName(property)} for ${row.entry.file.basename}. Click or press Enter to edit.`);
        cell.onclick=event=>{
          if(this.editor?.element.closest('td')===cell)return;
          if((event.target as HTMLElement).closest('a,button,input,select,textarea')) return;
          let caret:number|undefined;
          let itemIndex:number|undefined;
          const point=caretRangeAtPoint(cell.ownerDocument,event.clientX,event.clientY);
          if(point && cell.contains(point.startContainer)) {
            const item=(event.target as HTMLElement).closest('.manual-order-list-items > li')??point.startContainer.parentElement?.closest('.manual-order-list-items > li');
            if(item)itemIndex=[...item.parentElement!.children].indexOf(item);
            if(item && !item.contains(point.startContainer))caret=0;
            else {
              const prefix=cell.ownerDocument.createRange();prefix.selectNodeContents(item??cell);prefix.setEnd(point.startContainer,point.startOffset);caret=prefix.toString().length;
              for(const link of prefix.cloneContents().querySelectorAll<HTMLElement>('[data-manual-order-raw-link]'))caret+=(link.dataset.manualOrderRawLink?.length??0)-(link.textContent?.length??0);
            }
          }
          void this.editCell(row.entry,property,caret,itemIndex);
        };
        cell.onkeydown=event=>{
          if(event.target!==cell) return;
          if(event.key==='Enter'||event.key==='F2') {event.preventDefault();void this.editCell(row.entry,property);}
          else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
            event.preventDefault();this.navigateCell(cell,event.key);
          }
        };
      } else cell.title=property.startsWith('formula.')?'Calculated formula · read-only':'Computed file property · read-only';
      if (property==='file.name' || property==='file.basename') {
        const link=content.createEl('a',{cls:'internal-link',text:row.entry.file.basename,href:row.path});
        makeLinkDraggable(link,this.app,row.path,`[[${row.path}]]`);
        link.onclick=event=>{event.preventDefault();void this.app.workspace.openLinkText(row.path,'',Keymap.isModEvent(event));};
        link.onauxclick=event=>{if(event.button===1){event.preventDefault();void this.app.workspace.openLinkText(row.path,'','tab');}};
        link.onmouseover=event=>this.app.workspace.trigger('hover-link',{event,source:'bases',hoverParent:this.app.renderContext,targetEl:link,linktext:row.path});
        const rename=content.createEl('button',{cls:'manual-order-rename',attr:{'aria-label':`Rename ${row.entry.file.basename}`,title:'Rename file'}});
        setIcon(rename,'pencil');rename.onclick=event=>{event.stopPropagation();void this.editCell(row.entry,property);};
      } else if (property===`note.${this.property}`) content.setText(row.rank===undefined?'':String(row.rank));
      else if(property.startsWith('note.') && editable) {
        const current=this.cellValue(row.entry,property);
        const type=this.plugin.propertyType(property,this.data.data);
        if(type==='list' || Array.isArray(current.value)) {
          this.rowLayout.list(content,current.value,property,(item,value)=>{
            if(!renderPropertyLinks(item,value,this.app,row.path))item.setText(value==null?'':typeof value==='object'?JSON.stringify(value):String(value));
          });
        } else if(type==='checkbox') {
          const checkbox=content.createEl('input',{attr:{type:'checkbox','aria-label':this.config.getDisplayName(property)}});
          checkbox.checked=current.value===true;checkbox.disabled=this.plugin.busy || !!this.plugin.editorOwner;
          checkbox.onchange=()=>void this.toggleCheckbox(row.entry,property,checkbox,current);
        } else {
          const override=this.plugin.cellOverrides.get(`${row.path}\0${property}`);
          if(renderPropertyLinks(content,current.value,this.app,row.path)) { /* Native links within text and list values. */ }
          else if(override||row.entry.getValue(property)?.toString()!==formatValue(current.value,type)) content.setText(formatValue(current.value,type));
          else row.entry.getValue(property)?.renderTo(content,this.app.renderContext);
        }
      } else row.entry.getValue(property)?.renderTo(content,this.app.renderContext);
      return cell;
  }

  private clearIndicators() { this.root.querySelectorAll('.drop-above,.drop-below,.manual-order-group-drop-target').forEach(el=>el.removeClass('drop-above','drop-below','manual-order-group-drop-target')); }

  private scrollRowDrag(event:DragEvent) {
    if(this.root.querySelector('.manual-order-group-board')){this.rowDragScroll.restore();return;}
    const bounds=this.root.getBoundingClientRect();
    if(event.clientY<bounds.top+48)this.root.scrollTop-=18;
    if(event.clientY>bounds.bottom-48)this.root.scrollTop+=18;
    let body=(event.target as Element)?.closest?.<HTMLElement>('[data-group-scroll-key]');
    while(body) {
      const box=body.getBoundingClientRect(),before=body.scrollLeft;
      if(body.scrollWidth>body.clientWidth) {
        if(event.clientX<Math.max(box.left,bounds.left)+40)body.scrollLeft-=18;
        else if(event.clientX>Math.min(box.right,bounds.right)-40)body.scrollLeft+=18;
        if(body.scrollLeft!==before)return;
      }
      body=body.parentElement?.closest<HTMLElement>('[data-group-scroll-key]')??null;
    }
    if(event.clientX<bounds.left+40)this.root.scrollLeft-=18;
    if(event.clientX>bounds.right-40)this.root.scrollLeft+=18;
  }

  private runRowDrop(action:()=>Promise<void>) {
    this.rowDropPending=true;
    this.rowDragPreview.release();
    void action().finally(()=>{this.rowDropPending=false;this.rowDragPreview.stop();this.rowDragScroll.unlock();});
  }

  renameRow(oldPath:string,newPath:string) {this.selection.renamePath(oldPath,newPath);this.rowLayout.rename(oldPath,newPath);if(this.selectedRows.delete(oldPath))this.selectedRows.add(newPath);if(this.rowAnchor===oldPath)this.rowAnchor=newPath;}

  private readonly onCopy=(event:ClipboardEvent)=>{
    if(!event.clipboardData)return;
    const target=event.target as HTMLElement;
    const input=target.closest?.<HTMLInputElement|HTMLTextAreaElement>('input,textarea');
    // Highlighted editor text keeps the browser's normal copy behavior.
    if(input&&input.selectionStart!==input.selectionEnd&&!(this.editor instanceof ListCellEditor&&this.editor.hasItemSelection()))return;
    if(target.closest?.('select,[contenteditable=true]'))return;
    try {
      const range=this.selection.getRange();if(!range.length)return;
      const entries=new Map(this.data.data.map(entry=>[entry.file.path,entry]));
      const activeCell=this.editor?.element.closest<HTMLElement>('td');
      const rows=range.map(row=>row.map(({path,property})=>{
        if(this.editor&&activeCell?.dataset.path===path&&activeCell.dataset.property===property)return this.editor.copyText();
        const entry=entries.get(path);if(!entry)throw new Error(`Missing row: ${path}`);
        const id=property as BasesPropertyId;
        if(property.startsWith('note.'))return formatValue(this.cellValue(entry,id).value,this.plugin.propertyType(id,this.data.data));
        if(property==='file.name')return entry.file.name;
        if(property==='file.basename')return entry.file.basename;
        if(property==='file.path')return entry.file.path;
        if(property==='file.folder')return entry.file.parent?.path==='/'?'':entry.file.path.slice(0,Math.max(0,entry.file.path.lastIndexOf('/')));
        return entry.getValue(id)?.toString()??'';
      }));
      event.clipboardData.setData('text/plain',serializeClipboard(rows));
      event.preventDefault();event.stopImmediatePropagation();
    } catch(error) {event.preventDefault();new Notice(`Could not copy: ${String(error)}`,8000);}
  };

  private readonly onPaste=(event:ClipboardEvent)=>{
    const data=event.clipboardData;if(!data)return;
    const text=data.getData('text/plain');if(!text&&!Array.from(data.types).includes('text/plain'))return;
    try {
      const range=this.selection.getRange();if(!range.length)return;
      event.preventDefault();event.stopImmediatePropagation();void this.pasteRange(text,range);
    } catch(error) {event.preventDefault();new Notice(`Could not paste: ${String(error)}`,8000);}
  };

  private async pasteRange(text:string,range:{path:string;property:string}[][]) {
    if(this.pasting){new Notice('A paste is already in progress.');return;}
    this.pasting=true;
    try {
      const single=range.length===1&&range[0].length===1;
      const matrix=parseClipboard(text);
      const values=single?[[matrix.map(row=>row.join('\t')).join('\n')]]:mapClipboard(matrix,range.length,range[0].length);
      if(single&&this.editor)this.editor.cancel();
      if(this.plugin.editorOwner?.editor&&!(await this.plugin.editorOwner.editor.save()))return;
      if(this.plugin.busy)throw new Error('Another change is saving. Please try again.');
      await this.plugin.loadPropertyTypes();
      const changes:CellChange[]=[];
      for(let r=0;r<range.length;r++) {
        if(range[r].filter(cell=>cell.property.startsWith('file.')).length>1)throw new Error('Paste into only one filename, path, or folder column per row at a time.');
        const file=this.app.vault.getFileByPath(range[r][0].path);if(!file)throw new Error(`Missing file: ${range[r][0].path}`);
        const snapshots=await readCells(this.app,file,range[r].map(cell=>cell.property as BasesPropertyId));
        for(let c=0;c<range[r].length;c++) {
          const before=snapshots[c],raw=values[r][c];
          try {
            let after:CellValue;
            if(before.property.startsWith('file.')) {
              let value=raw.trim();
              if(before.property==='file.name'&&value&&!value.toLowerCase().endsWith(`.${file.extension.toLowerCase()}`))value+=`.${file.extension}`;
              after={exists:true,value};
            } else {
              const type=before.property===`note.${this.property}`?'number':this.plugin.propertyType(before.property,this.data.data);
              after=parsePastedValue(raw,type);
            }
            changes.push({before,after});
          } catch(error) {throw new Error(`${file.basename}, ${this.config.getDisplayName(before.property)}: ${error instanceof Error?error.message:String(error)}`);}
        }
      }
      if(this.disposed)return;
      const edits=await this.plugin.commitBatch(changes);
      new Notice(edits.length?`Pasted into ${edits.length} cell${edits.length===1?'':'s'}.`:'The selected cells already contain these values.');
    } catch(error) {new Notice(`Could not paste: ${error instanceof Error?error.message:String(error)}`,10000);}
    finally {this.pasting=false;}
  }

  private acceptsLinkDrop(entry:BasesEntry,property:BasesPropertyId):boolean {
    if(this.plugin.busy || entry.file.extension!=='md' || !property.startsWith('note.') || !editableProperty(property,entry.file.extension) || property===`note.${this.property}`)return false;
    const type=this.plugin.propertyType(property,this.data.data);return type==='text'||type==='list';
  }

  private async dropLink(entry:BasesEntry,property:BasesPropertyId,payload:DraggedLink) {
    try {
      if(this.disposed)return;
      await this.plugin.loadPropertyTypes();
      if(!this.acceptsLinkDrop(entry,property))throw new Error('Drop links into a writable Text or List property.');
      const owner=this.plugin.editorOwner,editor=owner?.editor;
      const activeCell=editor?.element.closest<HTMLElement>('td');
      if(editor && activeCell?.dataset.path===entry.file.path && activeCell.dataset.property===property) {
        const added=await editor.addLink(linkForDestination(this.app,payload,entry.file.path));
        if(added || owner?.editor===editor)return;
      } else if(editor && !(await editor.save()))return;
      if(this.disposed)return;
      const type=this.plugin.propertyType(property,this.data.data);
      if(type!=='text'&&type!=='list')throw new Error('The target property type changed. Please try again.');
      const before=await readCell(this.app,entry.file,property);
      const next=appendLinkValue(before.value,type,linkForDestination(this.app,payload,entry.file.path));
      await this.plugin.commitCell(before,next);
    } catch(error) {new Notice(`Could not add link: ${error instanceof Error?error.message:String(error)}`,8000);}
  }

  private async move(source:string,target:string,below:boolean,group:number) {
    if (!this.valid || this.plugin.busy || this.plugin.editorOwner) return;
    const changes=planMove(this.groups[group],source,target,below,this.direction);
    if (changes.length) await this.plugin.execute({property:this.property,changes,originals:new Map(),baseline:this.groups[group].map(({path,rank})=>({path,rank}))});
  }

  private cellValue(entry:BasesEntry, property:BasesPropertyId): CellValue {
    const fm=fileProperties(this.app,entry.file);
    const value={exists:Object.hasOwn(fm,property.slice(5)),value:fm[property.slice(5)]};
    const key=`${entry.file.path}\0${property}`;
    const override=this.plugin.cellOverrides.get(key);
    if(override) {
      if(sameValue(value,override.snapshot)||override.until<Date.now()) this.plugin.cellOverrides.delete(key);
      // Edit snapshots also contain a live TFile (and its circular vault graph).
      // Cell consumers need only the serializable property payload.
      else return {exists:override.snapshot.exists,value:override.snapshot.value};
    }
    return value;
  }

  private findCell(path:string,property:string): HTMLElement|undefined {
    return [...this.root.querySelectorAll<HTMLElement>('td[data-property]')].find(cell=>cell.dataset.path===path&&cell.dataset.property===property);
  }

  private navigateCell(cell:HTMLElement,key:string) {
    const scope=cell.closest('.manual-order-board-column');
    const cells=[...this.root.querySelectorAll<HTMLElement>('td.manual-order-editable')].filter(candidate=>candidate.closest('.manual-order-board-column')===scope);
    let target:HTMLElement|undefined;
    if(key==='ArrowLeft'||key==='ArrowRight') target=cells[cells.indexOf(cell)+(key==='ArrowLeft'?-1:1)];
    else {
      const sameColumn=cells.filter(c=>c.dataset.property===cell.dataset.property);
      target=sameColumn[sameColumn.indexOf(cell)+(key==='ArrowUp'?-1:1)];
    }
    target?.focus();
  }

  private async toggleCheckbox(entry:BasesEntry,property:BasesPropertyId,input:HTMLInputElement,before:CellValue) {
    const next=input.checked;
    this.renderedCells.delete(`${entry.file.path}\0${property}`);
    input.disabled=true;
    try {
      if(this.plugin.editorOwner && this.plugin.editorOwner!==this) throw new Error('Finish editing the active cell first.');
      if(this.editor && !(await this.editor.save())) {input.checked=!!before.value;input.disabled=false;return;}
      await this.plugin.loadPropertyTypes();
      if(this.plugin.propertyType(property,this.data.data)!=='checkbox') {
        this.onDataUpdated();await this.editCell(entry,property);return;
      }
      await this.plugin.commitCell({file:entry.file,path:entry.file.path,property,...before},{exists:true,value:next});
    } catch(error) {new Notice(String(error),8000);this.onDataUpdated();}
  }

  private async editCell(entry:BasesEntry,property:BasesPropertyId,caret?:number,initialItem?:number) {
    if(this.loadingEditor || this.disposed || (this.plugin.busy && !this.editor)) return;
    if(this.plugin.editorOwner && this.plugin.editorOwner!==this) {
      new Notice('Finish editing the active cell first.');return;
    }
    if(this.editor && !(await this.editor.save())) return;
    this.loadingEditor=true;this.plugin.editorOwner=this;
    // Do not redraw this view while loading or editing: query updates must not discard the draft.
    this.plugin.refresh();
    try {
      await this.plugin.loadPropertyTypes();
      let snapshot=await readCell(this.app,entry.file,property);
      if(this.disposed) return;
      const cell=this.findCell(entry.file.path,property);
      if(!cell) throw new Error('This row is no longer visible.');
      this.selection.selectCell(cell);
      const type=property===`note.${this.property}`?'number':this.plugin.propertyType(property,this.data.data);
      const Editor=type==='list'?ListCellEditor:CellEditor;
      this.editor=new Editor({cell,snapshot,type,app:this.app,initialItem,
        onHeight:(height:number)=>this.rowLayout.expandForEditor(entry.file.path,height),
        onInput:()=>this.rowLayout.measure(),
        save:async next=>{
          if(property===`note.${this.property}` && next.exists) numericRank(next.value);
          snapshot=await this.plugin.commitCell(snapshot,next);
        },
        close:navigation=>{
          const restoreFocus=cell.contains(cell.ownerDocument.activeElement);
          const ordered=[...this.root.querySelectorAll<HTMLElement>('td.manual-order-editable')];
          const next=ordered[ordered.indexOf(cell)+navigation];
          const nextPath=next?.dataset.path, nextProperty=next?.dataset.property;
          this.renderedCells.delete(`${entry.file.path}\0${property}`);
          this.editor=undefined;this.loadingEditor=false;this.plugin.editorOwner=undefined;this.plugin.refresh();
          if(navigation && nextPath && nextProperty) {
            const nextEntry=this.data.data.find(e=>e.file.path===nextPath);
            if(nextEntry) void this.editCell(nextEntry,nextProperty as BasesPropertyId);
          } else if(restoreFocus) this.findCell(entry.file.path,property)?.focus();
        },
      });
      this.editor.focus(caret);
      this.rowLayout.measure();
    } catch(error) {
      new Notice(`Cannot edit: ${error instanceof Error?error.message:String(error)}`,8000);
      if(this.plugin.editorOwner===this) this.plugin.editorOwner=undefined;
    } finally {this.loadingEditor=false;if(!this.editor)this.plugin.refresh();}
  }
}
