CREATE TABLE `webhook_event_effects` (
	`effect_key` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `webhook_events` ADD `side_effect_dedupe_key` text;--> statement-breakpoint
ALTER TABLE `webhook_events` ADD `plan_frequency` text;