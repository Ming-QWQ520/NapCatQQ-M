import crypto from 'crypto';
import store from 'napcat-common/src/store';
import type { WebUiCredentialJson, WebUiCredentialInnerJson } from '@/napcat-webui-backend/src/types';
export class AuthHelper {
  private static readonly secretKey = process.env['NAPCAT_WEBUI_JWT_SECRET_KEY'] || Math.random().toString(36).slice(2);
  private static readonly MAX_CREDENTIAL_VALID_SECONDS = 3600;

  public static getSecretKey (): string {
    return AuthHelper.secretKey;
  }

  /**
   * 常量时间字符串比较：两侧先哈希成定长摘要再比较，
   * 避免逐字符比较（===）的时序侧信道
   */
  public static timingSafeEqualString (a: string, b: string): boolean {
    const bufA = crypto.createHash('sha256').update(a).digest();
    const bufB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(bufA, bufB);
  }

  /**
     * 签名凭证方法。
     * @param hash 待签名的凭证字符串。
     * @returns 签名后的凭证对象。
     */
  public static signCredential (hash: string): WebUiCredentialJson {
    const innerJson: WebUiCredentialInnerJson = {
      // 统一使用秒级时间戳，避免与校验逻辑出现单位不一致
      CreatedTime: Math.floor(Date.now() / 1000),
      HashEncoded: hash,
    };
    const jsonString = JSON.stringify(innerJson);
    const hmac = crypto.createHmac('sha256', AuthHelper.secretKey).update(jsonString, 'utf8').digest('hex');
    return { Data: innerJson, Hmac: hmac };
  }

  /**
     * 检查凭证是否被篡改的方法。
     * @param credentialJson 凭证的JSON对象。
     * @returns 布尔值，表示凭证是否有效。
     */
  public static checkCredential (credentialJson: WebUiCredentialJson): boolean {
    try {
      const jsonString = JSON.stringify(credentialJson.Data);
      const calculatedHmac = crypto
        .createHmac('sha256', AuthHelper.secretKey)
        .update(jsonString, 'utf8')
        .digest('hex');
      return AuthHelper.timingSafeEqualString(calculatedHmac, credentialJson.Hmac);
    } catch (_error) {
      return false;
    }
  }

  /**
     * 验证凭证在1小时内有效，且（可选）与指定密码哈希绑定。
     * @param expectedHash 期望的密码哈希（SHA256(密码 + '.napcat')）；
     *                    传 null 表示不与密码绑定（共用密码模式下密码以
     *                    AstrBot 为准，服务端不落盘，无法做绑定比对）
     * @param credentialJson 已签名的凭证JSON对象。
     * @returns 布尔值，表示凭证是否有效。
     */
  public static validateCredentialWithinOneHour (expectedHash: string | null, credentialJson: WebUiCredentialJson): boolean {
    // 首先检查凭证是否被篡改
    const isValid = AuthHelper.checkCredential(credentialJson);
    if (!isValid) {
      return false;
    }

    // 检查凭证是否在黑名单中
    if (AuthHelper.isCredentialRevoked(credentialJson)) {
      return false;
    }

    const currentTimeSeconds = Math.floor(Date.now() / 1000);
    const createdTimeSeconds = Math.floor(Number(credentialJson.Data.CreatedTime));
    const timeDifferenceSeconds = currentTimeSeconds - createdTimeSeconds;
    const isWithinOneHour = timeDifferenceSeconds >= 0 && timeDifferenceSeconds <= AuthHelper.MAX_CREDENTIAL_VALID_SECONDS;
    if (!isWithinOneHour) {
      return false;
    }
    if (expectedHash === null) {
      return true;
    }
    return AuthHelper.timingSafeEqualString(credentialJson.Data.HashEncoded, expectedHash);
  }

  /**
     * 注销指定的Token凭证
     * @param credentialJson 凭证JSON对象
     * @returns void
     */
  public static revokeCredential (credentialJson: WebUiCredentialJson): void {
    const jsonString = JSON.stringify(credentialJson.Data);
    const hmac = crypto.createHmac('sha256', AuthHelper.secretKey).update(jsonString, 'utf8').digest('hex');

    // 将已注销的凭证添加到黑名单中，有效期1小时
    store.set(`revoked:${hmac}`, true, 3600);
  }

  /**
     * 检查凭证是否已被注销
     * @param credentialJson 凭证JSON对象
     * @returns 布尔值，表示凭证是否已被注销
     */
  public static isCredentialRevoked (credentialJson: WebUiCredentialJson): boolean {
    const jsonString = JSON.stringify(credentialJson.Data);
    const hmac = crypto.createHmac('sha256', AuthHelper.secretKey).update(jsonString, 'utf8').digest('hex');

    return store.exists(`revoked:${hmac}`) > 0;
  }

  /**
     * 生成密码Hash
     * @param password 密码
     * @returns 生成的Hash值
     */
  public static generatePasswordHash (password: string): string {
    return crypto.createHash('sha256').update(password + '.napcat').digest().toString('hex');
  }

  /**
     * 对比密码和Hash值
     * @param password 密码
     * @param hash Hash值
     * @returns 布尔值，表示密码是否匹配Hash值
     */
  public static comparePasswordHash (password: string, hash: string): boolean {
    return AuthHelper.timingSafeEqualString(AuthHelper.generatePasswordHash(password), hash);
  }
}
