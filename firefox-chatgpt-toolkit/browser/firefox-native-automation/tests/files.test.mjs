import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { submit, readJson, rpcPath, fingerprint } from '../scripts/rpc-files.mjs';
import { serveUserscript } from '../scripts/serve-userscript.mjs';
import { options, number } from '../scripts/options.mjs';
test('strict CLI rejects duplicates, missing values and unknown options',()=>{
 assert.throws(()=>options(['--dir','--file'],{dir:'value',file:'value'}));
 assert.throws(()=>options(['--dir','a','--dir','b'],{dir:'value'}));
 assert.throws(()=>options(['--unknown'],{}));assert.throws(()=>number('2.5',0,0,10));
});
test('exclusive RPC identity supports concurrent same-id submission and rejects different arguments',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'firefox-rpc-'));
 try {
 const request={name:'list_pages',arguments:{a:1,b:2}};
 await Promise.all(Array.from({length:6},()=>submit(dir,'read_1',request)));
 const value=await readJson(rpcPath(dir,'read_1','request'));
 assert.deepEqual(value.request,request);assert.equal(value.fingerprint,fingerprint({arguments:{b:2,a:1},name:'list_pages'}));
 await assert.rejects(submit(dir,'read_1',{name:'list_pages',arguments:{a:2}}),/different arguments/);
 assert.throws(()=>rpcPath(dir,'../escape','request'));assert.equal((await fs.readdir(dir)).length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('loopback server serves only one userscript and reads updates without caching',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'firefox-serve-')),file=path.join(dir,'test.user.js');
 await fs.writeFile(file,'// first');const {server,url}=await serveUserscript(file,0);
 try {
 assert.equal(server.address().address,'127.0.0.1');
 const response=await fetch(url);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(await response.text(),'// first');
 await fs.writeFile(file,'// updated 中文');assert.equal(await (await fetch(url)).text(),'// updated 中文');
 assert.equal((await fetch(url,{method:'HEAD'})).status,200);assert.equal(await (await fetch(url,{method:'HEAD'})).text(),'');
 assert.equal((await fetch(url,{method:'POST'})).status,405);
 assert.equal((await fetch(url+'/extra')).status,404);assert.equal((await fetch(new URL('/',url))).status,404);
 await assert.rejects(serveUserscript(path.join(dir,'page.html'),0),/Only a .user.js/);
 }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
