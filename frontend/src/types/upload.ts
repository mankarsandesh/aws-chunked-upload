export type UploadStatus =
  | "idle"
  | "preparing"
  | "uploading"
  | "completing"
  | "done"
  | "error"
  | "aborted"
  | "paused";

export interface UploadedPart {
  PartNumber: number;
  ETag: string;
}

export interface ChunkState {
  partNumber: number;
  status: "pending" | "uploading" | "done" | "error";
  retries: number;
}

export interface UploadState {
  file: File | null;
  uploadId: string | null;
  key: string | null;
  status: UploadStatus;
  progress: number; // 0–100
  speed: number; // bytes/sec
  uploadedBytes: number;
  totalBytes: number;
  eta: number | null; // seconds
  error: string | null;
  location: string | null;
  chunks: ChunkState[];
  uploadedParts: UploadedPart[];
}

export interface InitiateResponse {
  uploadId: string;
  key: string;
}

export interface PresignedUrlsBatchResponse {
  presignedUrls: Record<string, string>;
}

export interface CompleteResponse {
  message: string;
  location: string;
  key: string;
  bucket: string;
}
