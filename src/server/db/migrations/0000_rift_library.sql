CREATE TABLE `buy_list_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`printing_id` text,
	`quantity` integer NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "buy_list_items_quantity_above_zero" CHECK("buy_list_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE `card_data_status` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`cards_synced_at` text,
	`prices_updated_at` text,
	`card_count` integer DEFAULT 0 NOT NULL,
	`printing_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "card_data_status_one_row" CHECK("card_data_status"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`type` text NOT NULL,
	`supertype` text,
	`domains` text DEFAULT '[]' NOT NULL,
	`energy` integer,
	`might` integer,
	`power` integer,
	`champion_tag` text,
	`rules_text` text DEFAULT '' NOT NULL,
	`deckable` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_name_key_unique` ON `cards` (`name_key`);--> statement-breakpoint
CREATE INDEX `cards_name` ON `cards` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `copy_stacks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`printing_id` text NOT NULL,
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
	FOREIGN KEY (`printing_id`) REFERENCES `printings`(`riftcodex_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`came_from_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "copy_stacks_quantity_above_zero" CHECK("copy_stacks"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `copy_stacks_merge_rule` ON `copy_stacks` (`printing_id`,`finish`,`condition`,`language`,`misprint`,`altered`,`is_proxy`,`location_id`,(CASE WHEN "came_from_location_id" IS NULL THEN 0 ELSE "came_from_location_id" END));--> statement-breakpoint
CREATE INDEX `copy_stacks_location_id` ON `copy_stacks` (`location_id`);--> statement-breakpoint
CREATE TABLE `deck_slot_tags` (
	`slot_id` integer NOT NULL,
	`tag` text NOT NULL,
	`tag_key` text NOT NULL,
	PRIMARY KEY(`slot_id`, `tag_key`),
	FOREIGN KEY (`slot_id`) REFERENCES `deck_slots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_slot_tags_tag_key` ON `deck_slot_tags` (`tag_key`);--> statement-breakpoint
CREATE TABLE `deck_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`board` text NOT NULL,
	`quantity` integer NOT NULL,
	`picked_printing_id` text,
	`hint_public_code` text,
	`hint_foil` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deck_slots_quantity_above_zero" CHECK("deck_slots"."quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deck_slots_deck_card_board` ON `deck_slots` (`deck_id`,`card_id`,`board`);--> statement-breakpoint
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
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`parent_id` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`color` text,
	`for_trade` integer DEFAULT false NOT NULL,
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
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`copy_stack_id` integer NOT NULL,
	`printing_id` text NOT NULL,
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
	`removal_reason` text,
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
CREATE INDEX `movements_printing_id` ON `movements` (`printing_id`);--> statement-breakpoint
CREATE TABLE `printings` (
	`riftcodex_id` text PRIMARY KEY NOT NULL,
	`card_id` integer NOT NULL,
	`riftbound_id` text,
	`public_code` text NOT NULL,
	`set_code` text NOT NULL,
	`set_name` text NOT NULL,
	`collector_number` text NOT NULL,
	`rarity` text NOT NULL,
	`image_url` text,
	`artist` text,
	`alternate_art` integer DEFAULT false NOT NULL,
	`overnumbered` integer DEFAULT false NOT NULL,
	`signature` integer DEFAULT false NOT NULL,
	`tcgplayer_id` integer,
	`finishes` text DEFAULT '["normal","foil"]' NOT NULL,
	`price_normal` integer,
	`price_foil` integer,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `printings_card_id` ON `printings` (`card_id`);--> statement-breakpoint
CREATE INDEX `printings_public_code` ON `printings` ("public_code" COLLATE NOCASE);--> statement-breakpoint
CREATE INDEX `printings_tcgplayer_id` ON `printings` (`tcgplayer_id`);