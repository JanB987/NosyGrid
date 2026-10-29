import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['src/clipboard.ts'],bundle:true,platform:'node',format:'esm',outfile:'test-build/clipboard.mjs',external:['yaml'],alias:{obsidian:`${process.cwd()}/tests/obsidian-mock.mjs`}});
const {parseClipboard,mapClipboard,parsePastedValue,serializeClipboard}=await import(pathToFileURL(`${process.cwd()}/test-build/clipboard.mjs`));

test('copy serialization round-trips complete cells including multiline lists, links and separators',()=>{
  for(const rows of [[['[[Note|Alias]]\nsecond\nthird']], [['001','false','0'],['tab\tinside','said "hello"','']], [['',''],['','']], [['first'],['']]]) {
    assert.deepEqual(parseClipboard(serializeClipboard(rows)),rows);
  }
});
test('spreadsheet clipboard parser preserves quotes, embedded tabs/newlines, empty cells and CRLF rows',()=>{
  assert.deepEqual(parseClipboard('a\tb\r\nc\td\r\n'),[['a','b'],['c','d']]);
  assert.deepEqual(parseClipboard('"line 1\nline 2"\t"said ""hello"""\t"tab\tinside"'),[['line 1\nline 2','said "hello"','tab\tinside']]);
  assert.deepEqual(parseClipboard('a\t\n\t\n'),[['a',''],['','']]);assert.deepEqual(parseClipboard(''),[['']]);
});
test('single values fill the whole range and matching smaller matrices repeat',()=>{
  assert.deepEqual(mapClipboard([['x']],2,3),[['x','x','x'],['x','x','x']]);
  assert.deepEqual(mapClipboard([['a','b']],2,4),[['a','b','a','b'],['a','b','a','b']]);
  assert.throws(()=>mapClipboard([['a'],['b']],3,1),/matching range/);
  assert.throws(()=>parseClipboard('a\tb\nc'),/same number/);assert.throws(()=>parseClipboard('"unterminated'),/unterminated/);
});
test('typed clipboard values preserve text and links while converting numeric and checkbox properties',()=>{
  assert.equal(parsePastedValue('001','text').value,'001');assert.equal(parsePastedValue('false','text').value,'false');
  assert.equal(parsePastedValue('-1.5','number').value,-1.5);
  for(const text of ['TRUE','1','yes'])assert.equal(parsePastedValue(text,'checkbox').value,true);
  for(const text of ['false','0','NO'])assert.equal(parsePastedValue(text,'checkbox').value,false);
  assert.throws(()=>parsePastedValue('maybe','checkbox'));assert.throws(()=>parsePastedValue('text','number'));
  assert.deepEqual(parsePastedValue('[[Note|Alias]]\nsecond','list').value,['[[Note|Alias]]','second']);
  assert.deepEqual(parsePastedValue('[one, two]','list').value,['one','two']);
  assert.equal(parsePastedValue('','text').exists,false);assert.equal(parsePastedValue('','checkbox').exists,false);
});
