ALTER TABLE `purchases` ADD `sale_source` text NOT NULL DEFAULT 'checkout';--> statement-breakpoint
ALTER TABLE `purchases` ADD `access_plan` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `payment_reference` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `recorded_by_admin_email` text;--> statement-breakpoint
ALTER TABLE `admin_audit_events` ADD `purchase_id` text REFERENCES purchases(id) ON DELETE SET NULL;
