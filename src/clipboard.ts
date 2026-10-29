import {parseYaml} from 'obsidian';
import {parseEditorValue,type CellValue,type EditorType} from './editing';

/** Quote complete cells so embedded separators survive spreadsheet copy/paste. */
export function serializeClipboard(rows:string[][]):string {
  return rows.map(row=>row.map(value=>/[\t\r\n"]/.test(value)||(!value&&row.length===1&&rows.length>1)?`"${value.replace(/"/g,'""')}"`:value).join('\t')).join('\n');
}

/** Spreadsheet TSV, including Excel-style quoted tabs, newlines and doubled quotes. */
export function parseClipboard(text:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(quoted) {
      if(char==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(char==='"'){quoted=false;closed=true;}
      else field+=char;
      continue;
    }
    if(char==='"'&&!field&&!closed){quoted=true;continue;}
    if(char==='\t'){row.push(field);field='';closed=false;continue;}
    if(char==='\n'||char==='\r') {
      row.push(field);rows.push(row);row=[];field='';closed=false;
      if(char==='\r'&&text[i+1]==='\n')i++;
      continue;
    }
    if(closed)throw new Error('Invalid quoted clipboard value.');
    field+=char;
  }
  if(quoted)throw new Error('The clipboard contains an unterminated quoted cell.');
  if(row.length||field||closed||!rows.length) {row.push(field);rows.push(row);}
  const width=rows[0].length;
  if(rows.some(row=>row.length!==width))throw new Error('Clipboard rows must have the same number of columns.');
  return rows;
}

export function mapClipboard(matrix:string[][],height:number,width:number):string[][] {
  if(!height||!width||!matrix.length||!matrix[0]?.length)throw new Error('Select a rectangular range first.');
  const sourceHeight=matrix.length,sourceWidth=matrix[0].length;
  if(height%sourceHeight!==0||width%sourceWidth!==0)throw new Error(`Clipboard is ${sourceHeight} × ${sourceWidth}; select a matching range or a whole-number multiple of it.`);
  return Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>matrix[r%sourceHeight][c%sourceWidth]));
}

export function parsePastedValue(text:string,type:EditorType):CellValue {
  if(type==='checkbox') {
    if(!text.trim())return {exists:false,value:undefined};
    const value=text.trim().toLowerCase();
    if(['true','1','yes'].includes(value))return {exists:true,value:true};
    if(['false','0','no'].includes(value))return {exists:true,value:false};
    throw new Error('Checkbox values must be true/false, yes/no, or 1/0.');
  }
  if(type==='list'&&text.trim().startsWith('[')&&!text.trim().startsWith('[[')) {
    const value=parseYaml(text);
    if(!Array.isArray(value))throw new Error('Enter a list, one item per line, or an inline array.');
    return {exists:true,value};
  }
  return parseEditorValue(text,type);
}
