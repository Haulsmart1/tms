import{describe,it,expect}from'vitest';
import{projectAssistantContext,advise,LocalGuidance,type AssistantContext}from'./context';
const caller={tier:'staff' as const,roleName:'staff',hasActiveDriverLink:false};
const context:AssistantContext={tenantId:'a',area:'jobs',facts:{status:'pending',secret:'never-send',customerBank:'never-send'},warnings:[]};
describe('Assistant context isolation',()=>{
 it('rejects foreign tenant, drivers and absent area grants',()=>{expect(()=>projectAssistantContext(caller,'b',context)).toThrow('ASSISTANT_FORBIDDEN');expect(()=>projectAssistantContext({...caller,roleName:'driver'},'a',context)).toThrow();expect(()=>projectAssistantContext({...caller,grants:['assistant.use']},'a',context)).toThrow();});
 it('projects only authorized minimal fields before calling any provider',async()=>{const safe=projectAssistantContext(caller,'a',context);expect(safe.facts).toEqual({status:'pending'});expect(JSON.stringify(await advise(new LocalGuidance(),safe,''))).not.toContain('never-send');});
 it('removes model-proposed mutations and refuses outputs without human approval',async()=>{const safe=projectAssistantContext(caller,'a',context);expect(await advise({async propose(){return[{kind:'next-step',text:'Review first',requiresApproval:true,execute:'allocate'}];}},safe,'')).toEqual([{kind:'next-step',text:'Review first',requiresApproval:true}]);await expect(advise({async propose(){return[{kind:'next-step',text:'x',requiresApproval:false as unknown as true}];}},safe,'')).rejects.toThrow('INVALID_AI_PROPOSAL');});
});
