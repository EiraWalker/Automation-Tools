import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{authorize} from './worker.js';
const env={OWNER_EMAIL:'owner@example.com'};
const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
test('wrong or incomplete signed-in identity is rejected',()=>{
  for (const h of [{'oai-authenticated-user-email':'owner@example.com'},{'oai-authenticated-user-id':'x','oai-authenticated-user-email':'other@example.com'}]) assert.equal(authorize(new Request('https://private.test',{headers:h}),env),false);
  assert.equal(authorize(new Request('https://private.test',{headers:{'oai-authenticated-user-id':'x','oai-authenticated-user-email':'owner@example.com'}}),env),true);
});
test('disallowed origin fails before database access',async()=>{
  const r=await worker.fetch(new Request('https://private.test/api/update',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),env);
  assert.equal(r.status,403);
});
test('wrong source account fails before database or backend access',async()=>{
  const r=await worker.fetch(new Request('https://private.test/api/update',{method:'POST',body:JSON.stringify({source_account:'other@example.com',messages:[]})}),env);
  assert.equal(r.status,400);
});
test('session invalidation is disabled unless explicitly configured',async()=>{
  const r=await worker.fetch(new Request('https://private.test/api/session-recovery/test',{method:'POST',body:'{}'}),env);
  assert.equal(r.status,403);
});
test('session invalidation requires the same origin',async()=>{
  const r=await worker.fetch(new Request('https://private.test/api/session-recovery/test',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),{...env,SESSION_RECOVERY_TEST_ENABLED:'true'});
  assert.equal(r.status,403);
});

test('Google imports require signed-in owner and same origin, rejecting cloud-service identity',async()=>{
  for(const headers of [{Origin:'https://private.test'}, {...owner,Origin:'https://evil.test'},owner]) {
    const result=await worker.fetch(new Request('https://private.test/api/google/import',{
      method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'}),env);
    assert.equal(result.status,403);
  }
});

test('Google import rejects wrong account and claim batches before accessing the database',async()=>{
  for(const body of [{source_account:'owner@example.com',messages:[],google_session_import:{version:1,account:'other@example.com'}},
                    {source_account:'owner@example.com',messages:[{}],google_session_import:{version:1,account:'owner@example.com'}}]) {
    const result=await worker.fetch(new Request('https://private.test/api/google/import',{
      method:'POST',headers:{...owner,Origin:'https://private.test','Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    assert.equal(result.status,400);
  }
});

test('private Google authorization page and local exporter do not include service credentials',async()=>{
  const page=await worker.fetch(new Request('https://private.test/google-authorization'),env);
  assert.equal(page.status,200);
  assert.match(page.headers.get('Content-Security-Policy'),/script-src 'self'/);
  assert.match(await page.text(),/google-session-import.json/);
  const script=await worker.fetch(new Request('https://private.test/google-authorization/client.js'),env);
  const source=await script.text();
  assert.ok(!source.includes('localStorage'));
  assert.ok(!source.includes('console.'));
  const exporter=await worker.fetch(new Request('https://private.test/google-authorization/export.py'),env);
  assert.equal(exporter.status,200);
  assert.match(exporter.headers.get('Content-Disposition'),/google-local-auth.py/);
  const code=await exporter.text();
  assert.ok(code.includes('Browser.close'));
  assert.ok(!code.includes('CREDENTIAL_KEY'));
});
