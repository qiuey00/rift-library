CREATE TABLE `binder_mappings` (
	`manabox_name` text NOT NULL,
	`manabox_type` text NOT NULL,
	`location_id` integer NOT NULL,
	PRIMARY KEY(`manabox_name`, `manabox_type`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `buy_list_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`oracle_id` text NOT NULL,
	`scryfall_id` text,
	`quantity` integer NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`oracle_id`) REFERENCES `cards`(`oracle_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "buy_list_items_quantity_above_zero" CHECK("buy_list_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE `card_data_status` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`bulk_updated_at` text,
	`last_checked_at` text,
	`card_count` integer DEFAULT 0 NOT NULL,
	`printing_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "card_data_status_one_row" CHECK("card_data_status"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`oracle_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`front_face_name` text NOT NULL,
	`type_line` text NOT NULL,
	`mana_cost` text DEFAULT '' NOT NULL,
	`mana_value` real DEFAULT 0 NOT NULL,
	`color_identity` text DEFAULT '' NOT NULL,
	`commander_legality` text NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`can_be_commander` integer DEFAULT false NOT NULL,
	`is_basic_land` integer DEFAULT false NOT NULL,
	`allows_many` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cards_name` ON `cards` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `cards_front_face_name` ON `cards` ("front_face_name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `copy_stacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scryfall_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`finish` text NOT NULL,
	`condition` text NOT NULL,
	`language` text NOT NULL,
	`misprint` integer DEFAULT false NOT NULL,
	`altered` integer DEFAULT false NOT NULL,
	`is_proxy` integer DEFAULT false NOT NULL,
	`purchase_price` real,
	`purchase_currency` text,
	`location_id` integer NOT NULL,
	`came_from_location_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`scryfall_id`) REFERENCES `printings`(`scryfall_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`came_from_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "copy_stacks_quantity_above_zero" CHECK("copy_stacks"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `copy_stacks_merge_rule` ON `copy_stacks` (`scryfall_id`,`finish`,`condition`,`language`,`misprint`,`altered`,`is_proxy`,`location_id`,(CASE WHEN "came_from_location_id" IS NULL THEN 0 ELSE "came_from_location_id" END));--> statement-breakpoint
CREATE INDEX `copy_stacks_location_id` ON `copy_stacks` (`location_id`);--> statement-breakpoint
CREATE TABLE `deck_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`oracle_id` text NOT NULL,
	`board` text NOT NULL,
	`quantity` integer NOT NULL,
	`picked_scryfall_id` text,
	`hint_set_code` text,
	`hint_collector_number` text,
	`hint_foil` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`oracle_id`) REFERENCES `cards`(`oracle_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deck_slots_quantity_above_zero" CHECK("deck_slots"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_slots_deck_card_board` ON `deck_slots` (`deck_id`,`oracle_id`,`board`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`deck_box_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`opened_at` text,
	`deleted_at` text,
	FOREIGN KEY (`deck_box_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decks_deck_box_id_unique` ON `decks` (`deck_box_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`file_name` text,
	`target_location_id` integer,
	`deck_id` integer,
	`row_count` integer DEFAULT 0 NOT NULL,
	`card_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`parent_id` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`color` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `locations_parent_id` ON `locations` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `locations_one_inbox` ON `locations` (`type`) WHERE "locations"."type" = 'inbox';--> statement-breakpoint
CREATE TABLE `movement_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`deck_id` integer,
	`import_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`copy_stack_id` integer NOT NULL,
	`scryfall_id` text NOT NULL,
	`finish` text NOT NULL,
	`condition` text NOT NULL,
	`language` text NOT NULL,
	`misprint` integer DEFAULT false NOT NULL,
	`altered` integer DEFAULT false NOT NULL,
	`is_proxy` integer DEFAULT false NOT NULL,
	`purchase_price` real,
	`purchase_currency` text,
	`quantity` integer NOT NULL,
	`from_location_id` integer,
	`to_location_id` integer,
	`came_from_before` integer,
	`came_from_after` integer,
	`reason` text NOT NULL,
	`deck_id` integer,
	`slot_id` integer,
	`picked_before` text,
	`undoes_movement_id` integer,
	`undone_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `movements_batch_id` ON `movements` (`batch_id`);--> statement-breakpoint
CREATE INDEX `movements_created_at` ON `movements` (`created_at`);--> statement-breakpoint
CREATE INDEX `movements_deck_id` ON `movements` (`deck_id`);--> statement-breakpoint
CREATE INDEX `movements_scryfall_id` ON `movements` (`scryfall_id`);--> statement-breakpoint
CREATE TABLE `printings` (
	`scryfall_id` text PRIMARY KEY NOT NULL,
	`oracle_id` text NOT NULL,
	`set_code` text NOT NULL,
	`set_name` text NOT NULL,
	`collector_number` text NOT NULL,
	`lang` text NOT NULL,
	`finishes` text NOT NULL,
	`rarity` text NOT NULL,
	`released_at` text NOT NULL,
	`image_small` text,
	`image_normal` text,
	FOREIGN KEY (`oracle_id`) REFERENCES `cards`(`oracle_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `printings_oracle_id` ON `printings` (`oracle_id`);--> statement-breakpoint
CREATE INDEX `printings_set_code_collector_number` ON `printings` (`set_code`,`collector_number`);