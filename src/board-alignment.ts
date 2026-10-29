import type {DisplayGroup} from './retained-groups';

export interface BoardPlan {slots:string[];count:number}
export function boardScopeKey<T>(group:DisplayGroup<T>,ancestors:string[]):string {
  return JSON.stringify(['board',group.property??group.bindings[0]?.property??'native',ancestors]);
}

/** Horizontal ancestors share a column scheme; vertical ancestors separate parallel boards. */
export function collectBoardPlans<T>(groups:DisplayGroup<T>[],vertical:(group:DisplayGroup<T>)=>boolean,identity:(group:DisplayGroup<T>)=>string,compare:(left:DisplayGroup<T>,right:DisplayGroup<T>)=>number):Map<string,BoardPlan> {
  const scopes=new Map<string,{count:number;values:Map<string,DisplayGroup<T>>}>();
  const visit=(siblings:DisplayGroup<T>[],ancestors:string[])=>{
    if(!siblings.length)return;
    const columns=vertical(siblings[0]);
    if(columns) {
      const key=boardScopeKey(siblings[0],ancestors),scope=scopes.get(key)??{count:0,values:new Map()};scope.count++;
      for(const group of siblings)if(!scope.values.has(identity(group)))scope.values.set(identity(group),group);
      scopes.set(key,scope);
    }
    for(const group of siblings)visit(group.children,columns?[...ancestors,identity(group)]:ancestors);
  };
  visit(groups,[]);
  return new Map([...scopes].map(([key,scope])=>{
    const values=[...scope.values.values()];if(values[0]?.property)values.sort(compare);
    return [key,{count:scope.count,slots:values.map(identity)}];
  }));
}

/** A shared grid reserves missing slots without creating artificial groups or notes. */
export class BoardAlignment {
  private plans=new Map<string,BoardPlan>();
  private boards=new Map<string,HTMLElement[]>();
  private observer?:ResizeObserver;
  constructor(private width:(key:string)=>number|undefined,private measured:()=>void=()=>{}){}
  begin(plans:Map<string,BoardPlan>){this.observer?.disconnect();this.plans=plans;this.boards.clear();}
  register(board:HTMLElement,key:string) {
    board.dataset.boardAlignmentKey=key;
    if((this.plans.get(key)?.count??0)<2)return;
    const boards=this.boards.get(key)??[];boards.push(board);this.boards.set(key,boards);
    const Observer=board.ownerDocument.defaultView?.ResizeObserver;
    if(Observer){this.observer??=new Observer(()=>{this.update();this.measured();});this.observer.observe(board);}
  }
  update() {
    for(const [key,boards]of this.boards) {
      const plan=this.plans.get(key);if(!plan)continue;
      const columns=new Map<string,HTMLElement[]>();
      const responsive=(board:HTMLElement)=>board.clientWidth?Math.min(640,Math.max(320,board.clientWidth-16)):640;
      const fallback=Math.max(...boards.map(responsive));
      for(const board of boards)for(const column of board.querySelectorAll<HTMLElement>(':scope > .manual-order-board-column')) {
        const slot=column.dataset.groupWidthKey!;const matches=columns.get(slot)??[];matches.push(column);columns.set(slot,matches);
      }
      const widths=plan.slots.map(slot=>{
        const matches=columns.get(slot)??[],expanded=matches.filter(column=>!column.classList.contains('is-board-collapsed'));
        if(matches.length&&!expanded.length)return 44;
        return Math.max(...(expanded.length?expanded.map(column=>parseFloat(column.style.getPropertyValue('--manual-order-column-width'))||this.width(slot)||responsive(column.parentElement!)):[this.width(slot)||fallback]));
      });
      const indexes=new Map(plan.slots.map((slot,index)=>[slot,index+1]));
      for(const board of boards) {
        board.classList.add('manual-order-aligned-board');board.style.gridTemplateColumns=widths.map(width=>`${width}px`).join(' ');
        for(const column of board.querySelectorAll<HTMLElement>(':scope > .manual-order-board-column')){column.style.gridColumn=String(indexes.get(column.dataset.groupWidthKey!)??1);column.style.gridRow='1';}
      }
    }
  }
  destroy(){this.observer?.disconnect();this.boards.clear();this.plans.clear();}
}
