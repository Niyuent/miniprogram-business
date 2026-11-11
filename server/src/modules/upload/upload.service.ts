import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';

/** MVP 阶段允许的上传类型（营业执照 / 门店图片） */
const ALLOWED_MIME = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
]);

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * 按**文件头魔数**判断真实类型，返回 MIME；识别不出返回 null。
 *
 * 客户端传的 Content-Type / 扩展名完全不可信 —— 把 .exe 改名成 .png 很容易。
 * 只认这几字节可以保证落盘的东西真的是它声称的样子。
 */
function sniffMime(buf: Buffer): string | null {
  const startsWith = (...bytes: number[]) =>
    buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png'; // ‰PNG
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg'; // JFIF / Exif
  if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf'; // %PDF
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * 本地磁盘存储（MVP）
 *
 * 目录：`UPLOAD_DIR`（默认 `./uploads`），按 `年/月` 分子目录。
 * 访问路径 `/uploads/<年>/<月>/<uuid>.<ext>`，由 Nginx 反代到本服务，
 * 本服务在 `main.ts` 里用 `useStaticAssets` 以 `/uploads/` 前缀对外提供。
 *
 * 后续换 OSS 只需替换本 Service 的实现，Controller 与调用方不动。
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger('Upload');
  private readonly root = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

  constructor() {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  save(file: UploadedFileLike): { url: string; filename: string; size: number; mimetype: string } {
    if (!file) {
      throw BizException.badRequest(ReasonCode.INVALID_FILE_TYPE, '缺少上传文件');
    }

    const declaredExt = ALLOWED_MIME.get(file.mimetype);
    if (!declaredExt) {
      throw BizException.badRequest(
        ReasonCode.INVALID_FILE_TYPE,
        `不支持的文件类型：${file.mimetype}（仅允许 jpg / png / webp / pdf）`,
      );
    }

    // 魔数校验：文件头必须和声明的类型一致，不一致（如 .exe 改名 .png）一律拒绝
    const realMime = sniffMime(file.buffer);
    if (!realMime) {
      throw BizException.badRequest(
        ReasonCode.INVALID_FILE_TYPE,
        '无法识别的文件内容：文件头不符合任何受支持的类型',
      );
    }
    if (realMime !== file.mimetype) {
      throw BizException.badRequest(
        ReasonCode.INVALID_FILE_TYPE,
        `文件内容与声明的类型不符：实为 ${realMime}，却声明为 ${file.mimetype}`,
      );
    }

    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const dir = join(this.root, year, month);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 扩展名一律用**魔数判定出来**的类型，不采信客户端给的文件名后缀
    const ext = ALLOWED_MIME.get(realMime)!;
    const filename = `${randomUUID()}${ext}`;
    writeFileSync(join(dir, filename), file.buffer);

    this.logger.log(`保存上传文件 ${year}/${month}/${filename}（${file.size} bytes）`);

    return {
      url: `/uploads/${year}/${month}/${filename}`,
      filename: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    };
  }
}
