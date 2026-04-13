import type {
  UploadedPart,
  InitiateResponse,
  PresignedUrlsBatchResponse,
  CompleteResponse,
} from "@/types/upload";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/upload";

// ── Config ────────────────────────────────────────────────────────────────────
export const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per chunk (S3 min is 5 MB)
export const MAX_CONCURRENCY = 4;           // parallel chunk uploads
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1500;

// ── API Calls ─────────────────────────────────────────────────────────────────
export async function initiateUpload(
  fileName: string,
  fileSize: number,
  mimeType: string,
  totalParts: number
): Promise<InitiateResponse> {
  const res = await fetch(`${API}/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, fileSize, mimeType, totalParts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `Failed to initiate upload (${res.status})`);
  }
  return res.json();
}

export async function getPresignedUrlsBatch(
  uploadId: string,
  key: string,
  partNumbers: number[]
): Promise<Record<string, string>> {
  const res = await fetch(`${API}/presigned-urls-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, key, partNumbers }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `Failed to get presigned URLs (${res.status})`);
  }
  const data: PresignedUrlsBatchResponse = await res.json();
  return data.presignedUrls;
}

export async function completeUpload(
  uploadId: string,
  key: string,
  parts: UploadedPart[]
): Promise<CompleteResponse> {
  const res = await fetch(`${API}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, key, parts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `Failed to complete upload (${res.status})`);
  }
  return res.json();
}

export async function abortUpload(uploadId: string, key: string): Promise<void> {
  await fetch(`${API}/abort`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, key }),
  });
}

// ── Chunk Upload with Retry ───────────────────────────────────────────────────
export async function uploadChunk(
  presignedUrl: string,
  chunk: Blob,
  onProgress: (bytes: number) => void,
  signal: AbortSignal
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const etag = await uploadChunkOnce(presignedUrl, chunk, onProgress, signal);
      return etag;
    } catch (err: unknown) {
      if (signal.aborted) throw err;
      if (attempt === MAX_RETRIES) throw err;

      console.warn(`Chunk upload attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`);
      await delay(RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error("Upload failed after max retries");
}

function uploadChunkOnce(
  url: string,
  chunk: Blob,
  onProgress: (bytes: number) => void,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let lastLoaded = 0;

    xhr.upload.onprogress = (e) => {
      const delta = e.loaded - lastLoaded;
      lastLoaded = e.loaded;
      onProgress(delta);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag") || xhr.getResponseHeader("etag") || "";
        resolve(etag.replace(/"/g, ""));
      } else {
        reject(new Error(`Chunk upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during chunk upload"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));

    signal.addEventListener("abort", () => xhr.abort());

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.send(chunk);
  });
}

// ── Concurrency Pool ──────────────────────────────────────────────────────────
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 2 : 0)} ${units[i]}`;
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "--";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function calcTotalParts(fileSize: number): number {
  return Math.ceil(fileSize / CHUNK_SIZE);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
