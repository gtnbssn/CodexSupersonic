import { createServer } from 'node:http';
import { handler } from '../build/handler.js';
const host=process.env.HOST ?? '0.0.0.0';
const port=Number(process.env.PORT ?? 3000);
createServer((request,response)=>{
 response.setHeader('Cross-Origin-Opener-Policy','same-origin');
 response.setHeader('Cross-Origin-Embedder-Policy','require-corp');
 handler(request,response);
}).listen(port,host,()=>console.log(`Confluence server listening on ${host}:${port}`));
