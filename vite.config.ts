import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vitest/config';
import type { Plugin, ViteDevServer, PreviewServer } from 'vite';
function isolationHeaders():Plugin {
 const configure=(server:ViteDevServer|PreviewServer)=>{server.middlewares.use((_request,response,next)=>{response.setHeader('Cross-Origin-Opener-Policy','same-origin');response.setHeader('Cross-Origin-Embedder-Policy','require-corp');next();});};
 return {name:'cross-origin-isolation',configureServer:configure,configurePreviewServer:configure};
}
export default defineConfig({plugins:[isolationHeaders(),sveltekit({adapter:adapter()})],test:{include:['src/**/*.test.ts'],environment:'node'}});
