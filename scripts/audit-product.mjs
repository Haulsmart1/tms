import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
async function files(root){const entries=await readdir(root,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(join(root,e.name)):join(root,e.name)))).flat();}
const pages=(await files('app')).filter(p=>p.endsWith('page.tsx')).sort();
const publicRoots=['/','/login','/signup','/auth/confirm','/terms','/privacy','/cookies','/legal','/dpa','/accessibility','/acceptable-use','/sub-processors','/security','/support-policy','/cancellation-policy'];
const rows=[];
for(const file of pages){
  const source=await readFile(file,'utf8');const route='/'+file.replaceAll('\\','/').replace(/^app\//,'').replace(/\/page.tsx$/,'').replace(/^page.tsx$/,'');
  const audience=publicRoots.includes(route)?'Public':/\[token\]/.test(route)?'Link recipient':route.startsWith('/driver')?'Driver':route.startsWith('/super-admin')?'Platform admin':route.startsWith('/settings')?'Company admin':route.startsWith('/subcontractor')?'Subcontractor':'Office';
  const labels=[...source.matchAll(/<(?:Button|button)\b[^>]*>\s*([^<{\n]{2,70})/g)].map(m=>m[1].trim()).filter(Boolean);
  const primary=labels[0]||'View '+(route.split('/').filter(Boolean).pop()||'product');
  const secondary=[...new Set(labels.slice(1,5))].join(', ')||'See linked workflow';
  const findings=[];
  if(/<button/.test(source))findings.push('Raw controls: review hierarchy');
  if(source.includes('"use client"')&&!/Skeleton|loading|Loading|pending|Pending/.test(source))findings.push('No loading signal in page source');
  if(source.includes('"use client"')&&!/error|Error|MessageBanner/.test(source))findings.push('No error signal in page source');
  if(/overflow-x-auto/.test(source))findings.push('Table: verify mobile scroll');
  if(/\.from\(/.test(source))findings.push('Preserve tenant gate/RLS');
  if(/window\.confirm|confirm\(/.test(source))findings.push('Keep consequential confirmation');
  if(route==='/settings/permissions')findings.push('Unavailable grant controls correctly removed; misleading Settings description');
  if(route==='/invoices')findings.push('Accounting proposal handoff/status missing; preserve ledger authority');
  rows.push(`| ${route} | ${audience} | ${primary.replaceAll('|','/')} | ${secondary.replaceAll('|','/')} | ${findings.join('; ')||'Shared/static presentation; runtime verification pending'} |`);
}
await mkdir('docs/reviews',{recursive:true});
await writeFile('docs/reviews/2026-10-10-product-audit.md',`# TMS product audit — 2026-10-10\n\nBaseline: clean integration/operational-baseline at 9cb0603. ${pages.length} page sources inspected. This is a source inventory, not a signed-in browser certification. Static findings are prompts for review, not proof of a broken control. Runtime console, keyboard, mobile and offline verification against live accounts is deliberately not attempted. Existing Driver PWA, SevenDay Planning, driver-aware scheduling and both billing models must be preserved.\n\n## Priorities and actions\n\n1. Shared Modal declares aria-modal but does not contain keyboard focus: fix containment and restore focus.\n2. Shared Button advertises loading but still invokes onClick: block repeated activation without losing keyboard focus.\n3. Console sidebar has fixed 220px width on every viewport: add an accessible mobile disclosure.\n4. Settings promises page-permission management even though grants are disabled: correct language, show authoritative role boundaries.\n5. Integrations are scattered in accounts/settings: add a central registry and honest Settings → Integrations catalogue.\n6. Contextual advisory assistance is missing: add permission-scoped, read-only context and a provider-neutral boundary, with local deterministic guidance.\n7. Debbie has no contract: add versioned proposal/customer-mapping/idempotency contracts and a mock only. No cross-database coupling.\n8. Compliance provenance is scattered: inventory rules, add effective-dated source records and explicitly distinguish law/policy/guidance/unverified. Do not alter uncertain regulatory semantics.\n\n## Every page\n\nPurpose follows its route; primary/secondary tasks below are extracted controls where available. Across all rows, duplicate control semantics, empty states, validation, focus, responsiveness, and contextual-assistant opportunities need entity-specific browser review. Assistant context is appropriate on office operations/commercial pages; driver/public/recipient/admin pages must not automatically share data. Existing README carries the deeper feature inventory.\n\n| Route / purpose | User | Primary task | Secondary tasks | Source findings / verification needs |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`);
console.log(`Inventoried ${pages.length} pages; no environment files or external systems accessed.`);
