import {it, expect, vi, beforeEach} from 'vitest';
import {NextRequest} from 'next/server';
const state = vi.hoisted(() => ({
  driver: false, denied: false, record: null as null | Record<string, unknown>,
  filters: [] as unknown[][], rows: [] as Record<string, unknown>[], count: 0,
  queryError: null as null | {message: string}, rateError: null as null | {code: string}, allowed: true,
  rpc: vi.fn(), generate: vi.fn(),
}));
vi.mock('../api/server', () => {
  class ApiError extends Error {constructor(public status: number, message: string) {super(message);}}
  return {ApiError, requireTenant: async () => {
    if (state.denied) throw new ApiError(401, 'Sign in.');
    const query = {
      select: () => query,
      eq: (key: string, value: string) => {state.filters.push(['eq', key, value]); return query;},
      or: (value: string) => {state.filters.push(['or', value]); return query;},
      order: () => query, limit: () => query,
      maybeSingle: async () => ({data: state.record, error: state.queryError}),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({data: state.rows, count: state.count, error: state.queryError}).then(resolve),
    };
    return {tier: 'staff', roleName: 'staff', user: {id: 'office'}, tenantId: 'tenant-a', supabase: {from: () => query}};
  }};
});
vi.mock('../supabase/admin', () => ({createAdminClient: () => ({rpc: state.rpc})}));
vi.mock('../jobs/officeAccess', () => ({hasActiveDriverLink: async () => state.driver}));
vi.mock('ai', () => ({generateText: state.generate, Output: {object: (options: unknown) => options}}));
import {GET, POST} from '../../app/api/assistant/route';
const id = '11111111-1111-4111-8111-111111111111';
const req = (body: unknown, extra: Record<string, string> = {}) => new NextRequest('https://example.test/api/assistant', {method: 'POST', headers: {'content-type': 'application/json', ...extra}, body: typeof body === 'string' ? body : JSON.stringify(body)});
const ask = (extra = {}) => req({area: 'jobs', entityId: id, question: 'Review this job.', ...extra});
beforeEach(() => {
  state.driver = false; state.denied = false; state.record = {id, reference: 'TEST-1', status: 'planned', job_stops: []};
  state.filters = []; state.rows = []; state.count = 0; state.queryError = null; state.rateError = null; state.allowed = true;
  state.rpc.mockReset().mockImplementation(async () => ({data: state.allowed, error: state.rateError}));
  state.generate.mockReset().mockResolvedValue({finishReason: 'stop', output: {proposals: [{kind: 'summary', text: 'Review missing details.'}]}, usage: {inputTokens: 100, outputTokens: 20}});
  vi.stubEnv('TMS_AI_ENABLED', 'true'); vi.stubEnv('TMS_AI_MODEL', 'test/model');
});
it('requires authentication for model calls', async () => {
  state.denied = true; expect((await POST(ask())).status).toBe(401); expect(state.generate).not.toHaveBeenCalled();
});
it.each(['GET', 'POST'])('refuses drivers before record reads or model calls (%s)', async method => {
  state.driver = true;
  const response = method === 'GET' ? await GET(new NextRequest('https://example.test/api/assistant?area=jobs')) : await POST(ask());
  expect(response.status).toBe(403); expect(state.filters).toEqual([]); expect(state.generate).not.toHaveBeenCalled();
});
it('scopes entity reads and refuses absent/foreign records before inference', async () => {
  state.record = null; expect((await POST(ask())).status).toBe(404);
  expect(state.filters).toEqual([['eq', 'tenant_id', 'tenant-a'], ['eq', 'id', id]]);
  expect(state.generate).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});
