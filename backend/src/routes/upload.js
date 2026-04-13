const express = require("express");
const { v4: uuidv4 } = require("uuid");
const {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { s3Client, BUCKET } = require("../s3Client");

const router = express.Router();

// ── Validation helpers ────────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/mkv",
  "video/webm",
  "application/zip",
  "application/x-tar",
  "application/octet-stream",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "application/pdf",
  "application/x-gzip",
]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB hard limit

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload/initiate
// Body: { fileName, fileSize, mimeType, totalParts }
// Returns: { uploadId, key }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/initiate", async (req, res, next) => {
  try {
    const { fileName, fileSize, mimeType, totalParts } = req.body;

    if (!fileName || !fileSize || !mimeType || !totalParts) {
      return res
        .status(400)
        .json({
          error: "fileName, fileSize, mimeType, totalParts are required.",
        });
    }

    if (fileSize > MAX_FILE_SIZE_BYTES) {
      return res
        .status(400)
        .json({ error: `File size exceeds maximum limit of 50 GB.` });
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return res
        .status(400)
        .json({ error: `MIME type '${mimeType}' is not allowed.` });
    }

    // Sanitise file name and create a unique S3 key
    const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const key = `uploads/${uuidv4()}/${safeName}`;

    const command = new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mimeType,
      Metadata: {
        originalName: safeName,
        uploadedAt: new Date().toISOString(),
      },
    });

    const { UploadId } = await s3Client.send(command);

    console.log(
      `[UPLOAD] Initiated | key=${key} | uploadId=${UploadId} | parts=${totalParts}`,
    );

    res.json({ uploadId: UploadId, key });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload/presigned-url
// Body: { uploadId, key, partNumber }
// Returns: { presignedUrl }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/presigned-url", async (req, res, next) => {
  try {
    const { uploadId, key, partNumber } = req.body;

    if (!uploadId || !key || !partNumber) {
      return res
        .status(400)
        .json({ error: "uploadId, key, and partNumber are required." });
    }

    if (partNumber < 1 || partNumber > 10000) {
      return res
        .status(400)
        .json({ error: "partNumber must be between 1 and 10000." });
    }

    const command = new UploadPartCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    // Presigned URL expires in 1 hour — plenty for large chunks
    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });

    res.json({ presignedUrl });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload/presigned-urls-batch
// Body: { uploadId, key, partNumbers: [1, 2, 3, ...] }
// Returns: { presignedUrls: { "1": url, "2": url, ... } }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/presigned-urls-batch", async (req, res, next) => {
  try {
    const { uploadId, key, partNumbers } = req.body;

    if (
      !uploadId ||
      !key ||
      !Array.isArray(partNumbers) ||
      partNumbers.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "uploadId, key, and partNumbers[] are required." });
    }

    if (partNumbers.length > 10000) {
      return res
        .status(400)
        .json({
          error: "Cannot request more than 10000 presigned URLs at once.",
        });
    }

    const urlEntries = await Promise.all(
      partNumbers.map(async (partNumber) => {
        const command = new UploadPartCommand({
          Bucket: BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        });
        const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        return [String(partNumber), url];
      }),
    );

    res.json({ presignedUrls: Object.fromEntries(urlEntries) });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload/complete
// Body: { uploadId, key, parts: [{ PartNumber, ETag }] }
// Returns: { location, key }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/complete", async (req, res, next) => {
  try {
    const { uploadId, key, parts } = req.body;

    if (!uploadId || !key || !Array.isArray(parts) || parts.length === 0) {
      return res
        .status(400)
        .json({ error: "uploadId, key, and parts[] are required." });
    }

    // Sort parts by PartNumber — S3 requires ascending order
    const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);

    const command = new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sortedParts },
    });

    const result = await s3Client.send(command);

    console.log(
      `[UPLOAD] Completed | key=${key} | location=${result.Location}`,
    );

    res.json({
      message: "Upload complete",
      location: result.Location,
      key,
      bucket: BUCKET,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/upload/abort
// Body: { uploadId, key }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/abort", async (req, res, next) => {
  try {
    const { uploadId, key } = req.body;

    if (!uploadId || !key) {
      return res.status(400).json({ error: "uploadId and key are required." });
    }

    await s3Client.send(
      new AbortMultipartUploadCommand({
        Bucket: BUCKET,
        Key: key,
        UploadId: uploadId,
      }),
    );

    console.log(`[UPLOAD] Aborted | key=${key}`);
    res.json({ message: "Upload aborted successfully." });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/upload/parts?uploadId=&key=
// Resume support: list already-uploaded parts
// ─────────────────────────────────────────────────────────────────────────────
router.get("/parts", async (req, res, next) => {
  try {
    const { uploadId, key } = req.query;

    if (!uploadId || !key) {
      return res.status(400).json({ error: "uploadId and key are required." });
    }

    const command = new ListPartsCommand({
      Bucket: BUCKET,
      Key: key,
      UploadId: uploadId,
    });
    const result = await s3Client.send(command);

    res.json({
      parts: result.Parts || [],
      nextPartNumberMarker: result.NextPartNumberMarker,
      isTruncated: result.IsTruncated,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
