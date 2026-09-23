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

const SUPABASE_SAFE_UPLOAD_BYTES = 45 * 1024 * 1024;

async function compressVideoInBrowser(file: File, onProgress: (progress: number) => void): Promise<File> {
  if (!file.type.startsWith("video/") || file.size <= SUPABASE_SAFE_UPLOAD_BYTES) return file;
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("Este navegador não oferece conversão automática de vídeo.");
  }

  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = false;
  video.playsInline = true;
  const url = URL.createObjectURL(file);
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Não foi possível abrir o vídeo para conversão."));
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("Duração do vídeo inválida.");

    const captureStream = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    if (!captureStream) throw new Error("Seu navegador não suporta conversão automática. Use Chrome ou Edge atualizado.");

    const stream = captureStream.call(video);
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      .find((type) => MediaRecorder.isTypeSupported(type)) || "";
    if (!mimeType) throw new Error("Não há codec de vídeo compatível para conversão neste navegador.");

    const targetBytes = 42 * 1024 * 1024;
    const totalBitrate = Math.max(350_000, Math.floor((targetBytes * 8) / video.duration));
    const audioBitsPerSecond = Math.min(96_000, Math.max(48_000, Math.floor(totalBitrate * 0.12)));
    const videoBitsPerSecond = Math.max(300_000, totalBitrate - audioBitsPerSecond);
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond, audioBitsPerSecond });

    const result = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error("Falha durante a conversão do vídeo."));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(";")[0] }));
    });

    const timer = window.setInterval(() => {
      if (video.duration) onProgress(Math.min(35, Math.max(1, Math.round((video.currentTime / video.duration) * 35))));
    }, 500);
    recorder.start(1000);
    await video.play();
    await new Promise<void>((resolve) => { video.onended = () => resolve(); });
    if (recorder.state !== "inactive") recorder.stop();
    const blob = await result;
    window.clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());

    if (!blob.size) throw new Error("A conversão gerou um arquivo vazio.");
    if (blob.size > SUPABASE_SAFE_UPLOAD_BYTES) throw new Error("O vídeo convertido ainda excede o limite do armazenamento. Reduza a duração/resolução do vídeo.");
    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${base}-otimizado.webm`, { type: blob.type || "video/webm", lastModified: Date.now() });
  } finally {
    video.pause();
    URL.revokeObjectURL(url);
    video.remove();
  }
}

export async function uploadCloudMedia(file: File, onProgress: (progress: number) => void) {
  requireConfiguration();
  const uploadFile = await compressVideoInBrowser(file, onProgress);
  const storagePath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeFileName(uploadFile.name)}`;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const adminSession = window.localStorage.getItem("sde-admin-session") ?? "";

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(uploadFile, {
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
        contentType: uploadFile.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024,
      onError: reject,
      onProgress: (uploaded, total) => onProgress(Math.max(36, 35 + Math.round((uploaded / total) * 65))),
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
