import type { Page } from "playwright";

export type SpeedIndexFrame = { data: string; timestamp: number };

/** Estimates visual completion from bounded Chromium screencast frames. */
export async function estimateSpeedIndexMs(page: Page, frames: readonly SpeedIndexFrame[]): Promise<number | null> {
  if (frames.length < 2) return null;
  const decoderPage = await page.context().newPage();
  try {
    return await decoderPage.evaluate(async (capturedFrames) => {
      const decoded: Array<{ timestamp: number; pixels: Uint8ClampedArray }> = [];
      let width = 0;
      let height = 0;
      for (const frame of capturedFrames) {
        if (typeof frame.data !== "string" || !Number.isFinite(frame.timestamp)) continue;
        const image = new Image();
        image.src = `data:image/jpeg;base64,${frame.data}`;
        try {
          await image.decode();
        } catch {
          continue;
        }
        width = image.naturalWidth;
        height = image.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(image, 0, 0);
        decoded.push({ timestamp: frame.timestamp, pixels: context.getImageData(0, 0, width, height).data });
      }
      if (decoded.length < 2 || width === 0 || height === 0) return null;

      const finalPixels = decoded[decoded.length - 1]!.pixels;
      const incomplete = decoded.map(({ pixels }) => {
        let changed = 0;
        for (let index = 0; index < finalPixels.length; index += 4) {
          if (Math.abs(pixels[index]! - finalPixels[index]!) > 20 ||
              Math.abs(pixels[index + 1]! - finalPixels[index + 1]!) > 20 ||
              Math.abs(pixels[index + 2]! - finalPixels[index + 2]!) > 20) changed += 1;
        }
        return changed / (width * height);
      });
      const firstTimestamp = decoded[0]!.timestamp;
      let speedIndex = 0;
      for (let index = 0; index < decoded.length - 1; index += 1) {
        const durationMs = (decoded[index + 1]!.timestamp - decoded[index]!.timestamp) * 1_000;
        if (durationMs > 0 && durationMs <= 2_000) speedIndex += incomplete[index]! * durationMs;
      }
      return Number.isFinite(speedIndex) && decoded.at(-1)!.timestamp > firstTimestamp
        ? Math.round(speedIndex)
        : null;
    }, frames);
  } finally {
    await decoderPage.close().catch(() => undefined);
  }
}
