import { NextRequest, NextResponse } from 'next/server';
import { requireTenant, ApiError } from '../../../lib/api/server';
import { createAdminClient } from '../../../lib/supabase/admin';
import { advise, LocalGuidance } from '../../../lib/assistant/context';
import { contextInputSchema, questionInputSchema, loadAssistantContext } from '../../../lib/assistant/serverContext';
import { assistantConfigured, GatewayAssistant } from '../../../lib/assistant/gateway';
import { reserveAssistantRequest } from '../../../lib/assistant/limits';
import { RULE_SOURCES } from '../../../lib/compliance/sources';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = {'Cache-Control': 'no-store'};
function failure(error: unknown) {
  if (!(error instanceof ApiError) && error instanceof Error && error.message !== 'ASSISTANT_FORBIDDEN') {
    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined;
    console.error('[tms-ai] unavailable', {type: error.name, statusCode});
  }
  const status = error instanceof ApiError ? error.status : error instanceof Error && error.message === 'ASSISTANT_FORBIDDEN' ? 403 : 502;
  return NextResponse.json({error: status === 403 ? 'You cannot use the Assistant in this area.' : error instanceof ApiError ? error.message : 'AI review is unavailable. Please try again. Your records have not changed.'}, {status, headers});
}
// Opening a panel loads local guidance only. Billable AI is an explicit POST.
export async function GET(request: NextRequest) {
  try {
    const caller = await requireTenant(request);
    const parsed = contextInputSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new ApiError(400, 'Choose a valid area, record and date.');
    const context = await loadAssistantContext(caller, parsed.data);
    return NextResponse.json({mode: 'local-guidance', context, proposals: await advise(new LocalGuidance(), context, ''), sources: context.area === 'compliance' ? RULE_SOURCES : [], providerConfigured: assistantConfigured()}, {headers});
  } catch (error) {return failure(error);}
}
async function readQuestion(request: NextRequest) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'Send a JSON question.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Enter a question.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12000) {await reader.cancel(); throw new ApiError(413, 'Please shorten your question.');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw new ApiError(400, 'Enter a valid question.');}
}
export async function POST(request: NextRequest) {
  try {
    const caller = await requireTenant(request);
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin) throw new ApiError(403, 'Use the Assistant inside TMS.');
    const parsed = questionInputSchema.safeParse(await readQuestion(request));
    if (!parsed.success) throw new ApiError(400, 'Enter a question of up to 2,000 characters and choose a valid record or date.');
    const {question, ...input} = parsed.data;
    const context = await loadAssistantContext(caller, input);
    if (!assistantConfigured()) throw new ApiError(503, 'AI is not enabled yet. Local guidance is still available.');
    await reserveAssistantRequest(createAdminClient(), caller.tenantId, caller.user.id);
    const proposals = await advise(new GatewayAssistant(request.signal), context, question);
    return NextResponse.json({mode: 'ai', context, proposals, providerConfigured: true, generatedAt: new Date().toISOString()}, {headers});
  } catch (error) {return failure(error);}
}
