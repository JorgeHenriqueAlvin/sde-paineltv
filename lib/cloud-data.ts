import * as tus from "tus-js-client";
import { supabase, supabaseConfigured, supabaseProjectId } from "@/lib/supabase";

export type CloudMedia = {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  category: string;
  status: string;
  storagePath: string;
  url: string;
  createdAt: string;
};

export type CloudDevice = {
  id: number;
  name: string;
  code: string;
  unit: string;
  location: string;
  resolution: string;
  orientation: string;
  status: string;
  playlistId: number | null;
  lastSeen: string | null;
  publicToken: string;
};

export type CloudPlaylist = {
  id: number;
  name: string;
  status: string;
  itemCount: number;
  createdAt: string;
  mediaIds: number[];
};

export type CloudSchedule = {
  id: number;
  name: string;
  playlistId: number;
  startsAt: string;
  endsAt: string | null;
  status: string;
};

export type CloudData = {
  media: CloudMedia[];
  tvs: CloudDevice[];
  playlists: CloudPlaylist[];
  schedules: CloudSchedule[];
};

function requireConfiguration() {
  if (!supabaseConfigured) {
    throw new Error("Supabase ainda não foi configurado neste ambiente.");
  }
}

function storageUrl(path: string) {
  return supabase.storage.from("tv-media").getPublicUrl(path).data.publicUrl;
}

export async function fetchCloudData(): Promise<CloudData> {
  requireConfiguration();
  const [mediaResult, tvResult, playlistResult, itemResult, scheduleResult] = await Promise.all([
    supabase.from("media").select("*").order("created_at", { ascending: false }),
    supabase.from("tvs").select("*").order("created_at", { ascending: false }),
    supabase.from("playlists").select("*").order("created_at", { ascending: false }),
    supabase.from("playlist_items").select("playlist_id,media_id,position").order("position"),
    supabase.from("schedules").select("*").order("starts_at", { ascending: false }),
  ]);

  const error = mediaResult.error || tvResult.error || playlistResult.error || itemResult.error || scheduleResult.error;
  if (error) throw error;

  const media: CloudMedia[] = (mediaResult.data ?? []).map((row) => ({
    id: Number(row.id),
    name: row.name,
    mimeType: row.mime_type,
    size: Number(row.size),
    category: row.category,
    status: row.status,
    storagePath: row.storage_path,
    url: storageUrl(row.storage_path),
    createdAt: row.created_at,
  }));

  const itemsByPlaylist = new Map<number, number[]>();
  for (const row of itemResult.data ?? []) {
    const playlistId = Number(row.playlist_id);
    const ids = itemsByPlaylist.get(playlistId) ?? [];
    ids.push(Number(row.media_id));
    itemsByPlaylist.set(playlistId, ids);
  }

  return {
    media,
    tvs: (tvResult.data ?? []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      code: row.code,
      unit: row.unit,
      location: row.location,
      resolution: row.resolution,
      orientation: row.orientation,
      status: row.status,
      playlistId: row.playlist_id ? Number(row.playlist_id) : null,
      lastSeen: row.last_seen,
      publicToken: row.public_token,
    })),
    playlists: (playlistResult.data ?? []).map((row) => {
      const mediaIds = itemsByPlaylist.get(Number(row.id)) ?? [];
      return {
        id: Number(row.id),
        name: row.name,
        status: row.status,
        itemCount: mediaIds.length,
        createdAt: row.created_at,
        mediaIds,
      };
    }),
    schedules: (scheduleResult.data ?? []).map((row) => ({
      id: Number(row.id),
      name: row.name,
      playlistId: Number(row.playlist_id),
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
    })),
  };
}

function safeFileName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export async function uploadCloudMedia(file: File, onProgress: (progress: number) => void) {
  requireConfiguration();
  const storagePath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const adminSession = window.localStorage.getItem("sde-admin-session") ?? "";

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `https://${supabaseProjectId}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${publishableKey}`,
        apikey: publishableKey,
        "x-upsert": "false",
        "x-admin-session": adminSession,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "tv-media",
        objectName: storagePath,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: reject,
      onProgress: (uploaded, total) => onProgress(Math.max(1, Math.round((uploaded / total) * 100))),
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }).catch(reject);
  });

  const { error } = await supabase.from("media").insert({
    name: file.name,
    mime_type: file.type || "application/octet-stream",
    size: file.size,
    category: "Geral",
    status: "ready",
    storage_path: storagePath,
  });
  if (error) {
    await supabase.storage.from("tv-media").remove([storagePath]);
    throw error;
  }
}

