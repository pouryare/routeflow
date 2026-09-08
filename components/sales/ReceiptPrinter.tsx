"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { drawReceipt, type ReceiptData } from "@/lib/receiptLayout";
import { DOTS_58MM, packRaster, receiptBytes, chunk } from "@/lib/escpos";
import { receiptPdf } from "@/lib/receiptPdf";

/** Known BLE service/characteristic pairs for 58mm ESC/POS printers.
 *
 *  There is no standard here -- each manufacturer picks its own -- so this is an
 *  allow-list rather than a lookup, and an unknown printer means adding a pair. The
 *  first is by far the most common; the third is the Microchip/ISSC transparent UART
 *  module that a lot of cheap printers are built around.
 */
const PRINTER_SERVICES: { service: string; write: string }[] = [
  { service: "000018f0-0000-1000-8000-00805f9b34fb", write: "00002af1-0000-1000-8000-00805f9b34fb" },
  { service: "0000ff00-0000-1000-8000-00805f9b34fb", write: "0000ff02-0000-1000-8000-00805f9b34fb" },
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", write: "49535343-8841-43f4-a8d4-ecbe34729bb3" },
];

/** BLE writes are small and the printer's own buffer is smaller than a receipt. Writing
 *  the whole job at once overruns it and prints garbage from halfway down, so the job
 *  goes out in pieces with a pause between them. */
const CHUNK_BYTES = 180;
const CHUNK_PAUSE_MS = 20;

const STORAGE_KEY = "receipt-transport";
const CANVAS_HEIGHT = 1400;

type Transport = "bluetooth" | "share" | "pdf" | "print";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Which transports this browser has, read through useSyncExternalStore rather than an
 *  effect.
 *
 *  `navigator` does not exist while rendering on the server, so this cannot be computed
 *  during render, and setting it from an effect costs a second render pass on a screen
 *  used at a doorstep. useSyncExternalStore is what the pattern is for: a server
 *  snapshot of "nothing available" that matches the HTML, and a client snapshot read
 *  once. Both snapshots must be referentially stable or React re-renders forever, which
 *  is why they are cached module-side rather than built per call. */
const NO_SUBSCRIBE = () => () => {};
const SERVER_CAPABILITIES = { bluetooth: false, share: false } as const;
let capabilities: { bluetooth: boolean; share: boolean } | null = null;

function readCapabilities() {
  if (!capabilities) {
    capabilities = {
      bluetooth: "bluetooth" in navigator,
      share: typeof navigator.canShare === "function",
    };
  }
  return capabilities;
}

function readStoredTransport(): Transport | null {
  try {
    return (localStorage.getItem(STORAGE_KEY) as Transport | null) ?? null;
  } catch {
    // Private browsing, or site data blocked. The buttons all still work.
    return null;
  }
}

/** Printing a receipt at the door.
 *
 *  Four transports over one canvas. Which one a driver gets depends on hardware nobody
 *  controls from here -- an older printer speaks Bluetooth Classic, which a browser
 *  cannot reach at all, and iOS has no Web Bluetooth in any browser -- so the ladder
 *  degrades rather than failing:
 *
 *    1. Web Bluetooth  one tap after the first pairing. BLE printers only.
 *    2. Share sheet    a 384px PNG into RawBT or the printer's own app. Reaches
 *                      Classic printers, which is most old ones.
 *    3. PDF            the customer's copy, and any ordinary printer.
 *    4. window.print() whatever is left.
 *
 *  The PNG is the right intermediate for the thermal path, not the PDF: at the
 *  printer's native dot count it prints one-to-one, where a PDF has to be re-rasterised
 *  by whatever opens it and the receiving app picks the scale.
 */
