require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const uploadRoutes = require("./routes/upload");

const app = express();
const PORT = process.env.PORT || 4000;

// ── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST", "DELETE"],
  })
);

// Rate limiting – generous for large uploads (presigned URL requests)
app.use(
  "/api/upload",
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 500,
    message: { error: "Too many requests, please try again later." },
  })
);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/upload", uploadRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err.message);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`✅  Backend running on http://localhost:${PORT}`);
});
