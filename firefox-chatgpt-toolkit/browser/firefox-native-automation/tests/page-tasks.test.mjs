import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { userscriptTask, draftTask, wrapPageTask } from '../scripts/page-tasks.mjs';
const guard = {title:'测试编辑器',url:'https://example.test/editor',sentinel:'TEST_RESULT'};
function page(html='<textarea id="prompt-textarea"></textarea>') {
  const dom=new JSDOM(`<title>${guard.title}</title>${html}`,{url:guard.url,runScripts:'outside-only'});
  const results=[]; dom.window.console.log=value=>results.push(JSON.parse(value.slice('TEST_RESULT '.length)));
  return {dom,w:dom.window,results};
}
async function run(p,code) { await p.w.eval(code); return p.results.at(-1); }
const source='// ==UserScript==\n// @namespace test.namespace\n// ==/UserScript==\nconst text = "中文 ` ${x}";';
function editorPage() {
  const p=page('<div class="CodeMirror"></div><button id="save"></button>');
  let value=source+'\n// old',clicks=0;
  p.w.document.querySelector('.CodeMirror').CodeMirror={getValue:()=>value,setValue:v=>{value=v;}};
  p.w.document.getElementById('save').onclick=()=>{clicks++;};
  return Object.assign(p,{value:()=>value,edit:v=>{value=v;},clicks:()=>clicks});
}
test('page task refuses wrong document before any mutation',async()=>{
 const p=page();p.w.document.title='different';
 assert.equal((await run(p,wrapPageTask(guard,'document.body.textContent="changed";return {};'))).ok,false);
 assert.ok(p.w.document.querySelector('textarea'));p.w.close();
});
test('userscript preparation retains backup and requires a separate verified save request',async()=>{
 const p=editorPage(),opts={...guard,source,namespace:'test.namespace',saveId:'save'};
 assert.equal((await run(p,userscriptTask({...opts,mode:'prepare'}))).action,'prepared');
 assert.equal(p.value(),source);assert.equal(p.clicks(),0);
 assert.ok(p.w.sessionStorage.getItem('firefox-toolkit-userscript-backup:test.namespace').endsWith('// old'));
 p.edit(source+'\n// concurrent edit');
 assert.equal((await run(p,userscriptTask({...opts,mode:'apply'}))).ok,false);assert.equal(p.clicks(),0);
 assert.equal((await run(p,userscriptTask({...opts,mode:'prepare'}))).ok,false);
 p.edit(source);
 const result=await run(p,userscriptTask({...opts,mode:'apply'}));
 assert.equal(result.action,'save_requested');assert.equal(result.installedVerified,false);assert.equal(p.clicks(),1);p.w.close();
});
test('ambiguous matching editors and missing save controls cause no edit',async()=>{
 for(const ambiguity of [true,false]) {
 const p=editorPage(),before=p.value();
 if(ambiguity){const el=p.w.document.createElement('div');el.className='CodeMirror';el.CodeMirror=p.w.document.querySelector('.CodeMirror').CodeMirror;p.w.document.body.append(el);}
 else p.w.document.getElementById('save').remove();
 assert.equal((await run(p,userscriptTask({...guard,source,namespace:'test.namespace',saveId:'save',mode:'prepare'}))).ok,false);
 assert.equal(p.value(),before);p.w.close();}
});
test('draft backup is not overwritten and restore preserves a new draft',async()=>{
 const p=page(),el=p.w.document.querySelector('textarea');el.value='原草稿\nsecond line';
 assert.equal((await run(p,draftTask({...guard,mode:'backup'}))).ok,true);
 el.value='new draft';assert.equal((await run(p,draftTask({...guard,mode:'backup'}))).ok,false);
 assert.equal((await run(p,draftTask({...guard,mode:'restore'}))).ok,false);assert.equal(el.value,'new draft');
 let events=0;el.oninput=()=>{events++;};el.value='';
 assert.equal((await run(p,draftTask({...guard,mode:'restore'}))).ok,true);
 assert.equal(el.value,'原草稿\nsecond line');assert.equal(events,1);assert.equal(p.w.sessionStorage.length,0);p.w.close();
});
test('restoration waits for busy page and ambiguous editors',async()=>{
 const p=page(),el=p.w.document.querySelector('textarea');el.value='draft';
 await run(p,draftTask({...guard,mode:'backup'}));el.value='';
 const stop=p.w.document.createElement('button');stop.id='stop';p.w.document.body.append(stop);
 assert.equal((await run(p,draftTask({...guard,mode:'restore',busySelector:'#stop'}))).ok,false);
 assert.equal(el.value,'');stop.remove();
 p.w.document.body.append(el.cloneNode());assert.equal((await run(p,draftTask({...guard,mode:'restore'}))).ok,false);p.w.close();
});
