import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { submit, readJson, rpcPath, exists, delay } from '../scripts/rpc-files.mjs';
const script=fileURLToPath(new URL('../scripts/mcp-bridge.mjs',import.meta.url));
const fake=fileURLToPath(new URL('./fixtures/fake-mcp.mjs',import.meta.url));
async function waitFor(predicate,ms=10000){const end=Date.now()+ms;while(Date.now()<end){if(await predicate())return;await delay(40);}throw new Error('Test deadline exceeded');}
async function start(dir){
 const child=spawn(process.execPath,[script,'--dir',dir,'--server',fake,'--authorize-existing','--timeout-ms','250'],{stdio:['ignore','pipe','pipe']});
 const closed=new Promise(resolve=>child.on('exit',resolve));let diagnostics='';child.stderr.on('data',data=>{diagnostics+=data;});child.stdout.resume();
 try{await waitFor(async()=>{if(child.exitCode!==null)throw new Error(diagnostics);return exists(path.join(dir,'ready.json'));});}
 catch(error){child.kill();await closed;throw error;}
 return {child,closed};
}
async function response(dir,id){await waitFor(()=>exists(rpcPath(dir,id,'response')));return readJson(rpcPath(dir,id,'response'));}
async function stop(dir,proc){await fs.writeFile(path.join(dir,'stop'),'');await waitFor(()=>proc.child.exitCode!==null);await proc.closed;assert.equal(proc.child.exitCode,0);assert.equal(await exists(path.join(dir,'bridge.lock')),false);}
test('bridge dispatches once, rejects unlisted tools, and retains timeout uncertainty',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'firefox-bridge-'));let proc;
 try{
 proc=await start(dir);
 const request={name:'list_pages',arguments:{example:'read'}};
 await submit(dir,'one',request);const one=await response(dir,'one');assert.equal(one.status,'completed');
 await submit(dir,'one',request);await delay(200);assert.deepEqual(await response(dir,'one'),one);
 await submit(dir,'two',request);const two=await response(dir,'two');assert.equal(JSON.parse(two.result.content[0].text).ordinal,2);
 await submit(dir,'blocked',{name:'evaluate_script',arguments:{}});assert.equal((await response(dir,'blocked')).status,'rejected');
 await submit(dir,'slow',{name:'get_firefox_info',arguments:{hang:true}});assert.equal((await response(dir,'slow')).status,'indeterminate');
 await stop(dir,proc);proc=null;
 }finally{if(proc){proc.child.kill();await proc.closed;}await fs.rm(dir,{recursive:true,force:true});}
});
test('previous claimed requests are not replayed after bridge restart',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'firefox-bridge-'));let proc;
 try{
 await submit(dir,'old',{name:'list_pages',arguments:{}});await fs.writeFile(rpcPath(dir,'old','claimed'),'');
 proc=await start(dir);assert.equal((await response(dir,'old')).status,'indeterminate');
 await submit(dir,'new',{name:'list_pages',arguments:{}});const result=await response(dir,'new');assert.equal(JSON.parse(result.result.content[0].text).ordinal,1);
 await stop(dir,proc);proc=null;
 }finally{if(proc){proc.child.kill();await proc.closed;}await fs.rm(dir,{recursive:true,force:true});}
});
