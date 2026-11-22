/**
 * @file AstrBot 仪表盘密码桥（共用密码模式）
 *
 * 当环境变量 NAPCAT_ASTRBOT_CONFIG 指向 AstrBot 的 data/cmd_config.json
 * （由 NapCat-M Stack 统一启动器注入）时，WebUI 启用「共用密码」登录：
 *
 * - 登录密码与 AstrBot 仪表盘一致，以 AstrBot 为准；
 * - 本服务不再生成/存储自己的登录密码，改密请前往 AstrBot 控制台；
 * - AstrBot 侧修改密码后按文件 mtime 自动重新加载，无需重启即生效。
 *
 * 哈希格式与校验逻辑对齐 astrbot/core/utils/auth_password.py：
 *   - 优先 dashboard.pbkdf2_password：pbkdf2_sha256$<iterations>$<salt-hex>$<digest-hex>
 *   - 回退 dashboard.password：32 位 MD5（旧版存储兼容）
 */

import { createHash, pbkdf2, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

/** 指向 AstrBot data/cmd_config.json 的环境变量 */
export const ASTRBOT_CONFIG_ENV = 'NAPCAT_ASTRBOT_CONFIG';

export function getAstrBotConfigPath (): string | null {
  const raw = process.env[ASTRBOT_CONFIG_ENV]?.trim();
  return raw ? raw : null;
}

/** 是否启用共用密码模式（NAPCAT_ASTRBOT_CONFIG 已设置） */
export function isSharedPasswordMode (): boolean {
  return getAstrBotConfigPath() !== null;
}

interface AstrBotDashboardHashes {
  pbkdf2?: string;
  md5?: string;
}

interface CachedAstrBotConfig {
  mtimeMs: number;
  size: number;
  hashes: AstrBotDashboardHashes | null;
}

let cachedConfig: CachedAstrBotConfig | null = null;

function isMd5Hash (value: string): boolean {
  return /^[a-fA-F0-9]{32}$/.test(value);
}

/**
 * 读取 AstrBot 仪表盘密码哈希（按 mtime+size 缓存）。
 * 文件不存在（AstrBot 尚未完成初始化）或解析失败时返回 null，且不缓存
 * 失败结果——首次启动时该文件会在数秒后出现，之后无需重启 NapCat。
 */
function loadAstrBotDashboardHashes (): AstrBotDashboardHashes | null {
  const configPath = getAstrBotConfigPath();
  if (!configPath) {
    return null;
  }
  try {
    const stat = statSync(configPath);
    if (
      cachedConfig
      && cachedConfig.mtimeMs === stat.mtimeMs
      && cachedConfig.size === stat.size
    ) {
      return cachedConfig.hashes;
    }
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    const dashboard = raw?.dashboard;
    const hashes: AstrBotDashboardHashes | null =
      dashboard && typeof dashboard === 'object'
        ? {
          pbkdf2:
            typeof dashboard.pbkdf2_password === 'string'
              ? dashboard.pbkdf2_password
              : undefined,
          md5:
            typeof dashboard.password === 'string' && isMd5Hash(dashboard.password)
              ? dashboard.password
              : undefined,
        }
        : null;
    cachedConfig = { mtimeMs: stat.mtimeMs, size: stat.size, hashes };
    return hashes;
  } catch (_error) {
    cachedConfig = null;
    return null;
  }
}

async function verifyPbkdf2 (stored: string, rawPassword: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }
  const iterations = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(iterations) || iterations <= 0 || iterations > 10_000_000) {
    return false;
  }
  try {
    const salt = Buffer.from(parts[2] ?? '', 'hex');
    const digest = Buffer.from(parts[3] ?? '', 'hex');
    if (salt.length === 0 || digest.length === 0) {
      return false;
    }
    // 与 Python hashlib.pbkdf2_hmac('sha256', password, salt, iterations) 等价
    const candidate = await pbkdf2Async(rawPassword, salt, iterations, digest.length, 'sha256');
    return timingSafeEqual(candidate, digest);
  } catch (_error) {
    return false;
  }
}

function verifyMd5 (stored: string, rawPassword: string): boolean {
  const candidate = createHash('md5').update(rawPassword, 'utf-8').digest('hex');
  return timingSafeEqual(
    Buffer.from(candidate, 'hex'),
    Buffer.from(stored.toLowerCase(), 'hex')
  );
}

/**
 * 校验明文密码是否与 AstrBot 仪表盘当前密码一致。
 * PBKDF2 优先、MD5 兼容回退；每次调用都会检查文件 mtime，
 * AstrBot 控制台里改密后立即对新登录生效。
 */
export async function verifyAstrBotPassword (rawPassword: string): Promise<boolean> {
  if (typeof rawPassword !== 'string' || rawPassword.length === 0) {
    return false;
  }
  const hashes = loadAstrBotDashboardHashes();
  if (!hashes) {
    return false;
  }
  if (hashes.pbkdf2 && hashes.pbkdf2.startsWith('pbkdf2_sha256$')) {
    return verifyPbkdf2(hashes.pbkdf2, rawPassword);
  }
  if (hashes.md5) {
    return verifyMd5(hashes.md5, rawPassword);
  }
  return false;
}

/** 供登录错误提示区分「密码错误」与「AstrBot 尚未就绪」 */
export function isAstrBotConfigReadable (): boolean {
  return loadAstrBotDashboardHashes() !== null;
}
