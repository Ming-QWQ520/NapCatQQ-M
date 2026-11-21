import type { RequestHandler } from 'express';
import { WebUiConfig } from '@/napcat-webui-backend/index';

// 标准化 IP 地址（移除 IPv6 前缀，但保留完整的 IPv6 地址）
function normalizeIP (ip: string): string {
  // 移除 IPv4-mapped IPv6 前缀
  if (ip.startsWith('::ffff:')) {
    const ipv4 = ip.substring(7);
    // 检查是否是有效的 IPv4
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ipv4)) {
      return ipv4;
    }
  }
  return ip;
}

// 检查是否是 IPv6 地址
function isIPv6 (ip: string): boolean {
  return ip.includes(':');
}

// 检查 IP 是否匹配规则（支持 IPv4 和 IPv6）
function matchIPRule (ip: string, rule: string): boolean {
  const cleanIP = normalizeIP(ip);
  const cleanRule = normalizeIP(rule);

  // 精确匹配
  if (cleanIP === cleanRule) return true;

  // IPv6 地址不支持通配符，只支持 CIDR
  if (isIPv6(cleanIP) || isIPv6(cleanRule)) {
    if (cleanRule.includes('/')) {
      return matchIPv6CIDR(cleanIP, cleanRule);
    }
    return false;
  }

  // IPv4 通配符匹配 (例如: 192.168.*.* 或 192.168.1.*)
  if (cleanRule.includes('*')) {
    const ruleRegex = new RegExp('^' + cleanRule.replace(/\./g, '\\.').replace(/\*/g, '\\d+') + '$');
    return ruleRegex.test(cleanIP);
  }

  // IPv4 CIDR 匹配 (例如: 192.168.1.0/24)
  if (cleanRule.includes('/')) {
    return matchIPv4CIDR(cleanIP, cleanRule);
  }

  return false;
}

// IPv4 CIDR 匹配
function matchIPv4CIDR (ip: string, cidr: string): boolean {
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;

  const range = parts[0];
  const bits = parts[1];
  if (!range || !bits) return false;

  const prefixLength = parseInt(bits);
  if (isNaN(prefixLength) || prefixLength < 0 || prefixLength > 32) return false;

  const mask = prefixLength === 0 ? 0 : ~(2 ** (32 - prefixLength) - 1);

  const ipNum = ipv4ToNumber(ip);
  const rangeNum = ipv4ToNumber(range);

  if (ipNum === null || rangeNum === null) return false;

  return (ipNum & mask) === (rangeNum & mask);
}

// IPv4 转数字
function ipv4ToNumber (ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  const nums = parts.map(p => parseInt(p));
  if (nums.some(n => isNaN(n) || n < 0 || n > 255)) return null;

  return ((nums[0] || 0) << 24) + ((nums[1] || 0) << 16) + ((nums[2] || 0) << 8) + (nums[3] || 0);
}

// IPv6 CIDR 匹配
function matchIPv6CIDR (ip: string, cidr: string): boolean {
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;

  const range = parts[0];
  const bits = parts[1];
  if (!range || !bits) return false;

  const prefixLength = parseInt(bits);
  if (isNaN(prefixLength) || prefixLength < 0 || prefixLength > 128) return false;

  try {
    const ipSegments = expandIPv6(ip);
    const rangeSegments = expandIPv6(range);

    if (!ipSegments || !rangeSegments) return false;

    // 按位比较
    let bitsToCompare = prefixLength;
    for (let i = 0; i < 8; i++) {
      if (bitsToCompare <= 0) break;

      const ipSeg = ipSegments[i] ?? 0;
      const rangeSeg = rangeSegments[i] ?? 0;

      if (bitsToCompare >= 16) {
        // 完整比较这个段
        if (ipSeg !== rangeSeg) return false;
        bitsToCompare -= 16;
      } else {
        // 部分比较这个段
        const mask = (0xFFFF << (16 - bitsToCompare)) & 0xFFFF;
        if ((ipSeg & mask) !== (rangeSeg & mask)) return false;
        break;
      }
    }

    return true;
  } catch (_error) {
    return false;
  }
}

