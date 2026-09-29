import type { PaintDocument } from "../model/document";
import { exportSvg, type ExportOptions } from "./svg";

/** Rasterises the export SVG in the browser. `scale` 2 gives a 2× sharper PNG of the same image. */
export async function exportPng(doc: PaintDocument, opts: ExportOptions, scale = 1): Promise<Blob> {
  const svg = exportSvg(doc, opts, scale);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(doc.config.width * scale);
    canvas.height = Math.round(doc.config.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available in this browser.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed."))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
