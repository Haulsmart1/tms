-- The legacy maintenance trigger references NEW.mileage, but
-- telematics_positions has no mileage column. This caused all new
-- telematics position inserts, including driver phone GPS, to fail.
--
-- Keep check_service_due() in place for now so maintenance automation
-- can be redesigned later against a real odometer/mileage source.

drop trigger if exists trg_check_service
on public.telematics_positions;