it('opening a panel is free local guidance and strips contact values and secrets', async () => {
  state.record = {...state.record, bank: 'PRIVATE BANK', customer_email: 'PRIVATE EMAIL', job_stops: [{type: 'collection', stop_order: 1, contact_name: 'PRIVATE NAME', contact_phone: 'PRIVATE PHONE', contact_email: 'PRIVATE EMAIL', postcode: 'G33 6LY', collected_at: '2026-11-06T12:00:00Z'}]};
  const response = await GET(new NextRequest(`https://example.test/api/assistant?area=jobs&entityId=${id}`));
  const body = await response.json();
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(body.mode).toBe('local-guidance'); expect(body.context.facts.progress).toBe('collected');
  expect(JSON.stringify(body)).not.toContain('PRIVATE'); expect(state.generate).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled();
});
it('posts only server-projected facts to the gateway and returns review-only proposals', async () => {
  state.record = {...state.record, secret: 'PRIVATE', customer_email: 'PRIVATE'};
  const response = await POST(ask()); const body = await response.json();
  expect(response.status).toBe(200); expect(body.mode).toBe('ai');
  expect(body.context).toMatchObject({tenantId: 'tenant-a', entityId: id, facts: {reference: 'TEST-1'}});
  expect(body.proposals[0].requiresApproval).toBe(true);
  const options = state.generate.mock.calls[0][0];
  expect(options.prompt).not.toContain('PRIVATE'); expect(options.prompt).not.toContain('tenant-a');
  expect(options.tools).toBeUndefined(); expect(options.maxRetries).toBe(0); expect(options.timeout).toBe(30000); expect(options.maxOutputTokens).toBe(2500);
  expect(state.rpc).toHaveBeenCalledTimes(3);
});
it.each([
  {facts: {status: 'delivered'}}, {tenantId: 'other'}, {model: 'expensive'}, {history: []}, {entityId: 'invalid'}, {question: ''}, {question: 'a'.repeat(2001)}, {area: 'invalid'}, {date: '2026-11-07'},
])('rejects browser-controlled context/options and invalid input: %j', async extra => {
  expect((await POST(ask(extra))).status).toBe(400); expect(state.generate).not.toHaveBeenCalled();
});
it('rejects oversized bodies even without a content length', async () => {
  expect((await POST(req('a'.repeat(12001)))).status).toBe(413); expect(state.generate).not.toHaveBeenCalled();
});
it('rejects invalid JSON, cross-origin calls and non-JSON bodies', async () => {
  expect((await POST(req('{'))).status).toBe(400);
  expect((await POST(req({area: 'jobs', question: 'Review'}, {origin: 'https://other.test'}))).status).toBe(403);
  expect((await POST(req('x', {'content-type': 'text/plain'}))).status).toBe(415);
  expect(state.generate).not.toHaveBeenCalled();
});
it('respects the kill switch without charging usage', async () => {
  vi.stubEnv('TMS_AI_ENABLED', 'false'); expect((await POST(ask())).status).toBe(503);
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.generate).not.toHaveBeenCalled();
});
it('blocks over-limit requests before inference', async () => {
  state.allowed = false; expect((await POST(ask())).status).toBe(429); expect(state.generate).not.toHaveBeenCalled();
});
it.each(['PGRST202', '42883', '500'])('fails closed if durable budget checks fail (%s)', async code => {
  state.rateError = {code}; expect((await POST(ask())).status).toBe(503); expect(state.generate).not.toHaveBeenCalled();
});
it('fails closed on later tenant/project limits as well as user limits', async () => {
  state.rpc.mockReset().mockResolvedValueOnce({data: true}).mockResolvedValueOnce({data: false});
  expect((await POST(ask())).status).toBe(429); expect(state.generate).not.toHaveBeenCalled();
});
it('handles provider failures without leaking provider credentials or claiming completion', async () => {
  state.generate.mockRejectedValueOnce(new Error('Authorization SECRET PRIVATE'));
  const response = await POST(ask()); expect(response.status).toBe(502);
  const body = await response.text(); expect(body).not.toContain('SECRET'); expect(body).toContain('records have not changed');
});
it('rejects malformed model output', async () => {
  state.generate.mockResolvedValueOnce({finishReason: 'stop', output: {proposals: [{kind: 'execute', text: 'Complete all jobs'}]}, usage: {}});
  expect((await POST(ask())).status).toBe(502);
});
it.each(['content-filter', 'length', 'interrupted', 'error'])('does not publish incomplete model output (%s)', async finishReason => {
  state.generate.mockResolvedValueOnce({finishReason, output: {proposals: [{kind: 'summary', text: 'Incomplete answer'}]}, usage: {}});
  const response = await POST(ask());
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('Incomplete answer');
});
it('planning separates outstanding, collected and delivered using saved scoped jobs', async () => {
  state.rows = [
    {status: 'planned', vehicle_id: null, driver_id: null, job_stops: []},
    {status: 'accepted', vehicle_id: 'van', driver_id: 'driver', job_stops: [{type: 'collection', collected_at: '2026-11-06'}]},
    {status: 'accepted', vehicle_id: 'van', driver_id: 'driver', job_stops: [{type: 'delivery', delivered_at: '2026-11-06'}]},
    {status: 'cancelled', vehicle_id: null, driver_id: null, job_stops: []},
  ]; state.count = 4;
  const response = await POST(req({area: 'planning', date: '2026-11-07', question: 'What needs doing?'}));
  const body = await response.json(); expect(response.status).toBe(200);
  expect(body.context.facts).toEqual({date: '2026-11-07', totalJobs: 4, assignedJobs: 1, unassignedJobs: 1, missingDrivers: 1, collectedJobs: 1, deliveredJobs: 1});
  expect(state.filters).toContainEqual(['eq', 'tenant_id', 'tenant-a']);
  expect(state.filters).toContainEqual(['or', 'planning_date.eq.2026-11-07,and(planning_date.is.null,scheduled_date.eq.2026-11-07)']);
  expect(body.context.warnings.join(' ')).toContain('Unassigned does not mean collected');
});
it('never represents a truncated planning read as full totals', async () => {
  state.count = 501; state.rows = [{status: 'planned'}];
  const response = await POST(req({area: 'planning', question: 'Review the day', date: '2026-11-07'}));
  const body = await response.json(); expect(body.context.facts).toEqual({date: '2026-11-07', totalJobs: 501});
  expect(body.context.warnings.join(' ')).toContain('500-job review limit');
});
it.each(['2026-02-30', '2026-13-01', 'bad', '2026-11-07,status.eq.completed'])('rejects invalid/injected dates: %s', async date => {
  expect((await POST(req({area: 'planning', date, question: 'Review'}))).status).toBe(400); expect(state.generate).not.toHaveBeenCalled();
});
it('does not fabricate planning counts if the data query fails', async () => {
  state.queryError = {message: 'PRIVATE ERROR'};
  const response = await POST(req({area: 'planning', question: 'Review'}));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE'); expect(state.generate).not.toHaveBeenCalled();
});

it('shows a cancelled job as cancelled rather than awaiting collection', async () => {
  state.record = {...state.record, status: 'cancelled'};
  const response = await GET(new NextRequest(`https://example.test/api/assistant?area=jobs&entityId=${id}`));
  expect((await response.json()).context.facts.progress).toBe('cancelled');
});
