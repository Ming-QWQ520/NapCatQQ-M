import path from 'node:path';
import fs from 'node:fs';
import type { NapCatCore } from '@/napcat-core';
import json5 from 'json5';
import { TypeCompiler, TypeCheck } from '@sinclair/typebox/compiler';
import { Value } from '@sinclair/typebox/value';
import { TSchema } from '@sinclair/typebox';

export abstract class ConfigBase<T> {
  name: string;
  core: NapCatCore;
  configPath: string;
  configData: T = {} as T;
  configSchema: TSchema;
  validate: TypeCheck<TSchema>;

  protected constructor (name: string, core: NapCatCore, configPath: string, ConfigSchema: TSchema) {
    this.name = name;
    this.core = core;
    this.configPath = configPath;
    this.configSchema = ConfigSchema;
    this.validate = TypeCompiler.Compile(ConfigSchema);
    fs.mkdirSync(this.configPath, { recursive: true });
    this.read();
  }

  getConfigPath (pathName?: string): string {
    const filename = pathName ? `${this.name}_${pathName}.json` : `${this.name}.json`;
    return path.join(this.configPath, filename);
  }

  read (): T {
    const configPath = this.getConfigPath(this.core.selfInfo.uin);
    const defaultConfigPath = this.getConfigPath();
    if (!fs.existsSync(configPath)) {
      if (fs.existsSync(defaultConfigPath)) {
        this.configData = this.loadConfig(defaultConfigPath);
      }
      this.save();
      return this.configData;
    }
    return this.loadConfig(configPath);
  }

  private loadConfig (configPath: string): T {
    try {
      const newConfigData = json5.parse(fs.readFileSync(configPath, 'utf-8'));
      let data: unknown = newConfigData;
      data = Value.Parse(this.configSchema, data);
      if (!this.validate.Check(data)) {
        throw new Error([...this.validate.Errors(data)].map(e => e.message).join(', '));
      }
      this.configData = data as T;
      this.core.context.logger.logDebug(`[Core] [Config] 配置文件${configPath}加载`, this.configData);
      return this.configData;
    } catch (e: unknown) {
      this.handleError(e, '读取配置文件时发生错误');
      // 用 schema 默认值兜底：直接返回空对象会让下游访问字段（如 network）崩溃，
      // 且后续 save 会用默认值静默覆盖用户配置
      const fallback = this.buildFallbackConfig();
      this.backupBrokenConfig(configPath);
      this.configData = fallback;
      return fallback;
    }
  }

  private buildFallbackConfig (): T {
    try {
      return Value.Parse(this.configSchema, {}) as T;
    } catch {
      // schema 含无默认值的必填字段时 Parse 可能失败，此时退回空对象
      return {} as T;
    }
  }

  private backupBrokenConfig (configPath: string): void {
    try {
      if (fs.existsSync(configPath)) {
        const backupPath = `${configPath}.bak`;
        if (!fs.existsSync(backupPath)) {
          fs.copyFileSync(configPath, backupPath);
          this.core.context.logger.logWarn(`[Core] [Config] 损坏的配置文件已备份为 ${backupPath}`);
        }
      }
    } catch {
      // 备份失败不影响启动
    }
  }

  save (newConfigData: T = this.configData): void {
    const configPath = this.getConfigPath(this.core.selfInfo.uin);
    let data: unknown = newConfigData;
    data = Value.Parse(this.configSchema, data);
    if (!this.validate.Check(data)) {
      throw new Error([...this.validate.Errors(data)].map(e => e.message).join(', '));
    }
    this.configData = data as T;
    try {
      fs.writeFileSync(configPath, JSON.stringify(this.configData, null, 2));
    } catch (e: unknown) {
      this.handleError(e, `保存配置文件 ${configPath} 时发生错误:`);
    }
  }

  private handleError (e: unknown, message: string): void {
    if (e instanceof SyntaxError) {
      this.core.context.logger.logError('[Core] [Config] 操作配置文件格式错误，请检查配置文件:', e.message);
    } else {
      this.core.context.logger.logError(`[Core] [Config] ${message}:`, (e as Error).message);
    }
  }
}
