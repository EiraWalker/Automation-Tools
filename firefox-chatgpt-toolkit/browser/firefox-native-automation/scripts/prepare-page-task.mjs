// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import { options, required } from './options.mjs';
import { wrapPageTask, userscriptTask, draftTask } from './page-tasks.mjs';
try {
  const [task, ...argv] = process.argv.slice(2);
  const opts = options(argv, { title:'value', url:'value', sentinel:'value', out:'value', file:'value', mode:'value', namespace:'value', 'save-id':'value', selector:'value', key:'value', 'busy-selector':'value' });
  const guard = {title:required(opts.title,'--title'),url:required(opts.url,'--url'),sentinel:opts.sentinel};
  let source;
  if (task === 'payload') source = wrapPageTask(guard,await fs.readFile(required(opts.file,'--file'),'utf8'));
  else if (task === 'userscript') source = userscriptTask({...guard,mode:opts.mode,source:await fs.readFile(required(opts.file,'--file'),'utf8'),namespace:opts.namespace,saveId:opts['save-id']});
  else if (task === 'draft') source = draftTask({...guard,mode:opts.mode,selector:opts.selector,key:opts.key,busySelector:opts['busy-selector']});
  else throw new Error('Use payload, userscript or draft');
  const out = path.resolve(required(opts.out,'--out'));
  await fs.mkdir(path.dirname(out),{recursive:true});
  // Generated tasks may contain source or drafts. Refuse overwriting another task.
  await fs.writeFile(out,source,{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'prepared',file:out,executed:false}));
} catch(error) { console.error(JSON.stringify({status:'error',message:error.message})); process.exitCode=1; }
