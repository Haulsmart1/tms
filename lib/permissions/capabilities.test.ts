import{describe,it,expect}from'vitest';
import{CAPABILITIES,hasCapability}from'./capabilities';
describe('explicit capabilities',()=>{
 it('denies drivers and linked drivers all office capabilities',()=>{for(const capability of CAPABILITIES){expect(hasCapability({tier:'staff',roleName:'driver',hasActiveDriverLink:false},capability)).toBe(false);expect(hasCapability({tier:'staff',roleName:'staff',hasActiveDriverLink:true},capability)).toBe(false);}});
 it('explicit grants restrict and cannot escalate staff to integration administration',()=>{expect(hasCapability({tier:'staff',roleName:'staff',hasActiveDriverLink:false,grants:['integrations.administer']},'integrations.administer')).toBe(false);expect(hasCapability({tier:'admin',roleName:'admin',hasActiveDriverLink:false,grants:[]},'assistant.use')).toBe(false);});
});