export default function ReceiptPrinter({ data }: { data: ReceiptData }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const heightRef = useRef(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const can = useSyncExternalStore(NO_SUBSCRIBE, readCapabilities, () => SERVER_CAPABILITIES);
  const stored = useSyncExternalStore(NO_SUBSCRIBE, readStoredTransport, () => null);
  // What the driver picked this session wins over what was stored last time.
  const [chosen, setChosen] = useState<Transport | null>(null);
  const preferred = chosen ?? stored;

  /** Draws the receipt and sizes the canvas to exactly the rows it used.
   *
   *  Measured on a scratch canvas first, because the height is only known after
   *  drawing and setting a canvas's height clears it. Doing it this way keeps the
   *  visible canvas sized once, with no state and no second render pass -- and it is
   *  what makes the preview the receipt rather than a scaled fragment of an over-tall
   *  bitmap. Both dimensions are set here rather than in JSX so React never resets
   *  them on a re-render, which would silently blank the preview.
   */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;

    const scratch = document.createElement("canvas");
    scratch.width = DOTS_58MM;
    scratch.height = CANVAS_HEIGHT;
    const scratchCtx = scratch.getContext("2d");
    if (!scratchCtx) return 0;
    const used = drawReceipt(scratchCtx, data, DOTS_58MM);

    canvas.width = DOTS_58MM;
    canvas.height = used;
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0;
    drawReceipt(ctx, data, DOTS_58MM);

    heightRef.current = used;
    return used;
  }, [data]);

  useEffect(() => {
    render();
  }, [render]);

  function remember(transport: Transport) {
    setChosen(transport);
    try {
      localStorage.setItem(STORAGE_KEY, transport);
    } catch {
      // Nothing to do: it is a convenience, not state anything depends on.
    }
  }

  function pixels(): { data: Uint8ClampedArray; height: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const used = heightRef.current || render();
    const ctx = canvas.getContext("2d");
    if (!ctx || used === 0) return null;
    return { data: ctx.getImageData(0, 0, DOTS_58MM, used).data, height: used };
  }

  async function printOverBluetooth() {
    setBusy(true);
    setStatus("در حال اتصال به پرینتر…");
    try {
      const image = pixels();
      if (!image) return;

      const nav = navigator as Navigator & {
        bluetooth: {
          requestDevice(o: unknown): Promise<{
            gatt?: {
              connect(): Promise<{
                getPrimaryService(u: string): Promise<{
                  getCharacteristic(u: string): Promise<{
                    writeValueWithoutResponse?(v: BufferSource): Promise<void>;
                    writeValue(v: BufferSource): Promise<void>;
                  }>;
                }>;
              }>;
              disconnect(): void;
            };
          }>;
        };
      };

      const device = await nav.bluetooth.requestDevice({
        filters: PRINTER_SERVICES.map((p) => ({ services: [p.service] })),
        optionalServices: PRINTER_SERVICES.map((p) => p.service),
      });

      const server = await device.gatt!.connect();

      let characteristic: Awaited<
        ReturnType<Awaited<ReturnType<typeof server.getPrimaryService>>["getCharacteristic"]>
      > | null = null;
      for (const pair of PRINTER_SERVICES) {
        try {
          const service = await server.getPrimaryService(pair.service);
          characteristic = await service.getCharacteristic(pair.write);
          break;
        } catch {
          // Not this model. Try the next known pair.
        }
      }
      if (!characteristic) throw new Error("سرویس چاپ روی این دستگاه پیدا نشد");

      const job = receiptBytes(image.data, DOTS_58MM, image.height);
      const pieces = chunk(job, CHUNK_BYTES);

      setStatus(`در حال ارسال… (۰ از ${pieces.length})`);
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        // subarray shares the canvas buffer; some stacks reject a view, so copy.
        const bytes = new Uint8Array(piece);
        if (characteristic.writeValueWithoutResponse) {
          await characteristic.writeValueWithoutResponse(bytes);
        } else {
          await characteristic.writeValue(bytes);
        }
        await sleep(CHUNK_PAUSE_MS);
        if (i % 10 === 0) setStatus(`در حال ارسال… (${i + 1} از ${pieces.length})`);
      }

      device.gatt!.disconnect();
      remember("bluetooth");
      setStatus("چاپ شد");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "چاپ ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function toPngBlob(): Promise<Blob | null> {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (!heightRef.current) render();
    // The canvas is already exactly the receipt, so it shares as-is -- no crop needed,
    // and no risk of handing the printer a foot of blank paper to feed.
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function shareImage() {
    setBusy(true);
    setStatus(null);
    try {
      const blob = await toPngBlob();
      if (!blob) return;
      const file = new File([blob], `receipt-${data.orderNo}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `رسید ${data.orderNo}` });
        remember("share");
      } else {
        download(blob, `receipt-${data.orderNo}.png`);
      }
    } catch (e) {
      // A cancelled share sheet throws AbortError. That is the user saying no, not a
      // failure to report at them.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setStatus(e instanceof Error ? e.message : "اشتراک‌گذاری ناموفق بود");
      }
    } finally {
      setBusy(false);
    }
  }

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPdf() {
    setBusy(true);
    setStatus(null);
    try {
      const image = pixels();
      if (!image) return;
      const packed = packRaster(image.data, DOTS_58MM, image.height);
      const pdf = await receiptPdf(packed, DOTS_58MM, image.height);
      download(new Blob([pdf as BlobPart], { type: "application/pdf" }), `receipt-${data.orderNo}.pdf`);
      remember("pdf");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "ساخت PDF ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  const BUTTON =
    "rounded-[var(--radius-md)] border px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] transition-colors duration-[var(--dur-base)] disabled:opacity-40";
  const primary = "border-[var(--primary)] bg-[var(--primary)] text-primary-ink";
  const secondary = "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)]";

  const options: { key: Transport; label: string; run: () => void; show: boolean }[] = [
    { key: "bluetooth", label: "چاپ بلوتوث", run: printOverBluetooth, show: can.bluetooth },
    { key: "share", label: "ارسال به پرینتر", run: shareImage, show: can.share },
    { key: "pdf", label: "PDF", run: downloadPdf, show: true },
    { key: "print", label: "چاپ", run: () => { remember("print"); window.print(); }, show: true },
  ];
  const visible = options.filter((o) => o.show);

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-white p-[var(--space-2)]">
        {/* The preview is the same canvas that gets printed, so it cannot disagree with
            the output. Scaled down for the screen only. */}
        {/* Width and height are set imperatively in render(); leaving them out of the
            JSX keeps React from resetting -- and so clearing -- the canvas. */}
        <canvas ref={canvasRef} className="mx-auto block h-auto w-[192px] max-w-full" />
      </div>

      <div className="flex flex-wrap gap-[var(--space-2)]">
        {visible.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={option.run}
            disabled={busy}
            className={`${BUTTON} ${
              (preferred ?? visible[0].key) === option.key ? primary : secondary
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {status && (
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">{status}</p>
      )}

      {!can.bluetooth && (
        <p className="m-0 text-[length:var(--text-xs)] leading-5 text-[var(--text-muted)]">
          این مرورگر چاپ مستقیم بلوتوث را پشتیبانی نمی‌کند. با «ارسال به پرینتر» تصویر
          رسید را به برنامه پرینتر بدهید.
        </p>
      )}
    </div>
  );
}
