import { FileUploader } from "@/components/FileUploader";

export default function Home() {
  return (
    <main className="page">
      <div className="hero">
        <h1 className="hero-title">
          <span className="hero-accent">Large File</span> Uploader
        </h1>
        <p className="hero-sub">
          Chunked multipart upload to S3 — handles files up to 50 GB with
          parallel chunks, automatic retry, and real-time progress.
        </p>
      </div>
      <FileUploader />
      <footer className="page-footer">
        <p>Files are uploaded directly to S3 via presigned URLs — your server never touches the data.</p>
      </footer>
    </main>
  );
}
