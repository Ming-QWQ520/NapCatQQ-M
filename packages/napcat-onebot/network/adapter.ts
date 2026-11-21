import crypto from 'node:crypto';
import { NetworkAdapterConfig } from '@/napcat-onebot/config/config';
import { LogWrapper } from 'napcat-core/helper/log';
import { NapCatCore } from 'napcat-core';
import { NapCatOneBot11Adapter } from '@/napcat-onebot/index';
import { ActionMap } from '@/napcat-onebot/action';
import { OB11EmitEventContent, OB11NetworkReloadType } from '@/napcat-onebot/network/index';

export abstract class IOB11NetworkAdapter<CT extends NetworkAdapterConfig> {
  name: string;
  isEnable: boolean = false;
  config: CT;
  readonly logger: LogWrapper;
  readonly core: NapCatCore;
  readonly obContext: NapCatOneBot11Adapter;
  readonly actions: ActionMap;

  constructor (name: string, config: CT, core: NapCatCore, obContext: NapCatOneBot11Adapter, actions: ActionMap) {
    this.name = name;
    this.config = structuredClone(config);
    this.core = core;
    this.obContext = obContext;
    this.actions = actions;
    this.logger = core.context.logger;
  }

  // 常量时间字符串比较：两侧先哈希成定长摘要再比较，避免逐字符比较的时序侧信道
  protected static timingSafeEqualString (a: string, b: string): boolean {
    const bufA = crypto.createHash('sha256').update(a).digest();
    const bufB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(bufA, bufB);
  }

  // 从 Authorization 头提取 token，兼容 "Bearer <token>" 与裸 token 两种写法
  protected extractTokenFromAuthorization (authorization: string | undefined): string {
    if (!authorization) return '';
    const trimmed = authorization.trim();
    if (trimmed.startsWith('Bearer ')) return trimmed.slice('Bearer '.length).trim();
    return trimmed;
  }

  abstract onEvent<T extends OB11EmitEventContent> (event: T): Promise<void>;

  abstract open (): void | Promise<void>;

  abstract close (): void | Promise<void>;

  abstract reload (config: unknown): OB11NetworkReloadType | Promise<OB11NetworkReloadType>;

  get isActive (): boolean {
    return this.isEnable;
  }
}
