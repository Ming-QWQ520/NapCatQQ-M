import { OB11EmitEventContent, OB11NetworkReloadType } from '@/napcat-onebot/network/index';
import { createHmac } from 'crypto';
import { QuickAction, QuickActionEvent } from '@/napcat-onebot/types';
import { RequestUtil } from 'napcat-common/src/request';
import { HttpClientConfig } from '@/napcat-onebot/config/config';
import { IOB11NetworkAdapter } from '@/napcat-onebot/network/adapter';
import json5 from 'json5';

export class OB11HttpClientAdapter extends IOB11NetworkAdapter<HttpClientConfig> {
  async onEvent<T extends OB11EmitEventContent> (event: T) {
    this.emitEventAsync(event).catch(e => this.logger.logError('[OneBot] [Http Client] 新消息事件HTTP上报返回快速操作失败', e));
  }

  async emitEventAsync<T extends OB11EmitEventContent> (event: T) {
    if (!this.isEnable) return;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-self-id': this.core.selfInfo.uin,
    };

    const msgStr = JSON.stringify(event);
    if (this.config.token) {
      const hmac = createHmac('sha1', this.config.token);
      hmac.update(msgStr);
      headers['x-signature'] = 'sha1=' + hmac.digest('hex');
    }

    const data = await RequestUtil.HttpGetText(this.config.url, 'POST', msgStr, headers);
    // 上报端可能返回非 JSON 内容（如 HTML 错误页），解析失败时按无快速操作处理
    let resJson: QuickAction = {};
    if (data) {
      try {
        resJson = json5.parse(data);
      } catch (e) {
        this.logger.logDebug('[OneBot] [Http Client] 上报响应不是合法 JSON，忽略快速操作', e);
      }
    }

    await this.obContext.apis.QuickActionApi.handleQuickOperation(event as QuickActionEvent, resJson);
  }

  open () {
    this.isEnable = true;
  }

  close () {
    this.isEnable = false;
  }

  async reload (newConfig: HttpClientConfig) {
    const wasEnabled = this.isEnable;
    const oldUrl = this.config.url;
    this.config = newConfig;

    if (newConfig.enable && !wasEnabled) {
      this.open();
      return OB11NetworkReloadType.NetWorkOpen;
    } else if (!newConfig.enable && wasEnabled) {
      this.close();
      return OB11NetworkReloadType.NetWorkClose;
    }

    if (oldUrl !== newConfig.url) {
      return OB11NetworkReloadType.NetWorkReload;
    }

    return OB11NetworkReloadType.Normal;
  }
}
