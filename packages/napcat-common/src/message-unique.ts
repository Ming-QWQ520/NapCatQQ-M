import crypto from 'crypto';
import { Peer } from './types';
export class LimitedHashTable<K, V> {
  private readonly keyToValue: Map<K, V> = new Map();
  private readonly valueToKey: Map<V, K> = new Map();
  private maxSize: number;

  constructor (maxSize: number) {
    this.maxSize = maxSize;
  }

  resize (count: number) {
    this.maxSize = count;
  }

  set (key: K, value: V): void {
    // 先清理同 key 的旧映射和占用同 value 的旧映射，保证双向表始终一致。
    // 直接 set 会让 valueToKey 覆盖旧映射而 keyToValue 残留旧条目，
    // 两表尺寸不一致时（如 32 位 shortId 碰撞）会破坏全部映射关系。
    const oldValue = this.keyToValue.get(key);
    if (oldValue !== undefined) {
      this.valueToKey.delete(oldValue);
    }
    const oldKey = this.valueToKey.get(value);
    if (oldKey !== undefined) {
      this.keyToValue.delete(oldKey);
    }
    this.keyToValue.set(key, value);
    this.valueToKey.set(value, key);
    while (this.keyToValue.size > this.maxSize || this.valueToKey.size > this.maxSize) {
      const oldestKey = this.keyToValue.keys().next().value;
      if (oldestKey !== undefined) {
        this.valueToKey.delete(this.keyToValue.get(oldestKey) as V);
        this.keyToValue.delete(oldestKey);
      }
    }
  }

  getValue (key: K): V | undefined {
    return this.keyToValue.get(key);
  }

  getKey (value: V): K | undefined {
    return this.valueToKey.get(value);
  }

  deleteByValue (value: V): void {
    const key = this.valueToKey.get(value);
    if (key !== undefined) {
      this.keyToValue.delete(key);
      this.valueToKey.delete(value);
    }
  }

  deleteByKey (key: K): void {
    const value = this.keyToValue.get(key);
    if (value !== undefined) {
      this.keyToValue.delete(key);
      this.valueToKey.delete(value);
    }
  }

  getKeyList (): K[] {
    return Array.from(this.keyToValue.keys());
  }

  // 获取最近刚写入的几个值
  getHeads (size: number): { key: K; value: V; }[] | undefined {
    const keyList = this.getKeyList();
    if (keyList.length === 0) {
      return undefined;
    }
    const result: { key: K; value: V; }[] = [];
    const listSize = Math.min(size, keyList.length);
    // Map 按插入序排列，最新写入的在末尾，应从尾部往前取
    for (let i = 0; i < listSize; i++) {
      const key = keyList[keyList.length - 1 - i];
      if (key !== undefined) {
        result.push({ key, value: this.keyToValue.get(key)! });
      }
    }
    return result;
  }
}

class MessageUniqueWrapper {
  private readonly msgDataMap: LimitedHashTable<string, number>;
  private readonly msgIdMap: LimitedHashTable<string, number>;

  constructor (maxMap: number = 5000) {
    this.msgIdMap = new LimitedHashTable<string, number>(maxMap);
    this.msgDataMap = new LimitedHashTable<string, number>(maxMap);
  }

  getRecentMsgIds (Peer: Peer, size: number): string[] {
    const heads = this.msgIdMap.getHeads(size);
    if (!heads) {
      return [];
    }
    const data = heads.map((t) => MessageUnique.getMsgIdAndPeerByShortId(t.value));
    const ret = data.filter((t) => t?.Peer.chatType === Peer.chatType && t?.Peer.peerUid === Peer.peerUid);
    return ret.map((t) => t?.MsgId).filter((t) => t !== undefined);
  }

  createUniqueMsgId (peer: Peer, msgId: string) {
    const key = `${msgId}|${peer.chatType}|${peer.peerUid}`;
    const hash = crypto.createHash('md5').update(key).digest();
    if (hash[0]) {
      // 设置第一个bit为0 保证shortId为正数
      hash[0] &= 0x7f;
    }
    const shortId = hash.readInt32BE(0);
    // 减少性能损耗
    this.msgIdMap.set(msgId, shortId);
    this.msgDataMap.set(key, shortId);
    return shortId;
  }

  getMsgIdAndPeerByShortId (shortId: number): { MsgId: string; Peer: Peer; } | undefined {
    const data = this.msgDataMap.getKey(shortId);
    if (data) {
      const [msgId, chatTypeStr, peerUid] = data.split('|');
      const peer: Peer = {
        chatType: parseInt(chatTypeStr ?? '0'),
        peerUid: peerUid ?? '',
        guildId: '',
      };
      return { MsgId: msgId ?? '0', Peer: peer };
    }
    return undefined;
  }

  getShortIdByMsgId (msgId: string): number | undefined {
    return this.msgIdMap.getValue(msgId);
  }

  getPeerByMsgId (msgId: string) {
    const shortId = this.msgIdMap.getValue(msgId);
    if (!shortId) return undefined;
    return this.getMsgIdAndPeerByShortId(shortId);
  }

  resize (maxSize: number): void {
    this.msgIdMap.resize(maxSize);
    this.msgDataMap.resize(maxSize);
  }

  isShortId (message_id: string): boolean {
    const num = Number(message_id);
    // 判断是否是整数并且在 INT32 的范围内
    return Number.isInteger(num) && num >= -2147483648 && num <= 2147483647;
  }
}

export const MessageUnique: MessageUniqueWrapper = new MessageUniqueWrapper();
