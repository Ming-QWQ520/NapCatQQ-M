import { NextFunction, Request, Response } from 'express';

import { getInitialWebUiPassword, getWebUiPasswordChangeRequired } from '@/napcat-webui-backend/index';

import { AuthHelper } from '@/napcat-webui-backend/src/helper/SignToken';
import { sendError } from '@/napcat-webui-backend/src/utils/response';
import type { WebUiCredentialJson } from '@/napcat-webui-backend/src/types';

// 强制改密期间仍允许访问的接口（完成改密所需的最小集合）
const CHANGE_REQUIRED_ALLOWED_PATHS = new Set([
  '/auth/check',
  '/auth/logout',
  '/auth/update_password',
]);

// 鉴权中间件
export async function auth (req: Request, res: Response, next: NextFunction) {
  // 判断当前url是否为/login 如果是跳过鉴权
  if (req.url === '/auth/login') {
    return next();
  }
  if (req.url === '/auth/passkey/generate-authentication-options' ||
    req.url === '/auth/passkey/verify-authentication') {
    return next();
  }
  let hash: string | undefined;
  if (req.headers?.authorization) {
    // 切割参数以获取token
    const authorization = req.headers.authorization.split(' ');
    // 当Bearer后面没有参数时
    if (authorization.length < 2) {
      return sendError(res, 'Unauthorized');
    }
    // 获取token
    hash = authorization[1];
  } else if (req.query['webui_token'] && typeof req.query['webui_token'] === 'string') {
    // 支持通过query参数传递token
    hash = req.query['webui_token'];
  }
  // 判断是否有Authorization头
  if (hash) {
    // if (!hash) return sendError(res, 'Unauthorized');
    // 解析token
    let Credential: WebUiCredentialJson;
    try {
      Credential = JSON.parse(Buffer.from(hash, 'base64').toString('utf-8'));
    } catch (_e) {
      return sendError(res, 'Unauthorized');
    }
    // 使用启动时缓存的密码进行验证，而不是动态读取配置文件 因为有可能运行时手动修改了密码
    const initialPassword = getInitialWebUiPassword();
    if (!initialPassword) {
      return sendError(res, 'Server password not initialized');
    }
    // 验证凭证在1小时内有效
    const credentialJson = AuthHelper.validateCredentialWithinOneHour(initialPassword, Credential);
    if (credentialJson) {
      // 首次登录后未修改密码时，拦截除改密外的全部业务接口
      if (getWebUiPasswordChangeRequired() && !CHANGE_REQUIRED_ALLOWED_PATHS.has(req.url)) {
        return sendError(res, 'password_change_required');
      }
      // 通过验证
      return next();
    }
    // 验证失败
    return sendError(res, 'Unauthorized');
  }

  // 没有Authorization头
  return sendError(res, 'Unauthorized');
}
