import type {DisplayGroup} from './retained-groups';

export interface GroupLevel {property:string;vertical:boolean}

/** Materialize empty destinations from the shared value union, without copying notes. */
export function completeVerticalGroups<T>(roots:DisplayGroup<T>[],levels:GroupLevel[],identity:(group:DisplayGroup<T>)=>string,create:(template:DisplayGroup<T>,parent:DisplayGroup<T>|undefined)=>DisplayGroup<T>) {
  for(let depth=0;depth<levels.length;depth++) {
    if(!levels[depth].vertical)continue;
    const scopes=new Map<string,{boards:{groups:DisplayGroup<T>[];parent?:DisplayGroup<T>}[];values:Map<string,DisplayGroup<T>>}>();
    const visit=(groups:DisplayGroup<T>[],level:number,ancestors:string[],parent?:DisplayGroup<T>)=>{
      if(level===depth) {
        const key=JSON.stringify([levels[depth].property,ancestors]);
        const scope: {boards:{groups:DisplayGroup<T>[];parent?:DisplayGroup<T>}[];values:Map<string,DisplayGroup<T>>}=scopes.get(key)??{boards:[],values:new Map()};scopes.set(key,scope);
        scope.boards.push({groups,parent});for(const group of groups)if(!scope.values.has(identity(group)))scope.values.set(identity(group),group);
        return;
      }
      for(const group of groups)visit(group.children,level+1,levels[level].vertical?[...ancestors,identity(group)]:ancestors,group);
    };
    visit(roots,0,[]);
    for(const scope of scopes.values())for(const board of scope.boards) {
      const present=new Set(board.groups.map(identity));
      for(const [id,template]of scope.values)if(!present.has(id)){board.groups.push(create(template,board.parent));present.add(id);}
    }
  }
}
