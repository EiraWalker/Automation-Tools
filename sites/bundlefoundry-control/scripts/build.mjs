import { mkdir, copyFile, cp } from 'node:fs/promises';
import {build} from 'esbuild';
await mkdir('dist/server', {recursive:true});
await mkdir('dist/.openai', {recursive:true});
await build({entryPoints:['worker.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js'});
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/drizzle', {recursive:true});
