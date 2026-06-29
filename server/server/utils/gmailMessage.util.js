import path from "path";

const BASE64URL_PAD_LENGTH = 4;

export function decodeBase64UrlToBuffer(data = "") {
  if (!data) return Buffer.alloc(0);

  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((BASE64URL_PAD_LENGTH - (normalized.length % BASE64URL_PAD_LENGTH)) % BASE64URL_PAD_LENGTH),
    "="
  );

  return Buffer.from(padded, "base64");
}

export function decodeBase64Url(data = "") {
  return decodeBase64UrlToBuffer(data).toString("utf-8");
}

export function getHeader(headers = [], name) {
  return headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeRfc5987Value(value) {
  const match = value.match(/^[^']*'[^']*'(.*)$/);
  const encoded = match ? match[1] : value;

  try {
    return decodeURIComponent(encoded);
  } catch (err) {
    return encoded;
  }
}

function getHeaderParameter(headerValue = "", parameterName) {
  const escapedName = parameterName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const extended = headerValue.match(new RegExp(`${escapedName}\\*\\s*=\\s*(?:"([^"]+)"|([^;]+))`, "i"));
  if (extended) return decodeRfc5987Value((extended[1] || extended[2] || "").trim());

  const regular = headerValue.match(new RegExp(`${escapedName}\\s*=\\s*(?:"([^"]+)"|([^;]+))`, "i"));
  return regular ? (regular[1] || regular[2] || "").trim() : "";
}

function filenameFromHeaders(headers = []) {
  const contentDisposition = getHeader(headers, "Content-Disposition");
  const dispositionName = getHeaderParameter(contentDisposition, "filename");
  if (dispositionName) return dispositionName;

  const contentType = getHeader(headers, "Content-Type");
  return getHeaderParameter(contentType, "name");
}

export function safeAttachmentFilename(filename, fallback = "unknown_attachment") {
  const value = String(filename || "").trim();
  if (!value) return fallback;

  return path.basename(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

export function extractAttachments(payload) {
  if (!payload) return [];

  const attachments = [];

  function walk(part) {
    if (!part) return;

    const attachmentId = part.body?.attachmentId || null;
    const inlineData = part.body?.data || "";
    const filename = safeAttachmentFilename(part.filename || filenameFromHeaders(part.headers), "");
    const contentDisposition = getHeader(part.headers, "Content-Disposition").toLowerCase();
    const isInlineWithoutName = contentDisposition.includes("inline") && !filename;
    const hasAttachmentBody = Boolean(attachmentId || inlineData);

    if ((filename || attachmentId) && hasAttachmentBody && !isInlineWithoutName) {
      attachments.push({
        filename: filename || "unknown_attachment",
        mimeType: part.mimeType || "application/octet-stream",
        attachmentId,
        inlineData,
        size: part.body?.size || 0
      });
    }

    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  }

  walk(payload);
  return attachments;
}

export function extractBody(payload) {
  if (!payload) return "";

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (!Array.isArray(payload.parts)) {
    return "";
  }

  const textParts = [];
  const htmlParts = [];

  function walk(part) {
    if (!part) return;

    if (part.body?.data) {
      if (part.mimeType === "text/plain") {
        textParts.push(decodeBase64Url(part.body.data));
      } else if (part.mimeType === "text/html") {
        htmlParts.push(decodeBase64Url(part.body.data));
      }
    }

    if (Array.isArray(part.parts)) {
      part.parts.forEach(walk);
    }
  }

  payload.parts.forEach(walk);
  return textParts.find(Boolean) || htmlParts.find(Boolean) || "";
}
