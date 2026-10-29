interface Position {left:number;top:number}

/** Keep native drag auto-scrolling and redraws from moving a vertical board. */
export class RowDragScroll {
  private saved?:{root:Position;groups:Map<string,Position>};
  private restoring=false;
  constructor(private root:HTMLElement){root.addEventListener('scroll',this.restore,true);}
  lock() {
    if(!this.root.querySelector('.manual-order-group-board')){this.saved=undefined;return;}
    const position=(element:HTMLElement)=>({left:element.scrollLeft,top:element.scrollTop});
    this.saved={root:position(this.root),groups:new Map([...this.root.querySelectorAll<HTMLElement>('[data-group-scroll-key]')].map(body=>[body.dataset.groupScrollKey!,position(body)]))};
  }
  readonly restore=()=>{
    if(!this.saved||this.restoring)return;
    this.restoring=true;
    try {
      const apply=(element:HTMLElement,position:Position)=>{
        const maxX=Math.max(0,element.scrollWidth-element.clientWidth),maxY=Math.max(0,element.scrollHeight-element.clientHeight);
        const left=position.left<0?Math.max(position.left,-maxX):Math.min(position.left,maxX),top=Math.min(position.top,maxY);
        if(element.scrollLeft!==left)element.scrollLeft=left;
        if(element.scrollTop!==top)element.scrollTop=top;
      };
      apply(this.root,this.saved.root);
      for(const body of this.root.querySelectorAll<HTMLElement>('[data-group-scroll-key]')){const position=this.saved.groups.get(body.dataset.groupScrollKey!);if(position)apply(body,position);}
    } finally {this.restoring=false;}
  };
  unlock(){this.restore();this.saved=undefined;}
  destroy(){this.unlock();this.root.removeEventListener('scroll',this.restore,true);}
}
