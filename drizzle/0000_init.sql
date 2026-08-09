CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedule_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`week_start` text NOT NULL,
	`weekday` integer NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'not_working' NOT NULL,
	`location` text,
	`role` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_slot_unique` ON `schedule_entries` (`user_id`,`week_start`,`weekday`,`period`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`category` text DEFAULT 'doctor' NOT NULL,
	`working_slots` text DEFAULT '{}' NOT NULL,
	`can_work_ratho` integer DEFAULT false NOT NULL,
	`leave_entitlement` integer DEFAULT 0 NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`on_rota` integer DEFAULT true NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_initials_unique` ON `users` (`initials`);