export async function deleteCloudMedia(id: number) {
  const { data, error: fetchError } = await supabase.from("media").select("storage_path").eq("id", id).single();
  if (fetchError) throw fetchError;
  const { error: deleteError } = await supabase.from("media").delete().eq("id", id);
  if (deleteError) throw deleteError;
  if (data?.storage_path) await supabase.storage.from("tv-media").remove([data.storage_path]);
}

export async function deleteCloudPlaylist(id: number) {
  const { error } = await supabase.from("playlists").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteCloudSchedule(id: number) {
  const { error } = await supabase.from("schedules").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteCloudTv(id: number) {
  const { error } = await supabase.from("tvs").delete().eq("id", id);
  if (error) throw error;
}

export async function createCloudTv(payload: Record<string, unknown>) {
  const { error } = await supabase.from("tvs").insert({
    name: String(payload.name || "TV"),
    code: String(payload.code || "").toUpperCase(),
    unit: String(payload.unit || "Matriz"),
    location: String(payload.location || ""),
    resolution: String(payload.resolution || "1920x1080"),
    orientation: String(payload.orientation || "horizontal"),
    status: "offline",
    playlist_id: payload.playlistId ? Number(payload.playlistId) : null,
  });
  if (error) throw error;
}

export async function updateCloudTvPlaylist(id: number, playlistId: number | null) {
  const { error } = await supabase
    .from("tvs")
    .update({ playlist_id: playlistId })
    .eq("id", id);
  if (error) throw error;
}

export async function createCloudPlaylist(name: string, mediaIds: number[]) {
  const { data, error } = await supabase.from("playlists").insert({ name, status: "active" }).select("id").single();
  if (error) throw error;
  if (mediaIds.length) {
    const { error: itemError } = await supabase.from("playlist_items").insert(
      mediaIds.map((mediaId, position) => ({ playlist_id: data.id, media_id: mediaId, position })),
    );
    if (itemError) throw itemError;
  }
}

export async function createCloudSchedule(payload: Record<string, unknown>) {
  const { error } = await supabase.from("schedules").insert({
    name: String(payload.name || "Programação"),
    playlist_id: Number(payload.playlistId),
    starts_at: String(payload.startsAt),
    ends_at: payload.endsAt ? String(payload.endsAt) : null,
    status: "scheduled",
  });
  if (error) throw error;
}

export async function fetchCloudPlayer(code: string) {
  const normalizedCode = code.trim().toUpperCase();
  const { data: tv, error: tvError } = await supabase.from("tvs").select("*").eq("code", normalizedCode).maybeSingle();
  if (tvError) throw tvError;
  if (!tv) return { paired: false, code: normalizedCode } as const;
  if (!tv.playlist_id) return { paired: true, tv: { name: tv.name, code: tv.code }, items: [] } as const;

  const { data: playlist, error: playlistError } = await supabase.from("playlists").select("id,name").eq("id", tv.playlist_id).single();
  if (playlistError) throw playlistError;
  const { data: rows, error: itemError } = await supabase
    .from("playlist_items")
    .select("position,media:media_id(id,name,mime_type,storage_path)")
    .eq("playlist_id", tv.playlist_id)
    .order("position");
  if (itemError) throw itemError;

  const items = (rows ?? []).flatMap((row) => {
    const media = Array.isArray(row.media) ? row.media[0] : row.media;
    if (!media) return [];
    return [{
      id: Number(media.id),
      name: media.name,
      mimeType: media.mime_type,
      duration: 10,
      url: storageUrl(media.storage_path),
    }];
  });
  return { paired: true, tv: { name: tv.name, code: tv.code }, playlist: { name: playlist.name }, items } as const;
}
