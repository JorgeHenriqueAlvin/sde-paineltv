import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const media = sqliteTable("media", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), objectKey: text("object_key").notNull().unique(),
  mimeType: text("mime_type").notNull(), size: integer("size").notNull().default(0),
  category: text("category").notNull().default("Geral"),
  status: text("status").notNull().default("ready"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const playlists = sqliteTable("playlists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const playlistItems = sqliteTable("playlist_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playlistId: integer("playlist_id").notNull().references(() => playlists.id, { onDelete: "cascade" }),
  mediaId: integer("media_id").notNull().references(() => media.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0), duration: integer("duration").notNull().default(10),
});

export const tvs = sqliteTable("tvs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), code: text("code").notNull().unique(),
  unit: text("unit").notNull().default("Matriz"), location: text("location").notNull().default(""),
  resolution: text("resolution").notNull().default("1920x1080"),
  orientation: text("orientation").notNull().default("horizontal"),
  status: text("status").notNull().default("offline"),
  playlistId: integer("playlist_id").references(() => playlists.id, { onDelete: "set null" }),
  lastSeen: text("last_seen"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const schedules = sqliteTable("schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(),
  playlistId: integer("playlist_id").notNull().references(() => playlists.id, { onDelete: "cascade" }),
  startsAt: text("starts_at").notNull(), endsAt: text("ends_at"),
  status: text("status").notNull().default("scheduled"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
