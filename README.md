# S3 Chunked Uploader

Upload files up to 50 GB to AWS S3 using multipart uploads.
Chunks go **directly from the browser to S3** via presigned URLs — your Express server never handles file data.

```
Browser  ──(1) initiate──►  Express  ──►  S3 CreateMultipartUpload
Browser  ◄──(2) uploadId + presigned URLs ──  Express
Browser  ──(3) PUT chunks ──────────────────────────────►  S3 (direct)
Browser  ──(4) complete ──►  Express  ──►  S3 CompleteMultipartUpload
```

---

## Project Structure

```
s3-chunked-upload/
├── backend/
│   ├── src/
│   │   ├── index.js           # Express entry point
│   │   ├── s3Client.js        # AWS S3 client singleton
│   │   └── routes/upload.js   # Upload API routes
│   ├── .env.example
│   └── package.json
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   ├── page.tsx
    │   │   └── globals.css
    │   ├── components/
    │   │   └── FileUploader.tsx
    │   ├── lib/
    │   │   ├── uploadEngine.ts  # Core upload logic
    │   │   └── useUpload.ts     # React hook
    │   └── types/upload.ts
    ├── .env.example
    └── package.json
```

---

## AWS Setup

### 1. Create an S3 Bucket

- Disable "Block all public access" if you need public read (optional)
- Enable versioning (optional but recommended)

### 2. Configure CORS on the S3 Bucket

Go to your bucket → Permissions → CORS and paste:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedOrigins": ["http://localhost:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

> ⚠ **Critical**: `ExposeHeaders: ["ETag"]` is required — the browser needs to read the `ETag` header from each part response to complete the multipart upload.

### 3. Create an IAM User

Attach an inline policy with minimum required permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts",
        "s3:CreateMultipartUpload",
        "s3:CompleteMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

---

## Local Development

### Backend

```bash
cd backend
cp .env.example .env
# Fill in your AWS credentials and bucket name
npm install
npm run dev
# → http://localhost:4000
```

### Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
# → http://localhost:3000
```

---

## API Reference

| Method | Endpoint                          | Description                              |
|--------|-----------------------------------|------------------------------------------|
| POST   | `/api/upload/initiate`            | Start a multipart upload, get `uploadId` |
| POST   | `/api/upload/presigned-urls-batch`| Get presigned PUT URLs for all parts     |
| POST   | `/api/upload/complete`            | Finalise the upload                      |
| POST   | `/api/upload/abort`               | Abort and clean up                       |
| GET    | `/api/upload/parts`               | List already-uploaded parts (resume)     |

---

## Configuration

| Variable         | Default    | Description                     |
|------------------|------------|---------------------------------|
| `CHUNK_SIZE`     | 10 MB      | Size of each chunk              |
| `MAX_CONCURRENCY`| 4          | Parallel chunk uploads          |
| `MAX_RETRIES`    | 3          | Retry attempts per failed chunk |

---

## Production Checklist

- [ ] Replace IAM user credentials with an IAM Role (EC2/ECS)
- [ ] Add authentication to backend routes (JWT / session)
- [ ] Restrict `AllowedOrigins` in S3 CORS to your production domain
- [ ] Set up an S3 lifecycle rule to abort incomplete multipart uploads after N days
- [ ] Use HTTPS in production (put backend behind Nginx with SSL)
- [ ] Consider storing upload state in Redis for resume-across-sessions support
