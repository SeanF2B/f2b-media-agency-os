-- Project type and location shown on pipeline cards (already applied to production on 13 Nov 2026).
ALTER TABLE crm_opportunities ADD COLUMN project_location TEXT NOT NULL DEFAULT '';
ALTER TABLE crm_opportunities ADD COLUMN project_type TEXT NOT NULL DEFAULT '';
