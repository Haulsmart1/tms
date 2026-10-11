import { NextRequest,NextResponse } from 'next/server';
import { requireTenant,ApiError } from '../../../../lib/api/server';
import { createAdminClient } from '../../../../lib/supabase/admin';
import { hasActiveDriverLink } from '../../../../lib/jobs/officeAccess';
import { hasCapability } from '../../../../lib/permissions/capabilities';
import { INTEGRATIONS } from '../../../../lib/integrations/registry';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){try{const caller=await requireTenant(request);const driver=caller.tier==='staff'?await hasActiveDriverLink(createAdminClient(),caller.user.id):false;if(!hasCapability({tier:caller.tier,roleName:caller.roleName,hasActiveDriverLink:driver},'integrations.administer'))throw new ApiError(403,'Only company administrators can manage integrations.');return NextResponse.json({integrations:INTEGRATIONS,installations:[],installationManagementEnabled:false},{headers:{'Cache-Control':'no-store'}});}catch(error){return NextResponse.json({error:error instanceof ApiError?error.message:'Integrations are unavailable.'},{status:error instanceof ApiError?error.status:503,headers:{'Cache-Control':'no-store'}});}}
