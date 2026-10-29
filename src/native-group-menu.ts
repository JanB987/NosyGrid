/** Small DOM adapter for Obsidian's Group popup. No private controller APIs. */
export class NativeGroupMenu {
  private doc:Document;
  private toolbar:HTMLElement|null;
  private observer?:MutationObserver;
  private panel?:HTMLElement;
  private mounted=false;
  private static owners=new WeakMap<Document,NativeGroupMenu>();
  get available(){return !!this.toolbar;}

  constructor(root:HTMLElement,private render:(host:HTMLElement)=>void) {
    this.doc=root.ownerDocument;
    // The header and the view are siblings in each native Bases controller.
    const container=root.closest('.bases-view');
    this.toolbar=container?.parentElement?.querySelector<HTMLElement>(':scope > .bases-header .bases-toolbar-group-menu')??null;
    this.doc.addEventListener('click',this.open,true);
    this.doc.addEventListener('keydown',this.key,true);
  }

  private readonly key=(event:KeyboardEvent)=>{
    if(event.key==='Enter'||event.key===' ')this.activate(event.target as Element);
  };
  private readonly open=(event:MouseEvent)=>this.activate(event.target as Element);
  private activate(target:Element) {
    const trigger=target.closest?.('.bases-header .bases-toolbar-group-menu');
    if(trigger&&trigger!==this.toolbar){this.stop();return;}
    if(!this.toolbar||!this.toolbar.contains(target))return;
    NativeGroupMenu.owners.get(this.doc)?.stop();
    NativeGroupMenu.owners.set(this.doc,this);
    const Observer=this.doc.defaultView?.MutationObserver;if(!Observer)return;
    this.mounted=false;
    this.observer=new Observer(()=>this.attach());
    this.observer.observe(this.doc.body,{childList:true,subtree:true});
    queueMicrotask(()=>this.attach());
  }

  private attach() {
    if(NativeGroupMenu.owners.get(this.doc)!==this)return;
    const menu=this.doc.querySelector<HTMLElement>('.menu.bases-toolbar-group-menu');
    if(!menu){if(this.mounted)this.stop();return;}
    const page=menu.querySelector<HTMLElement>('.bases-group-page');if(!page)return;
    if(this.panel?.parentElement===page)return;
    this.panel?.remove();
    this.panel=page.createDiv({cls:'manual-order-native-groups'});this.mounted=true;
    this.refresh();
  }

  refresh() {
    if(!this.panel?.isConnected)return;
    this.panel.empty();this.render(this.panel);
  }

  private stop() {
    this.observer?.disconnect();this.observer=undefined;
    this.panel?.remove();this.panel=undefined;this.mounted=false;
    if(NativeGroupMenu.owners.get(this.doc)===this)NativeGroupMenu.owners.delete(this.doc);
  }

  destroy() {this.stop();this.doc.removeEventListener('click',this.open,true);this.doc.removeEventListener('keydown',this.key,true);}
}
