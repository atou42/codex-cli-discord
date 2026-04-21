import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_NATIVE_IMAGE_ATTACHMENTS = 8;
const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function sanitizeFilename(value, fallback = 'image') {
  const cleaned = normalizeText(value)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || fallback;
}

function pickImageExtension(attachment) {
  const name = normalizeText(attachment?.name || '');
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return ext;

  const contentType = normalizeText(attachment?.contentType || '').toLowerCase();
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/bmp') return '.bmp';
  if (contentType === 'image/avif') return '.avif';
  if (contentType === 'image/tiff') return '.tiff';
  return '.img';
}

export function isImageAttachment(attachment) {
  const contentType = normalizeText(attachment?.contentType || '').toLowerCase();
  if (contentType.startsWith('image/')) return true;
  const ext = path.extname(normalizeText(attachment?.name || '')).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export async function stageNativeImageAttachments(message, {
  fetchImpl = globalThis.fetch,
  mkdtempFn = mkdtemp,
  writeFileFn = writeFile,
  rmFn = rm,
  tmpdir = os.tmpdir(),
  safeError = (err) => err?.message || String(err),
} = {}) {
  const attachments = Array.from(message?.attachments?.values?.() || [])
    .filter(isImageAttachment)
    .slice(0, MAX_NATIVE_IMAGE_ATTACHMENTS);

  if (!attachments.length) {
    return {
      inputImages: [],
      notes: [],
      cleanup: async () => {},
    };
  }

  if (typeof fetchImpl !== 'function') {
    return {
      inputImages: [],
      notes: ['图片原生输入不可用：当前运行时没有 fetch，已回退到附件 URL。'],
      cleanup: async () => {},
    };
  }

  const baseDir = path.join(tmpdir, 'aid-codex-images-');
  const dir = await mkdtempFn(baseDir);
  const inputImages = [];
  const notes = [];

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    const url = normalizeText(attachment?.url || attachment?.proxyURL || '');
    if (!url) {
      notes.push(`图片附件 ${attachment?.name || index + 1} 缺少 URL，已回退到附件文本。`);
      continue;
    }

    try {
      const response = await fetchImpl(url);
      if (!response?.ok) {
        throw new Error(`HTTP ${response?.status || 'error'}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const baseName = sanitizeFilename(path.basename(normalizeText(attachment?.name || `image-${index + 1}`)), `image-${index + 1}`);
      const ext = pickImageExtension(attachment);
      const fileName = baseName.toLowerCase().endsWith(ext) ? baseName : `${baseName}${ext}`;
      const filePath = path.join(dir, `${String(index + 1).padStart(2, '0')}-${fileName}`);
      await writeFileFn(filePath, bytes);
      inputImages.push(filePath);
    } catch (err) {
      notes.push(`图片附件 ${attachment?.name || index + 1} 下载失败：${safeError(err)}；已回退到附件 URL。`);
    }
  }

  const cleanup = async () => {
    await rmFn(dir, { recursive: true, force: true }).catch(() => {});
  };

  return {
    inputImages,
    notes,
    cleanup,
  };
}

export function buildNativeImagePromptNote(inputImages = []) {
  if (!Array.isArray(inputImages) || inputImages.length === 0) return '';
  return '说明：图片附件已作为原生图片输入附带，不要再次下载附件 URL；附件区块仅作文件名和元数据参考。';
}
