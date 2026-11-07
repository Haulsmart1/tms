'use client';
import { useEffect, useId, useState } from 'react';
import Button from '../Button';
import { useTenant } from '../../app/components/TenantProvider';
import AssistantReview from './AssistantReview';

export default function RecordAssistant({area, entityId}: {area: 'jobs' | 'customers' | 'invoices'; entityId: string}) {
  const tenant = useTenant();
  const tenantId = tenant.writeTenantId;
  const panelId = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {setOpen(false);}, [area, entityId, tenantId]);
  if (tenant.status !== 'ready' || !tenantId) return null;
  return <div className="mt-4">
    <Button variant="secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      {open ? 'Close record guidance' : 'Review this record with Assistant'}
    </Button>
    {open && <section id={panelId} aria-label="Selected record guidance" className="mt-3 rounded-lg border border-line bg-surface p-4">
      <AssistantReview key={`${tenantId}:${area}:${entityId}`} tenantId={tenantId} area={area} entityId={entityId} />
    </section>}
  </div>;
}
