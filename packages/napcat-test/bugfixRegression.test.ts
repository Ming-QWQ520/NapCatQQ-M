import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LimitedHashTable, MessageUnique } from '@/napcat-common/src/message-unique';
import store from '@/napcat-common/src/store';
import { uriToLocalFile } from '@/napcat-common/src/file';
import { imageSizeFromBuffer } from '@/napcat-image-size/src';

describe('LimitedHashTable（消息映射修复回归）', () => {
  it('同 value 的不同 key 碰撞不应清空全表', () => {
    const table = new LimitedHashTable<string, number>(100);
    table.set('a', 1);
    table.set('b', 2);
    // 模拟 32 位 shortId 碰撞：不同 key 映射到同一 value
    table.set('c', 1);
    // 修复前：valueToKey 覆盖导致两表尺寸不一致，触发 while 全表 clear
    expect(table.getValue('a')).toBeUndefined();
    expect(table.getValue('b')).toBe(2);
    expect(table.getValue('c')).toBe(1);
    expect(table.getKey(1)).toBe('c');
    expect(table.getKey(2)).toBe('b');
  });

  it('同 key 覆盖应清理旧 value 映射', () => {
    const table = new LimitedHashTable<string, number>(100);
    table.set('a', 1);
    table.set('a', 2);
    expect(table.getKey(1)).toBeUndefined();
    expect(table.getKey(2)).toBe('a');
    expect(table.getValue('a')).toBe(2);
  });

  it('getHeads 返回最新写入的条目且不越界丢条目', () => {
    const table = new LimitedHashTable<string, number>(100);
    for (let i = 1; i <= 5; i++) {
      table.set(`k${i}`, i);
    }
    const heads2 = table.getHeads(2);
    expect(heads2?.map(h => h.key)).toEqual(['k5', 'k4']);
    // 修复前 size > length 时 i=0 取到 undefined，漏掉最新一条
    const headsAll = table.getHeads(10);
    expect(headsAll?.length).toBe(5);
    expect(headsAll?.[0]?.key).toBe('k5');
  });

  it('MessageUnique 基本换算与 getRecentMsgIds', () => {
    const peer = { chatType: 1, peerUid: 'u_test', guildId: '' };
    const shortId = MessageUnique.createUniqueMsgId(peer, 'msg_1');
    const recovered = MessageUnique.getMsgIdAndPeerByShortId(shortId);
    expect(recovered?.MsgId).toBe('msg_1');
    expect(recovered?.Peer.peerUid).toBe('u_test');
  });
});

describe('store TTL（修复回归）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('覆盖同 key 时旧 TTL 定时器不应提前删除新值', () => {
    vi.useFakeTimers();
    store.set('revoked:x', true, 10);
    // 模拟重复注销同一凭证（第二次 set 覆盖）
    store.set('revoked:x', true, 10);
    vi.advanceTimersByTime(5 * 1000);
    expect(store.exists('revoked:x')).toBe(1);
    vi.advanceTimersByTime(6 * 1000);
    expect(store.exists('revoked:x')).toBe(0);
  });
});

describe('JPEG 解析器（修复回归）', () => {
  const buildSegment = (marker: number, payload: Buffer): Buffer => {
    // 段 = FF marker + 段长(2B，含段长字段自身) + payload
    const length = Buffer.alloc(2);
    length.writeUInt16BE(payload.length + 2, 0);
    return Buffer.concat([Buffer.from([0xFF, marker]), length, payload]);
  };

  const buildJpeg = (): Buffer => {
    const parts: Buffer[] = [];
    // SOI
    parts.push(Buffer.from([0xFF, 0xD8]));
    // APP1（EXIF 风格）：payload 内嵌一个伪 SOF0 的"缩略图"尺寸 111x222，
    // 修复前会裸扫进 payload 误返回缩略图尺寸
    const decoy = Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0xDE, 0x00, 0x6F]);
    parts.push(buildSegment(0xE1, Buffer.concat([
      Buffer.from('Exif\0\0fake', 'latin1'),
      decoy,
      Buffer.alloc(16, 0x11),
    ])));
    // DHT（0xC4）：修复前只前进 2 字节，同样会扫进 payload
    parts.push(buildSegment(0xC4, Buffer.alloc(20, 0x22)));
    // 真实 SOF2（渐进式，修复前不认识）：480x640
    parts.push(Buffer.from([0xFF, 0xC2, 0x00, 0x11, 0x08, 0x01, 0xE0, 0x02, 0x80, 0x03, 0x00, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]));
    // 结尾随便填一点
    parts.push(Buffer.alloc(8, 0x00));
    return Buffer.concat(parts);
  };

  it('SOF2（渐进式）被识别且不误读 EXIF 缩略图/DHT payload', async () => {
    const size = await imageSizeFromBuffer(buildJpeg());
    expect(size).toEqual({ width: 640, height: 480 });
  });

  it('基线 SOF0 仍然正常解析', async () => {
    const baseline = Buffer.concat([
      Buffer.from([0xFF, 0xD8]),
      Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x32, 0x00, 0x64, 0x03, 0x00, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
      Buffer.alloc(8, 0x00),
    ]);
    const size = await imageSizeFromBuffer(baseline);
    expect(size).toEqual({ width: 100, height: 50 });
  });
});

describe('uriToLocalFile 路径穿越清洗（修复回归）', () => {
  it('含 .. 的 filename 只保留基础名，不逃出目标目录', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'napcat-dl-'));
    try {
      const traversalName = path.sep === '\\' ? '..\\..\\napcat-evil.txt' : '../../napcat-evil.txt';
      const result = await uriToLocalFile(tmpDir, 'base64://' + Buffer.from('hello').toString('base64'), traversalName);
      expect(result.success).toBe(true);
      const resolvedWritten = path.resolve(result.path);
      const resolvedDir = path.resolve(tmpDir);
      expect(resolvedWritten.startsWith(resolvedDir + path.sep)).toBe(true);
      expect(path.basename(resolvedWritten)).toBe('napcat-evil.txt');
      expect(fs.readFileSync(resolvedWritten).toString()).toBe('hello');
      // 确认没有写到 tmpDir 之外
      expect(fs.existsSync(path.resolve(tmpDir, '..', 'napcat-evil.txt'))).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
