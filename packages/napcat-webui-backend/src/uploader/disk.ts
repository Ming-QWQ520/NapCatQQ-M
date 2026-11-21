import multer from 'multer';
import { Request, Response, RequestHandler } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
const isWindows = process.platform === 'win32';

// 修改：使用 Buffer 转码文件名，解决文件上传时乱码问题
const decodeFileName = (fileName: string): string => {
  try {
    return Buffer.from(fileName, 'binary').toString('utf8');
  } catch {
    return fileName;
  }
};

// 校验上传目标目录：必须是非空的绝对路径且不含目录穿越，
// 否则 ?path= 为空时会相对进程工作目录写入，..\..\ 可写出预期目录
const sanitizeUploadPath = (rawPath: string): string | null => {
  if (!rawPath) return null;
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // 解码失败时使用原始值
  }
  const unified = decoded.replace(/\\/g, '/');
  if (unified.includes('/../') || unified.endsWith('/..') || unified === '..') {
    return null;
  }
  const isAbsolute = isWindows ? /^[A-Za-z]:[\\/]/.test(decoded) : decoded.startsWith('/');
  if (!isAbsolute) return null;
  return path.resolve(decoded);
};

export const createDiskStorage = (uploadPath: string) => {
  const resolvedUpload = uploadPath ? path.resolve(uploadPath) : '';
  return multer.diskStorage({
    destination: (
      _: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, destination: string) => void
    ) => {
      try {
        const decodedName = decodeFileName(file.originalname);

        if (!uploadPath || !resolvedUpload) {
          return cb(new Error('上传路径不能为空'), '');
        }

        if (isWindows && uploadPath === '\\') {
          return cb(new Error('根目录不允许上传文件'), '');
        }

        // 处理文件夹上传的情况
        if (decodedName.includes('/') || decodedName.includes('\\')) {
          const fullPath = path.resolve(uploadPath, path.dirname(decodedName));
          // 目录穿越防护：最终目录必须仍在 uploadPath 内（originalname 由客户端控制）
          if (!fullPath.startsWith(resolvedUpload + path.sep)) {
            return cb(new Error('上传目标路径不合法'), '');
          }
          fs.mkdirSync(fullPath, { recursive: true });
          cb(null, fullPath);
        } else {
          cb(null, uploadPath);
        }
      } catch (error) {
        cb(error as Error, '');
      }
    },
    filename: (_: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
      try {
        const decodedName = decodeFileName(file.originalname);
        const fileName = path.basename(decodedName);

        // 检查文件是否存在（路径限制在 uploadPath 内）
        const fullPath = path.resolve(uploadPath, decodedName);
        if (fullPath.startsWith(resolvedUpload + path.sep) && fs.existsSync(fullPath)) {
          const ext = path.extname(fileName);
          const name = path.basename(fileName, ext);
          cb(null, `${name}-${randomUUID()}${ext}`);
        } else {
          cb(null, fileName);
        }
      } catch (error) {
        cb(error as Error, '');
      }
    },
  });
};

export const createDiskUpload = (uploadPath: string): RequestHandler => {
  const upload = multer({
    storage: createDiskStorage(uploadPath),
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB 文件大小限制
      files: 20, // 最多同时上传20个文件
      fieldSize: 1024 * 1024, // 1MB 字段大小限制
      fields: 10, // 最多10个字段
    },
  }).array('files');
  return upload;
};

const diskUploader = (req: Request, res: Response) => {
  const uploadPath = sanitizeUploadPath((req.query['path'] || '') as string);
  if (!uploadPath) {
    return Promise.reject(new Error('上传路径不合法'));
  }
  return new Promise((resolve, reject) => {
    createDiskUpload(uploadPath)(req, res, (error) => {
      if (error) {
        // 错误处理
        if (error.code === 'LIMIT_FILE_SIZE') {
          return reject(new Error('文件大小超过限制（最大100MB）'));
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
          return reject(new Error('文件数量超过限制（最多20个文件）'));
        }
        if (error.code === 'LIMIT_FIELD_VALUE') {
          return reject(new Error('字段值大小超过限制'));
        }
        if (error.code === 'LIMIT_FIELD_COUNT') {
          return reject(new Error('字段数量超过限制'));
        }
        return reject(error);
      }
      return resolve(true);
    });
  });
};
export default diskUploader;
