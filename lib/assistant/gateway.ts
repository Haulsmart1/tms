import 'server-only';
import type { AssistantContext, AssistantProvider } from './context';
import { generateAssistantReview } from './request';

export function assistantConfigured() {
  return process.env.TMS_AI_ENABLED === 'true' && Boolean(process.env.TMS_AI_MODEL?.trim());
}

export class GatewayAssistant implements AssistantProvider {
  constructor(private signal?: AbortSignal) {}
  async propose(context: AssistantContext, question: string) {
    if (!assistantConfigured()) throw new Error('AI_NOT_CONFIGURED');
    return generateAssistantReview(context, question, {model: process.env.TMS_AI_MODEL!.trim(), signal: this.signal});
  }
}
