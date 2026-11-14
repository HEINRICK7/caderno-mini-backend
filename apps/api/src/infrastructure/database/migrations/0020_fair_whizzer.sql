CREATE TABLE `merchant_recurring_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`period_key` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `merchant_recurring_plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_recurring_charges_plan_period_unique` ON `merchant_recurring_charges` (`plan_id`,`period_key`);--> statement-breakpoint
CREATE INDEX `merchant_recurring_charges_owner_due` ON `merchant_recurring_charges` (`owner_user_id`,`due_date`,`status`);--> statement-breakpoint
CREATE INDEX `merchant_recurring_charges_owner_customer` ON `merchant_recurring_charges` (`owner_user_id`,`customer_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `merchant_recurring_pauses` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `merchant_recurring_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `merchant_recurring_pauses_owner_plan` ON `merchant_recurring_pauses` (`owner_user_id`,`plan_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `merchant_recurring_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`paid_at` integer NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `merchant_recurring_charges`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `merchant_recurring_payments_owner_charge` ON `merchant_recurring_payments` (`owner_user_id`,`charge_id`);--> statement-breakpoint
CREATE INDEX `merchant_recurring_payments_owner_paid` ON `merchant_recurring_payments` (`owner_user_id`,`paid_at`);--> statement-breakpoint
CREATE TABLE `merchant_recurring_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`description` text NOT NULL,
	`catalog_item_id` text,
	`amount_minor` integer NOT NULL,
	`frequency` text NOT NULL,
	`start_date` text NOT NULL,
	`due_day` integer,
	`end_date` text,
	`total_cycles` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `merchant_customers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `merchant_recurring_owner_status` ON `merchant_recurring_plans` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `merchant_recurring_owner_customer` ON `merchant_recurring_plans` (`owner_user_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `merchant_recurring_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`effective_date` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `merchant_recurring_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_recurring_rates_plan_effective_unique` ON `merchant_recurring_rates` (`plan_id`,`effective_date`);--> statement-breakpoint
CREATE INDEX `merchant_recurring_rates_owner_plan` ON `merchant_recurring_rates` (`owner_user_id`,`plan_id`,`effective_date`);