/**
 * File Export — save data to the local filesystem.
 *
 * Electrobun has no native save dialog, so we write directly
 * to the user's Downloads folder and return the path.
 *
 * Supports CSV, JSON, and PDF export from webview data.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

export type ExportFileType = "csv" | "json" | "pdf";

interface ExportOptions {
  filename: string;
  data: string;
  fileType: ExportFileType;
}

interface ExportResult {
  success: boolean;
  path: string | null;
}

function getDownloadsPath(): string {
  return join(homedir(), "Downloads");
}

function ensureUniqueFilename(dir: string, filename: string): string {
  let filePath = join(dir, filename);
  if (!existsSync(filePath)) return filePath;

  const dotIdx = filename.lastIndexOf(".");
  const name = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext = dotIdx > 0 ? filename.slice(dotIdx) : "";

  let counter = 1;
  while (existsSync(filePath)) {
    filePath = join(dir, `${name} (${counter})${ext}`);
    counter++;
  }
  return filePath;
}

export async function exportFile(options: ExportOptions): Promise<ExportResult> {
  const { filename, data, fileType } = options;

  try {
    const downloadsDir = getDownloadsPath();

    // Ensure Downloads directory exists
    if (!existsSync(downloadsDir)) {
      mkdirSync(downloadsDir, { recursive: true });
    }

    const filePath = ensureUniqueFilename(downloadsDir, filename);

    if (fileType === "pdf") {
      // PDF data comes as base64-encoded string from the webview
      const buffer = Buffer.from(data, "base64");
      await Bun.write(filePath, buffer);
    } else {
      await Bun.write(filePath, data);
    }

    console.log(`[Export] Saved ${fileType} to ${filePath}`);
    return { success: true, path: filePath };
  } catch (err) {
    console.error("[Export] Failed:", err);
    return { success: false, path: null };
  }
}
