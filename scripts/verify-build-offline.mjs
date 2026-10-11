// Verification only: no config edits, no deployment, no hosted operations.
// Webpack permits this worktree's dependency junction; Next's documented test
// hook replaces Google font requests with a local real font fixture.
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const root=process.cwd(),directory=resolve(root,'.verification');
await mkdir(directory,{recursive:true});
const font=resolve(directory,'fixture.ttf');
await copyFile(resolve(root,'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf'),font);
const localFont=process.platform==='win32'?'//?/'+font.replaceAll('\\','/'):font;
await readFile(localFont); // Validate the local path before invoking the loader.
const mocks=resolve(directory,'font-mocks.cjs');
await writeFile(mocks,`module.exports=new Proxy({}, {get(_target,url){const family=String(url).includes('Mono')?'IBM Plex Mono':'IBM Plex Sans';return "/* latin */\\n@font-face {\\nfont-family: '"+family+"';\\nfont-style: normal;\\nfont-weight: 400 600;\\nsrc: url(${localFont}) format('truetype');\\n}\\n";}});\n`);
console.log('OFFLINE VERIFICATION: local substitute typography, inert public Supabase fixture, Webpack; never deploy this output.');
const child=spawn(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:root,stdio:'inherit',env:{...process.env,NEXT_FONT_GOOGLE_MOCKED_RESPONSES:mocks,NEXT_PUBLIC_SUPABASE_URL:'https://tms-verification.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'verification-public-key',SIGNUP_ENABLED:'false'}});
child.on('exit',code=>{process.exitCode=code??1;});
