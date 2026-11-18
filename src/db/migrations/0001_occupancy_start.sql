ALTER TABLE "app"."units" ADD COLUMN "occupancy_started_at" timestamp with time zone;
--> statement-breakpoint
-- Recover the boundary for communities that already used move-out before this release.
UPDATE "app"."units" AS u
SET "occupancy_started_at" = moved.at
FROM (
  SELECT community_id, entity_id, max(created_at) AS at
  FROM "app"."audit_logs"
  WHERE action = 'unit.move_out' AND entity_type = 'unit'
  GROUP BY community_id, entity_id
) AS moved
WHERE u.community_id = moved.community_id AND u.id::text = moved.entity_id;
--> statement-breakpoint
-- Legacy installations may have purged their move-out audit trail. A changed
-- binding code is the remaining conservative start date in this situation.
UPDATE "app"."units" AS u
SET "occupancy_started_at" = u.bind_code_updated_at
WHERE u.occupancy_started_at IS NULL AND u.bind_code_updated_at > u.created_at
  AND NOT EXISTS (
    SELECT 1 FROM "app"."audit_logs" a
    WHERE a.community_id = u.community_id AND a.entity_type = 'unit' AND a.entity_id = u.id::text
      AND a.action = 'unit.rotate_code' AND a.created_at >= u.bind_code_updated_at
      AND NOT EXISTS (SELECT 1 FROM "app"."residents" r WHERE r.unit_id = u.id AND r.status = 'removed')
  );
