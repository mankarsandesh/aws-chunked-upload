"use client";

import { formatBytes, formatTime } from "@/lib/uploadEngine";
import { useUpload } from "@/lib/useUpload";
import type { UploadStatus } from "@/types/upload";
import { useCallback, useRef, useState } from "react";

const ACCEPTED_TYPES = [
  "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm", "video/mkv",
  "application/zip", "application/x-tar", "application/octet-stream",
  "image/jpeg", "image/png", "image/tiff", "application/pdf","application/x-gzip",
];

const STATUS_LABELS: Record<UploadStatus, string> = {
  idle: "Select a file to begin",
  preparing: "Preparing upload…",
  uploading: "Uploading…",
  completing: "Finalising on S3…",
  done: "Upload complete!",
  error: "Upload failed",
  aborted: "Upload cancelled",
  paused: "Paused",
};

export function FileUploader() {
  const { state, startUpload, abort, reset } = useUpload();
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      console.log("Selected file:", file);
      if (!ACCEPTED_TYPES.includes(file.type) && file.type !== "") {
        alert(`File type "${file.type}" is not supported.`);
        return;
      }
      startUpload(file);
    },
    [startUpload]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const isActive = ["preparing", "uploading", "completing"].includes(state.status);
  const isDone = state.status === "done";
  const isError = state.status === "error";
  const completedParts = state.chunks.filter((c) => c.status === "done").length;
  const totalParts = state.chunks.length;

  return (
    <div className="uploader">
      {/* Drop Zone */}
      {state.status === "idle" || state.status === "aborted" || isError ? (
        <div
          className={`drop-zone ${dragActive ? "drop-zone--active" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          aria-label="File drop zone"
        >
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            onChange={onFileChange}
            accept={ACCEPTED_TYPES.join(",")}
          />
          <div className="drop-icon">
            <CloudUploadIcon />
          </div>
          <p className="drop-title">
            {dragActive ? "Drop it here" : "Drop your file here"}
          </p>
          <p className="drop-sub">or click to browse — videos, zips, PDFs up to 50 GB</p>
          {isError && (
            <p className="error-badge">⚠ {state.error}</p>
          )}
        </div>
      ) : null}

      {/* Upload Progress Card */}
      {state.file && !["idle"].includes(state.status) && (
        <div className="progress-card">
          {/* File Info */}
          <div className="file-info">
            <FileIcon mimeType={state.file.type} />
            <div className="file-meta">
              <span className="file-name">{state.file.name}</span>
              <span className="file-size">{formatBytes(state.file.size)}</span>
            </div>
            {!isActive && (
              <button className="btn-ghost" onClick={reset} aria-label="Remove">
                <XIcon />
              </button>
            )}
          </div>

          {/* Status */}
          <div className="status-row">
            <span className={`status-label status-label--${state.status}`}>
              {STATUS_LABELS[state.status]}
            </span>
            {isActive && (
              <span className="progress-pct">{state.progress}%</span>
            )}
          </div>

          {/* Progress Bar */}
          {(isActive || isDone || state.status === "completing") && (
            <div className="progress-track" role="progressbar" aria-valuenow={state.progress}>
              <div
                className={`progress-fill ${isDone ? "progress-fill--done" : ""}`}
                style={{ width: `${state.progress}%` }}
              />
            </div>
          )}

          {/* Stats Row */}
          {isActive && (
            <div className="stats-row">
              <Stat label="Uploaded" value={formatBytes(state.uploadedBytes)} />
              <Stat label="Speed" value={`${formatBytes(state.speed)}/s`} />
              <Stat label="ETA" value={formatTime(state.eta ?? Infinity)} />
              {totalParts > 1 && (
                <Stat label="Parts" value={`${completedParts}/${totalParts}`} />
              )}
            </div>
          )}

          {/* Chunk Grid */}
          {totalParts > 1 && isActive && (
            <div className="chunk-grid" aria-label="Chunk progress">
              {state.chunks.map((c) => (
                <div
                  key={c.partNumber}
                  className={`chunk chunk--${c.status}`}
                  title={`Part ${c.partNumber}: ${c.status}`}
                />
              ))}
            </div>
          )}

          {/* Done state */}
          {isDone && state.location && (
            <div className="done-row">
              <CheckCircleIcon />
              <a
                href={state.location}
                target="_blank"
                rel="noopener noreferrer"
                className="done-link"
              >
                View on S3
              </a>
            </div>
          )}

          {/* Actions */}
          <div className="actions-row">
            {isActive && (
              <button className="btn btn--danger" onClick={abort}>
                Cancel Upload
              </button>
            )}
            {!isActive && state.status !== "idle" && (
              <button className="btn btn--primary" onClick={reset}>
                Upload Another
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function FileIcon({ mimeType }: { mimeType: string }) {
  const isVideo = mimeType.startsWith("video");
  const isImage = mimeType.startsWith("image");
  return (
    <div className="file-icon">
      {isVideo ? "🎬" : isImage ? "🖼" : "📦"}
    </div>
  );
}

function CloudUploadIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6h.1a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
