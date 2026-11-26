import { toUSVString } from "node:util";

const mimeTypesByExtension: Partial<Record<string, readonly string[]>> = {
  ".ai": ["application/postscript", "application/pdf"],
  ".bmp": ["image/bmp"],
  ".csv": ["text/csv", "application/csv", "application/vnd.ms-excel"],
  ".doc": ["application/msword"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ".gif": ["image/gif"],
  ".jpeg": ["image/jpeg"],
  ".jpg": ["image/jpeg"],
  ".pdf": ["application/pdf"],
  ".png": ["image/png"],
  ".ppt": ["application/vnd.ms-powerpoint"],
  ".pptx": [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  ".tif": ["image/tiff"],
  ".tiff": ["image/tiff"],
  ".txt": ["text/plain"],
  ".webp": ["image/webp"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  ".zip": ["application/zip", "application/x-zip-compressed"],
};

export type AttachmentUploadInput = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  expectedContentSha256: string;
  uploadClientId: string;
};

export function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

export function normalizeAttachmentFileName(value: string) {
  const baseName = value.split(/[\\/]/u).at(-1) ?? "";
  const safeName = [...toUSVString(baseName)]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
  return safeName;
}

export function listAttachmentMimeTypes(fileName: string) {
  return mimeTypesByExtension[extensionOf(fileName)];
}
