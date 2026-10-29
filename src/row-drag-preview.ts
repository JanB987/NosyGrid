/** A cursor-following copy with layout-preserving shadows at the source rows. */
export class RowDragPreview {
  private layer?:HTMLElement;
  private image?:HTMLCanvasElement;
  private rows:HTMLElement[]=[];
  private doc:Document;
  constructor(private root:HTMLElement) {
    this.doc=root.ownerDocument;this.doc.addEventListener('dragover',this.move,true);
  }
  start(paths:string[],anchor:HTMLElement,event:DragEvent) {
    this.stop();const selected=new Set(paths);
    this.rows=[...this.root.querySelectorAll<HTMLElement>('tr[data-row-path]')].filter(row=>selected.has(row.dataset.rowPath!));
    const layer=this.doc.createElement('div');this.layer=layer;
    layer.className='manual-order-row-drag-preview';layer.setAttribute('aria-hidden','true');layer.setAttribute('inert','');
    const width=Math.min(720,anchor.getBoundingClientRect().width||640,Math.max(160,(this.doc.defaultView?.innerWidth??1024)-24));layer.style.width=`${width}px`;
    if(this.rows.length>1){const count=layer.appendChild(this.doc.createElement('div'));count.className='manual-order-drag-count';count.textContent=`${this.rows.length} rows`;}
    const table=layer.appendChild(this.doc.createElement('table'));table.className='manual-order-table';const body=table.appendChild(this.doc.createElement('tbody'));
    for(const row of this.rows) {
      const copy=row.cloneNode(true) as HTMLElement;copy.classList.remove('is-dragging','manual-order-row-selected');
      for(const element of [copy,...copy.querySelectorAll<HTMLElement>('*')]) {
        for(const attr of ['id','data-row-path','data-path','data-property','aria-selected','aria-pressed'])element.removeAttribute(attr);
        element.draggable=false;element.tabIndex=-1;
      }
      const cells=[...row.children] as HTMLElement[],total=cells.reduce((sum,cell)=>sum+cell.getBoundingClientRect().width,0);
      if(total)for(let i=0;i<cells.length;i++)(copy.children[i] as HTMLElement).style.width=`${cells[i].getBoundingClientRect().width/total*100}%`;
      body.appendChild(copy);row.classList.add('manual-order-row-shadow');
    }
    this.doc.body.appendChild(layer);
    // Suppress Chromium's additional native ghost; the preview follows document drag events.
    this.image=this.doc.createElement('canvas');this.image.width=1;this.image.height=1;this.image.className='manual-order-drag-image';this.doc.body.appendChild(this.image);
    event.dataTransfer?.setDragImage(this.image,0,0);this.move(event);
  }
  private readonly move=(event:DragEvent)=>{
    if(!this.layer)return;
    const viewport=this.doc.defaultView,box=this.layer.getBoundingClientRect();
    this.layer.style.left=`${Math.max(8,Math.min(event.clientX+14,(viewport?.innerWidth??1024)-box.width-8))}px`;
    this.layer.style.top=`${Math.max(8,Math.min(event.clientY+14,(viewport?.innerHeight??768)-box.height-8))}px`;
  };
  /** On release, keep source shadows until the write succeeds or rolls back. */
  release(){this.layer?.remove();this.layer=undefined;this.image?.remove();this.image=undefined;}
  stop(){this.release();for(const row of this.rows)row.classList.remove('manual-order-row-shadow','is-dragging');this.rows=[];}
  destroy(){this.stop();this.doc.removeEventListener('dragover',this.move,true);}
}
