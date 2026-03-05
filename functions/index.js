const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

if (!getApps().length) {
  initializeApp();
}

const ERP_BASE_URL = process.env.ERP_BASE_URL || "http://10.0.0.19:8000";
const ALLOWED_PREFIXES = ["/fichajes/", "/docs/"];
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const DEFAULT_ALLOWED_ORIGINS = [
  "https://app-gestion-trabajos.web.app",
  "https://app-gestion-trabajos.firebaseapp.com"
];
const CONFIGURED_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...CONFIGURED_ALLOWED_ORIGINS
]);
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin) || LOCALHOST_ORIGIN_RE.test(origin);
};

const setCors = (req, res) => {
  const origin = req.get("origin");
  if (origin && !isOriginAllowed(origin)) {
    return false;
  }

  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }

  res.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return true;
};

const extractBearerToken = (req) => {
  const authHeader = req.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token || null;
};

const verifyRequestAuth = async (req) => {
  const token = extractBearerToken(req);
  if (!token) return null;

  try {
    return await getAuth().verifyIdToken(token, true);
  } catch (error) {
    logger.warn("Invalid Firebase token on ERP proxy", {
      error: String(error)
    });
    return null;
  }
};

const canonicalizeProxyPath = (pathValue) => {
  const decodedPath = decodeURIComponent(pathValue || "/");
  const normalizedInput = decodedPath.startsWith("/") ? decodedPath : `/${decodedPath}`;
  return new URL(normalizedInput, "http://localhost").pathname;
};

const isPathAllowed = (pathname) => {
  return ALLOWED_PREFIXES.some((prefix) => {
    const cleanPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return pathname === cleanPrefix || pathname.startsWith(prefix);
  });
};

exports.erpProxy = onRequest(
  {
    region: "europe-west1",
    timeoutSeconds: 60,
    memory: "256MiB"
  },
  async (req, res) => {
    const corsAllowed = setCors(req, res);
    if (!corsAllowed) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (!ALLOWED_METHODS.has(req.method)) {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const decodedToken = await verifyRequestAuth(req);
    if (!decodedToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const incomingPath = req.path || "/";
    const rawPath = incomingPath.startsWith("/api/erp/")
      ? incomingPath.slice("/api/erp".length)
      : incomingPath;

    let normalizedPath;
    try {
      normalizedPath = canonicalizeProxyPath(rawPath);
    } catch {
      res.status(400).json({ error: "Invalid path" });
      return;
    }

    if (!isPathAllowed(normalizedPath)) {
      res.status(403).json({ error: "Path not allowed by ERP proxy" });
      return;
    }

    try {
      const targetUrl = new URL(
        normalizedPath,
        ERP_BASE_URL.endsWith("/") ? ERP_BASE_URL : `${ERP_BASE_URL}/`
      );
      const searchParams = new URLSearchParams();

      for (const [key, value] of Object.entries(req.query || {})) {
        if (Array.isArray(value)) {
          value.forEach((entry) => searchParams.append(key, String(entry)));
        } else if (value != null) {
          searchParams.set(key, String(value));
        }
      }

      const queryString = searchParams.toString();
      if (queryString) {
        targetUrl.search = queryString;
      }

      const forwardHeaders = {
        Accept: req.get("accept") || "application/json"
      };

      const contentType = req.get("content-type");
      if (contentType) {
        forwardHeaders["Content-Type"] = contentType;
      }

      const init = {
        method: req.method,
        headers: forwardHeaders,
        redirect: "follow"
      };

      if (!["GET", "HEAD"].includes(req.method)) {
        init.body = req.rawBody;
      }

      const upstream = await fetch(targetUrl.toString(), init);
      const buffer = Buffer.from(await upstream.arrayBuffer());

      res.status(upstream.status);
      const upstreamType = upstream.headers.get("content-type");
      if (upstreamType) {
        res.set("Content-Type", upstreamType);
      }
      res.send(buffer);
    } catch (error) {
      logger.error("ERP proxy failed", {
        uid: decodedToken.uid,
        path: normalizedPath,
        error: String(error)
      });
      res.status(502).json({ error: "ERP proxy request failed" });
    }
  }
);
