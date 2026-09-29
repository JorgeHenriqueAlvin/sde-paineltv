"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";

const topic = "sde-tv-presence-v1";
type PlayerPresence = { code: string; kind: "player" };
type PresenceSnapshot = { ready: boolean; codes: Set<string> };

// This is connection telemetry only; it never authorizes writes to TV records.
export function usePlayerPresence(code: string, paired: boolean) {
  useEffect(() => {
    if (!supabaseConfigured || !paired || !code) return;
    let active = true;
    const channel = supabase.channel(topic, {
      config: { presence: { key: crypto.randomUUID() } },
    });
    channel.on("presence", { event: "sync" }, () => {}).subscribe((status) => {
      if (active && status === "SUBSCRIBED") {
        void channel.track({ kind: "player", code: code.trim().toUpperCase() })
          .then((result) => {
            if (active && result !== "ok") console.warn("[tv-presence] Falha ao anunciar conexão", result);
          }).catch((error) => console.error("[tv-presence]", error));
      } else if (active && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) {
        console.warn("[tv-presence] Conexão indisponível", status);
      }
    });
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [code, paired]);
}

export function useTvPresence(enabled: boolean): PresenceSnapshot {
  const [snapshot, setSnapshot] = useState<PresenceSnapshot>({ ready: false, codes: new Set() });
  useEffect(() => {
    if (!enabled || !supabaseConfigured) return;
    setSnapshot({ ready: false, codes: new Set() });
    let active = true;
    const channel = supabase.channel(topic);
    channel.on("presence", { event: "sync" }, () => {
      if (!active) return;
      const codes = new Set<string>();
      for (const presences of Object.values(channel.presenceState<PlayerPresence>())) {
        for (const presence of presences) {
          if (presence.kind === "player" && typeof presence.code === "string") {
            codes.add(presence.code.trim().toUpperCase());
          }
        }
      }
      setSnapshot({ ready: true, codes });
    }).subscribe((status) => {
      if (active && status !== "SUBSCRIBED") {
        setSnapshot({ ready: false, codes: new Set() });
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[tv-presence] Não foi possível verificar as TVs", status);
        }
      }
    });
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [enabled]);
  return enabled ? snapshot : { ready: false, codes: new Set() };
}
