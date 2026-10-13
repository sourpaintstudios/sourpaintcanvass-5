import { useEffect, useRef, useState } from "react";
import { savePainting } from "@/lib/paint/db";
import { Hand } from "@/lib/paint/hand";
import { SourPaintListener, micReason, takePrimed } from "@/lib/paint/listener";
import { PracticePlayer } from "@/lib/paint/practice";
import { startSessionRecorder, type SessionRecorder } from "@/lib/paint/record";
import { FluidSession } from "@/lib/fluid/engine";
import { SILENT_FRAME, type PaintFrame, type SessionConfig } from "@/lib/paint/types";
import { genreById, paletteById } from "@/lib/paint/world";
import { useStudio } from "@/lib/studio";
import { Button } from "@/components/ui";

function blobFromCanvas(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg" = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not export the painting."));
    }, type, quality);
  });
}

export function StageScreen({ config }: { config: SessionConfig }) {
  const pop = useStudio((state) => state.pop);
  const showPiece = useStudio((state) => state.showPiece);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const finishRef = useRef<() => void>(() => {});
  const swapRef = useRef<"tender" | "hard" | null>(null);
  const adoptRef = useRef<SourPaintListener | null>(null);
  const aliveRef = useRef(true);
  const [hud, setHud] = useState<PaintFrame>(SILENT_FRAME);
  const [left, setLeft] = useState<number>(config.seconds);
  const [banner, setBanner] = useState<string | null>(
    config.source === "mic" ? "Allow the microphone. Then play. It keeps painting while you play." : null,
  );
  const [saving, setSaving] = useState(false);
  const [askLeave, setAskLeave] = useState(false);
  const [hint, setHint] = useState(false);
  const [micGate, setMicGate] = useState<"wait" | "live" | "down" | "off">(config.source === "mic" ? "wait" : "off");
  const genre = genreById(config.genreId);
  const styleName = config.subject.trim() || "Canvas";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let dead = false;
    let saved = false;
    let listener: SourPaintListener | null = null;
    let practice: PracticePlayer | null = null;
    const frames: PaintFrame[] = [];
    const fluid = null as FluidSession | null;
    const hand = new Hand(ctx, canvas.width, canvas.height);
    hand.begin();
    let recorder: SessionRecorder | null = null;
    let recording = false;
    const started = performance.now();
    const endAt = started + config.seconds * 1000;
    let quietSince = started;
    let lastHud = 0;
    let raf = 0;
    let lastFrame = SILENT_FRAME;

    const pushFrame = (frame: PaintFrame) => {
      if (frame.onset || frame.changed || frames.length === 0) frames.push(frame);
      else frames[frames.length - 1] = frame;
      if (frames.length > 12) frames.splice(0, frames.length - 12);
    };

    const beginRec = (audio: MediaStream | null) => {
      if (recorder || dead) return;
      recorder = startSessionRecorder(canvas, audio, config.seconds);
      recording = true;
    };

    const armPractice = (mode: "tender" | "hard", message: string | null) => {
      listener?.stop();
      listener = null;
      practice = new PracticePlayer(mode);
      practice.start(performance.now());
      if (message) setBanner(message);
      setHint(false);
      setMicGate("off");
      beginRec(null);
    };

    if (config.source === "mic") {
      const taken = takePrimed();
      const bind = (ear: SourPaintListener) => {
        listener = ear;
        ear.onFrame = pushFrame;
      };
      const kick = (ok: boolean) => {
        if (dead || recording) return;
        if (!ok || !listener?.mediaStream()) {
          setMicGate("down");
          setBanner(taken.reason() || "The mic did not open. Tap Try the mic.");
          return;
        }
        setMicGate("live");
        setBanner(null);
        beginRec(listener.mediaStream());
        const stream = listener.mediaStream();
        if (stream) void fluid?.attach(stream, performance.now());
      };
      if (taken.listener) {
        bind(taken.listener);
        if (taken.listener.mediaStream()) kick(true);
        else {
          void taken.ready.then((ok) => {
            kick(ok && Boolean(listener?.mediaStream()));
          });
        }
      } else {
        const ear = new SourPaintListener();
        bind(ear);
        void ear.start().then(() => kick(true)).catch((error: unknown) => {
          ear.stop();
          if (listener === ear) listener = null;
          if (dead || recording) return;
          setMicGate("down");
          setBanner(micReason(error));
        });
      }
    } else {
      practice = new PracticePlayer(config.source);
      practice.start(started);
      beginRec(null);
    }

    let videoBlob: Blob | null = null;
    let video30: Blob | null = null;
    let video60: Blob | null = null;
    let video90: Blob | null = null;

    const finish = async () => {
      if (dead || saved) return;
      saved = true;
      setSaving(true);
      cancelAnimationFrame(raf);
      try {
        if (fluid) {
          fluid.draw(ctx, canvas.width, canvas.height);
          fluid.stop();
        }
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        const cuts = (await recorder?.stop()) ?? null;
        videoBlob = cuts?.full ?? null;
        video30 = cuts?.s30 ?? null;
        video60 = cuts?.s60 ?? null;
        video90 = cuts?.s90 ?? null;
        listener?.stop();
        listener = null;
        const png = await blobFromCanvas(canvas);
        const thumbCanvas = document.createElement("canvas");
        thumbCanvas.width = 360;
        thumbCanvas.height = 640;
        thumbCanvas.getContext("2d")?.drawImage(canvas, 0, 0, 360, 640);
        const thumb = await blobFromCanvas(thumbCanvas, "image/jpeg", 0.72);
        const subject = config.subject.trim();
        const title = subject || "Untitled";
        const id = crypto.randomUUID();
        await savePainting({
          id,
          createdAt: Date.now(),
          title,
          config,
          styleName,
          genreName: genre.name,
          paletteName: paletteById(config.paletteId).name,
          hasVideo: videoBlob != null,
          hasAudio: recorder?.hasAudio ?? false,
          thumb,
          png,
          video: videoBlob,
          video30,
          video60,
          video90,
        });
        if (!dead) showPiece(id);
      } catch (error) {
        listener?.stop();
        fluid?.stop();
        listener = null;
        saved = false;
        setSaving(false);
        setBanner(error instanceof Error ? error.message : "Could not save the painting.");
      }
    };

    finishRef.current = () => {
      void finish();
    };

    const loop = (now: number) => {
      if (dead || saved) return;
      if (swapRef.current) {
        const mode = swapRef.current;
        swapRef.current = null;
        armPractice(mode, mode === "hard" ? "Hard practice brush. Silent." : "Tender practice brush. Silent.");
      }
      if (adoptRef.current) {
        const ear = adoptRef.current;
        adoptRef.current = null;
        practice = null;
        listener?.stop();
        listener = ear;
        ear.onFrame = pushFrame;
        setMicGate("live");
        setBanner(null);
        setHint(false);
        if (!recording) {
          beginRec(ear.mediaStream());
          const stream = ear.mediaStream();
          if (stream) void fluid?.attach(stream, performance.now());
        }
      }
      if (fluid) {
        fluid.step(now);
        fluid.draw(ctx, canvas.width, canvas.height);
        lastFrame = { ...SILENT_FRAME, level: fluid.ampNow, sounding: fluid.ampNow > 0.08 };
      } else {
        if (practice) frames.push(practice.frame(now));
        let heard = frames.length ? frames[frames.length - 1] : null;
        let struck = false;
        while (frames.length) {
          const frame = frames.shift();
          if (!frame) break;
          lastFrame = frame;
          heard = frame;
          if (frame.onset) struck = true;
        }
        if (heard && struck) heard = { ...heard, onset: true };
        hand.tick(now, heard);
      }
      recorder?.note(now - started);
      if (now - lastHud > 100) {
        lastHud = now;
        setHud(lastFrame);
        setLeft(Math.max(0, (endAt - now) / 1000));
      }
      if (now >= endAt) {
        void finish();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dead = true;
      aliveRef.current = false;
      document.body.style.overflow = previous;
      if (!saved) {
        cancelAnimationFrame(raf);
        adoptRef.current?.stop();
        adoptRef.current = null;
        listener?.stop();
        fluid?.stop();
        recorder?.cancel();
      }
    };
  }, [config, genre.name, showPiece]);

  function retryMic() {
    const ear = new SourPaintListener();
    setMicGate("wait");
    setBanner("Allow the microphone.");
    void ear.start().then(() => {
      if (!aliveRef.current) {
        ear.stop();
        return;
      }
      adoptRef.current = ear;
    }).catch((error: unknown) => {
      ear.stop();
      if (!aliveRef.current) return;
      setMicGate("down");
      setBanner(micReason(error));
    });
  }

  const note = hud.approach > 0.22 ? "Toward" : hud.approach < -0.22 ? "Away" : "—";
  const mood = hud.lift > 0.18 ? "Rising" : hud.lift < -0.18 ? "Falling" : hud.onset ? "Strike" : "—";

  return (
    <div className="fixed inset-0 bg-background">
      <canvas ref={canvasRef} width={1080} height={1920} className="h-full w-full object-contain" />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between pt-safe pb-safe">
        <div className="pointer-events-auto flex items-start justify-between gap-3 px-3 pt-3">
          <button type="button" onClick={() => setAskLeave(true)} className="h-11 rounded-full bg-background/80 px-3 text-sm">
            Back
          </button>
          <div className="rounded-full bg-background/80 px-3 py-2 text-center">
            <div className="num text-lg">{Math.ceil(left)}s</div>
            <div className="text-xs text-subtle">{styleName}</div>
          </div>
          <div className="h-11 min-w-11 rounded-full bg-background/80 px-3 py-2 text-right">
            <div className="text-sm text-brand">{note}</div>
            <div className="text-xs text-subtle">{mood}</div>
          </div>
        </div>
        <div className="pointer-events-auto space-y-3 px-3 pb-3">
          {banner && <p className="rounded-2xl bg-background/85 px-3 py-2 text-sm">{banner}</p>}
          {micGate === "down" && !saving && (
            <Button full onClick={retryMic}>
              Try the mic
            </Button>
          )}
          <div className="h-2 overflow-hidden rounded-full bg-elevated">
            <div className="h-full bg-brand" style={{ width: `${Math.round(hud.level * 100)}%` }} />
          </div>
          {micGate === "live" && !hud.note && !saving && (
            <p className="rounded-2xl bg-background/85 px-3 py-2 text-sm">
              A note is a short stroke. A run stays connected. Silence lifts the pen.
            </p>
          )}
          <Button full onClick={() => finishRef.current()} disabled={saving}>
            {saving ? "Locking the painting…" : "Done"}
          </Button>
        </div>
      </div>
      {askLeave && (
        <div className="absolute inset-0 flex items-end bg-background/70 p-4 pb-safe">
          <div className="w-full rounded-3xl bg-elevated p-4">
            <p className="text-lg">Leave this painting? It will not be saved.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setAskLeave(false)}>
                Stay
              </Button>
              <Button
                onClick={() => {
                  setAskLeave(false);
                  pop();
                }}
              >
                Leave
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