// 展开 IPv6 地址为 8 个 16 位段
function expandIPv6 (ip: string): number[] | null {
  try {
    // 移除可能的 IPv4 映射部分
    let addr = ip;

    // 处理 IPv4-mapped IPv6 (如 ::ffff:192.168.1.1)
    const ipv4Match = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (ipv4Match && ipv4Match[1]) {
      const ipv4 = ipv4Match[1];
      const ipv4Parts = ipv4.split('.').map(p => parseInt(p));
      if (ipv4Parts.length === 4 && ipv4Parts.every(n => n >= 0 && n <= 255)) {
        // 转换为 IPv6 格式
        const part1 = (ipv4Parts[0] ?? 0) << 8 | (ipv4Parts[1] ?? 0);
        const part2 = (ipv4Parts[2] ?? 0) << 8 | (ipv4Parts[3] ?? 0);
        addr = `::ffff:${part1.toString(16)}:${part2.toString(16)}`;
      }
    }

    // 处理 :: 缩写
    if (addr.includes('::')) {
      const sides = addr.split('::');
      if (sides.length > 2) return null;

      const left = sides[0] ? sides[0].split(':') : [];
      const right = sides[1] ? sides[1].split(':') : [];
      const missing = 8 - left.length - right.length;

      if (missing < 0) return null;

      const segments = [
        ...left,
        ...Array(missing).fill('0'),
        ...right,
      ];

      return segments.map(s => parseInt(s || '0', 16));
    }

    // 标准格式
    const segments = addr.split(':');
    if (segments.length !== 8) return null;

    return segments.map(s => parseInt(s || '0', 16));
  } catch (_error) {
    return null;
  }
}

// 检查是否在 IP 列表中
function isIPInList (ip: string, ipList: string[]): boolean {
  return ipList.some(rule => matchIPRule(ip, rule));
}

// 检查是否为本地/内网地址（即直连方可能是可信的反向代理）
function isPrivateOrLoopback (rawIp: string): boolean {
  const ip = normalizeIP(rawIp);
  if (ip === '::1' || ip === 'localhost') return true;
  if (isIPv6(ip)) {
    // IPv6 唯一本地地址 fc00::/7 与链路本地地址 fe80::/10
    const expanded = expandIPv6(ip);
    if (!expanded) return false;
    const first = expanded[0] ?? 0;
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  const parts = ip.split('.').map(p => parseInt(p));
  if (parts.length !== 4 || parts.some(n => isNaN(n))) return false;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // 链路本地
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

// CORS 中间件，跨域用
export const cors: RequestHandler = async (req, res, next) => {
  const config = await WebUiConfig.GetWebUIConfig();

  // 根据配置决定如何获取客户端IP
  let clientIP: string;
  const socketIP = req.ip || req.socket.remoteAddress || '';
  if (config.enableXForwardedFor) {
    // 仅当直连方是本地/内网地址（即前面存在可信反代）时才信任 X-Forwarded-For。
    // 否则任何客户端都可以自带该头伪造 IP，直接绕过白/黑名单
    if (isPrivateOrLoopback(socketIP)) {
      const forwardedFor = req.headers['x-forwarded-for'];
      if (typeof forwardedFor === 'string') {
        // X-Forwarded-For 可能包含多个IP，取第一个
        clientIP = forwardedFor.split(',')[0]?.trim() || socketIP;
      } else if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
        clientIP = forwardedFor[0] || socketIP;
      } else {
        // 如果没有 X-Forwarded-For，回退到 socket IP
        clientIP = socketIP;
      }
    } else {
      // 公网直连：忽略伪造的 X-Forwarded-For
      clientIP = socketIP;
    }
  } else {
    // 默认使用 socket IP
    clientIP = socketIP;
  }

  // 检查访问控制模式
  if (config.accessControlMode === 'whitelist') {
    // 白名单模式：只允许白名单中的IP访问
    if (!isIPInList(clientIP, config.ipWhitelist || [])) {
      res.status(403).json({ error: '访问被拒绝：IP不在白名单中' });
      return;
    }
  } else if (config.accessControlMode === 'blacklist') {
    // 黑名单模式：拒绝黑名单中的IP访问
    if (isIPInList(clientIP, config.ipBlacklist || [])) {
      res.status(403).json({ error: '访问被拒绝：IP在黑名单中' });
      return;
    }
  }
  // 'none' 模式：不进行任何限制

  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  // 反射任意 Origin 时不能同时允许凭据：WebUI 鉴权走 Authorization 头而非 Cookie，
  // 不需要 credentials，反射 + credentials 是经典的不安全 CORS 组合
  res.header('Access-Control-Allow-Credentials', 'false');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
};
