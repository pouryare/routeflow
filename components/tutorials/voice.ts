import { soundChoice } from "@/lib/sound";
import { VOICE_CLIPS } from "@/lib/tutorials/voiceClips";

/** The spoken line for a tutorial step: a small mp3 made at build time (scripts/tutorial-voice.mjs)
 *  from the step's diacritised `say` text. Silent when the person switched sound off or the clip
 *  was not made. One clip plays at a time. */
let current: HTMLAudioElement | null = null;

export const voiceSrc = (id: string, i: number) => `/tutorials/voice/${id}-${i}.mp3`;

export function playVoice(id: string, i: number): void {
  stopVoice();
  if (typeof window === "undefined" || !VOICE_CLIPS.has(`${id}-${i}`)) return;
  const { choice, volume } = soundChoice();
  if (choice === "off") return;
  const a = new Audio(voiceSrc(id, i));
  a.volume = Math.min(1, Math.max(0.2, volume / 100));
  current = a;
  void a.play().catch(() => undefined);
}

export function stopVoice(): void {
  if (current) {
    current.pause();
    current = null;
  }
}
