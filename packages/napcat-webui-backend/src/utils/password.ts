/**
 * @file WebUI 账户密码工具
 */

import { randomInt } from 'node:crypto';

/** 密码最小长度（策略：不能小于 6 位） */
export const WEBUI_PASSWORD_MIN_LENGTH = 6;
/** 密码最大长度（策略：不能超过 12 位） */
export const WEBUI_PASSWORD_MAX_LENGTH = 12;
/** 自动生成的初始密码长度（取策略上限，保证熵最大化） */
export const WEBUI_GENERATED_PASSWORD_LENGTH = 12;

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const ALPHABET = UPPERCASE + LOWERCASE + DIGITS;

function pick (alphabet: string): string {
  return alphabet.charAt(randomInt(0, alphabet.length));
}

/**
 * 生成 WebUI 初始密码。
 *
 * 与 AstrBot 仪表盘初始密码同款生成逻辑（astrbot/core/utils/auth_password.py
 * 的 generate_dashboard_password）：字母+数字字母表、强制包含大写/小写/数字、
 * 加密安全随机洗牌。长度取本 WebUI 密码策略上限（12 位）。
 */
export function generateWebUiPassword (length: number = WEBUI_GENERATED_PASSWORD_LENGTH): string {
  const safeLength = Math.max(
    WEBUI_PASSWORD_MIN_LENGTH,
    Math.min(WEBUI_PASSWORD_MAX_LENGTH, length)
  );
  const chars: string[] = [
    pick(UPPERCASE),
    pick(LOWERCASE),
    pick(DIGITS),
  ];
  for (let i = 0; i < safeLength - 3; i++) {
    chars.push(pick(ALPHABET));
  }
  // Fisher-Yates 洗牌，消除前三位固定为大写/小写/数字的分布特征
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const tmp = chars[i] ?? '';
    chars[i] = chars[j] ?? '';
    chars[j] = tmp;
  }
  return chars.join('');
}

/**
 * 校验 WebUI 密码是否满足复杂度策略。
 *
 * 策略：必须包含英文与数字，长度 6-12 位。
 *
 * @returns 校验失败时返回错误信息，通过时返回 null
 */
export function validateWebUiPassword (password: string): string | null {
  if (typeof password !== 'string' || password.trim().length === 0) {
    return '密码不能为空';
  }
  if (password.length < WEBUI_PASSWORD_MIN_LENGTH) {
    return `密码长度不能小于${WEBUI_PASSWORD_MIN_LENGTH}位`;
  }
  if (password.length > WEBUI_PASSWORD_MAX_LENGTH) {
    return `密码长度不能超过${WEBUI_PASSWORD_MAX_LENGTH}位`;
  }
  if (!/[a-zA-Z]/.test(password)) {
    return '密码必须包含英文';
  }
  if (!/[0-9]/.test(password)) {
    return '密码必须包含数字';
  }
  return null;
}
