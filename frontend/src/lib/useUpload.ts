"use client";

import { useCallback, useRef, useState } from "react";
import type { UploadState, UploadedPart } from "@/types/upload";
import {
  initiateUpload,
  getPresignedUrlsBatch,
  completeUpload,
  abortUpload,
  uploadChunk,
  runWithConcurrency,
  CHUNK_SIZE,
  MAX_CONCURRENCY,
  calcTotalParts,
} from "@/lib/uploadEngine";

const initialState: UploadState = {
  file: null,
  uploadId: null,
  key: null,
  status: "idle",
  progress: 0,
  speed: 0,
  uploadedBytes: 0,
  totalBytes: 0,
  eta: null,
  error: null,
  location: null,
  chunks: [],
  uploadedParts: [],
};

export function useUpload() {
  const [state, setState] = useState<UploadState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const speedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bytesWindowRef = useRef<{ t: number; b: number }[]>([]);

  const updateState = useCallback((patch: Partial<UploadState>) => {
    setState((s) => ({ ...s, ...patch }));
  }, []);

  // ── Speed tracking ──────────────────────────────────────────────────────────
  const trackBytes = useCallback((delta: number) => {
    bytesWindowRef.current.push({ t: Date.now(), b: delta });
  }, []);

  const startSpeedMeter = useCallback((totalBytes: number) => {
    bytesWindowRef.current = [];

    speedTimerRef.current = setInterval(() => {
      const now = Date.now();
      const window = bytesWindowRef.current.filter((e) => now - e.t < 3000);
      bytesWindowRef.current = window;
      const totalDelta = window.reduce((s, e) => s + e.b, 0);
      const elapsed = window.length > 0 ? (now - window[0].t) / 1000 : 1;
      const speed = elapsed > 0 ? totalDelta / elapsed : 0;

      setState((s) => {
        const remaining = totalBytes - s.uploadedBytes;
        const eta = speed > 0 ? remaining / speed : null;
        return { ...s, speed, eta };
      });
    }, 800);
  }, []);

  const stopSpeedMeter = useCallback(() => {
    if (speedTimerRef.current) clearInterval(speedTimerRef.current);
    speedTimerRef.current = null;
  }, []);

  // ── Main upload function ────────────────────────────────────────────────────
  const startUpload = useCallback(
    async (file: File) => {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const { signal } = abortController;
      const totalParts = calcTotalParts(file.size);

      updateState({
        file,
        status: "preparing",
        totalBytes: file.size,
        uploadedBytes: 0,
        progress: 0,
        error: null,
        location: null,
        chunks: Array.from({ length: totalParts }, (_, i) => ({
          partNumber: i + 1,
          status: "pending",
          retries: 0,
        })),
        uploadedParts: [],
      });

      try {
        // 1. Initiate multipart upload
        const { uploadId, key } = await initiateUpload(
          file.name,
          file.size,
          file.type || "application/octet-stream",
          totalParts
        );

        updateState({ uploadId, key, status: "uploading" });
        startSpeedMeter(file.size);

        const partNumbers = Array.from({ length: totalParts }, (_, i) => i + 1);

        // 2. Get all presigned URLs in one shot
        const presignedUrls = await getPresignedUrlsBatch(uploadId, key, partNumbers);

        // 3. Upload all chunks concurrently
        let uploadedBytes = 0;
        const uploadedParts: UploadedPart[] = [];

        const tasks = partNumbers.map((partNumber) => async () => {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");

          const start = (partNumber - 1) * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          const url = presignedUrls[String(partNumber)];

          setState((s) => ({
            ...s,
            chunks: s.chunks.map((c) =>
              c.partNumber === partNumber ? { ...c, status: "uploading" } : c
            ),
          }));

          const etag = await uploadChunk(
            url,
            chunk,
            (delta) => {
              uploadedBytes += delta;
              trackBytes(delta);
              setState((s) => ({
                ...s,
                uploadedBytes,
                progress: Math.round((uploadedBytes / file.size) * 100),
              }));
            },
            signal
          );

          uploadedParts.push({ PartNumber: partNumber, ETag: etag });

          setState((s) => ({
            ...s,
            chunks: s.chunks.map((c) =>
              c.partNumber === partNumber ? { ...c, status: "done" } : c
            ),
            uploadedParts: [...s.uploadedParts, { PartNumber: partNumber, ETag: etag }],
          }));
        });

        await runWithConcurrency(tasks, MAX_CONCURRENCY);

        if (signal.aborted) return;

        // 4. Complete the multipart upload
        stopSpeedMeter();
        updateState({ status: "completing", progress: 100 });

        const result = await completeUpload(uploadId, key, uploadedParts);

        updateState({
          status: "done",
          location: result.location,
          speed: 0,
          eta: null,
        });
      } catch (err: unknown) {
        stopSpeedMeter();
        const isAbort =
          err instanceof DOMException && err.name === "AbortError";

        if (!isAbort && state.uploadId && state.key) {
          // Best-effort abort cleanup on unexpected errors
          abortUpload(state.uploadId, state.key).catch(console.error);
        }

        updateState({
          status: isAbort ? "aborted" : "error",
          error: isAbort ? null : (err instanceof Error ? err.message : "Upload failed"),
          speed: 0,
          eta: null,
        });
      }
    },
    [startSpeedMeter, stopSpeedMeter, trackBytes, updateState, state.uploadId, state.key]
  );

  // ── Abort ───────────────────────────────────────────────────────────────────
  const abort = useCallback(async () => {
    abortControllerRef.current?.abort();
    stopSpeedMeter();

    if (state.uploadId && state.key) {
      await abortUpload(state.uploadId, state.key).catch(console.error);
    }
    updateState({ status: "aborted", speed: 0, eta: null });
  }, [state.uploadId, state.key, stopSpeedMeter, updateState]);

  // ── Reset ───────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    stopSpeedMeter();
    setState(initialState);
    bytesWindowRef.current = [];
  }, [stopSpeedMeter]);

  return { state, startUpload, abort, reset };
}
