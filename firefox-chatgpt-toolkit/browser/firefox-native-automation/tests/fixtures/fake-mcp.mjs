// Test-only stdio server. It never connects to a browser.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server=new Server({name:'fake-browser',version:'1.0.0'},{capabilities:{tools:{}}});
let calls=0;
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:['list_pages','get_firefox_info'].map(name=>({name,inputSchema:{type:'object',properties:{}}}))}));
server.setRequestHandler(CallToolRequestSchema,async req=>{
 calls++;
 if(req.params.arguments?.hang) await new Promise(resolve=>setTimeout(resolve,2000));
 return {content:[{type:'text',text:JSON.stringify({ordinal:calls,args:req.params.arguments})}]};
});
await server.connect(new StdioServerTransport());
