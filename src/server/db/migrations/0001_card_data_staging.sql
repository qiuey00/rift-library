CREATE TABLE `cards_staging` (
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
CREATE TABLE `printings_staging` (
	`scryfall_id` text PRIMARY KEY NOT NULL,
	`set_code` text NOT NULL,
	`set_name` text NOT NULL,
	`collector_number` text NOT NULL,
	`lang` text NOT NULL,
	`finishes` text NOT NULL,
	`rarity` text NOT NULL,
	`released_at` text NOT NULL,
	`image_small` text,
	`image_normal` text,
	`oracle_id` text NOT NULL
);
