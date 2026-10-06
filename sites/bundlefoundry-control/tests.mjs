import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{authorize} from './worker.js';
const env={OWNER_EMAIL:'owner@example.com'};
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
