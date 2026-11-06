/** Makes the spoken clip of every tutorial step (plan docs/plans/tutorials-2026-11-05.md section 13).
 *
 *    ELEVENLABS_API_KEY=… npm run voice:tutorials -- [--dry] [--budget 9000]
 *
 *  Voice: ElevenLabs v4, Jessica (owner choice, decision 10.19). The text spoken is the step's `say`
 *  (diacritics added by hand); a step with no `say` is skipped and listed, because the plain text is
 *  read worse. Clips are mp3 files under public/tutorials/voice/, named `<tutorial id>-<step>.mp3`,
 *  and are made once at build time: the server never calls ElevenLabs. A clip whose text, voice and
 *  model are unchanged is kept (manifest.json), so only edited steps cost credits again.
 *
 *  Order: bar tours first, then «اولین قدم‌ها», then the rest, so a limited balance covers what
 *  people meet first. `--budget N` stops before N characters are spent this run.
 *  shortcut: one request per clip, no retry on a 429; run again and it continues. */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { TUTORIALS } from "../lib/tutorials/catalog.ts";

const VOICE = "cgSgspJ2msm6clMCkdW9"; // Jessica
const MODEL = "eleven_v4";
const DIR = "public/tutorials/voice";
const MANIFEST = `${DIR}/manifest.json`;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const budget = Number(args[args.indexOf("--budget") + 1]) || Infinity;
const key = process.env.ELEVENLABS_API_KEY;
if (!dry && !key) {
  console.error("Set ELEVENLABS_API_KEY in the environment (never in a file).");
  process.exit(1);
}

const manifest: Record<string, string> = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const rank = (t: (typeof TUTORIALS)[number]) => (t.autoStart ? 0 : t.firstSteps ? 1 : 2);
const ordered = [...TUTORIALS].sort((a, b) => rank(a) - rank(b));

mkdirSync(DIR, { recursive: true });
let spent = 0;
const missing: string[] = [];
let made = 0;
let kept = 0;

for (const t of ordered) {
  for (let i = 0; i < t.steps.length; i++) {
    const id = `${t.id}-${i}`;
    const text = t.steps[i].say;
    if (!text) {
      missing.push(id);
      continue;
    }
    const hash = createHash("sha256").update(`${VOICE}|${MODEL}|${text}`).digest("hex").slice(0, 16);
    if (manifest[id] === hash && existsSync(`${DIR}/${id}.mp3`)) {
      kept++;
      continue;
    }
    if (spent + text.length > budget) continue;
    spent += text.length;
    if (dry) continue;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_64`, {
      method: "POST",
      headers: { "xi-api-key": key!, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: MODEL }),
    });
    if (!res.ok) {
      console.error(`${id}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      spent -= text.length;
      if (res.status === 401 || res.status === 429) break;
      continue;
    }
    writeFileSync(`${DIR}/${id}.mp3`, Buffer.from(await res.arrayBuffer()));
    manifest[id] = hash;
    made++;
  }
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + "\n");
const have = Object.keys(manifest).filter((id) => existsSync(`${DIR}/${id}.mp3`)).sort();
writeFileSync(
  "lib/tutorials/voiceClips.ts",
  `/** Which step clips exist under public/tutorials/voice, written by scripts/tutorial-voice.ts.\n *  Do not edit by hand. */\nexport const VOICE_CLIPS: ReadonlySet<string> = new Set<string>(${JSON.stringify(have)});\n`,
);
console.log(`${dry ? "would spend" : "spent"} ${spent} characters; made ${made}, kept ${kept}, ${missing.length} steps have no \`say\` yet`);
