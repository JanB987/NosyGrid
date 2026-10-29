import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
const licenses=await Promise.all(['LICENSE','node_modules/yaml/LICENSE'].map(file=>readFile(file,'utf8')));
const banner='/*! NosyGrid - MIT; bundled yaml - ISC.\n'+licenses.join('\n\n').replaceAll('*/','* /')+'\n*/';
await build({entryPoints:['src/main.ts'],bundle:true,external:['obsidian'],format:'cjs',target:'es2022',outfile:'dist/main.js',sourcemap:false,banner:{js:banner}});
for (const file of ['manifest.json','styles.css']) await copyFile(file, `dist/${file}`);
