import { RequestHandler } from 'express';
import { AuthHelper } from '@/napcat-webui-backend/src/helper/SignToken';
import { PasskeyHelper } from '@/napcat-webui-backend/src/helper/PasskeyHelper';
import { TotpHelper } from '@/napcat-webui-backend/src/helper/TotpHelper';
import { WebUiDataRuntime } from '@/napcat-webui-backend/src/helper/Data';
import { sendSuccess, sendError } from '@/napcat-webui-backend/src/utils/response';
import { isEmpty } from '@/napcat-webui-backend/src/utils/check';
import { validateWebUiPassword } from '@/napcat-webui-backend/src/utils/password';
import {
  WebUiConfig,
  getInitialWebUiPassword,
  setInitialWebUiPassword,
  getWebUiPasswordChangeRequired,
  setWebUiPasswordChangeRequired,
  isSharedPasswordMode,
} from '@/napcat-webui-backend/index';

// 登录 - 账户密码 + 可选2FA验证
export const LoginHandler: RequestHandler = async (req, res) => {
  // 获取WebUI配置
  let WebUiConfigData = await WebUiConfig.GetWebUIConfig();
  // 获取请求体中的账户、密码hash和totpCode
  const { username, hash, totpCode } = req.body;
  // 获取客户端IP
  const clientIP = req.ip || req.socket.remoteAddress || '';

  // 如果账户或密码hash为空，返回错误信息
  if (isEmpty(username)) {
    return sendError(res, 'username is empty');
  }
  if (isEmpty(hash)) {
    return sendError(res, 'password is empty');
  }
  // 检查登录频率
  if (!WebUiDataRuntime.checkLoginRate(clientIP, WebUiConfigData.loginRate)) {
    return sendError(res, 'login rate limit');
  }
  // 共用密码模式：每次登录前重读磁盘配置，AstrBot 侧改密无需重启即可生效
  if (isSharedPasswordMode()) {
    const freshConfig = await WebUiConfig.ReloadWebUIConfig();
    if (freshConfig.password) {
      setInitialWebUiPassword(freshConfig.password);
    }
    WebUiConfigData = freshConfig;
  }
  // 使用启动时缓存的密码进行验证，而不是动态读取配置文件
  const initialPassword = getInitialWebUiPassword();
  if (!initialPassword) {
    return sendError(res, isSharedPasswordMode()
      ? '密码尚未同步：请先登录一次 AstrBot 控制台（统一网关首页 /），再用同一密码登录本页'
      : 'Server password not initialized');
  }
  // 验证账户
  if (!AuthHelper.timingSafeEqualString(username, WebUiConfigData.username || 'napcat')) {
    return sendError(res, 'username or password is invalid');
  }
  // 验证密码hash是否等于提交的密码hash
  if (!AuthHelper.comparePasswordHash(initialPassword, hash)) {
    return sendError(res, 'username or password is invalid');
  }

  // 检查是否启用了2FA
  if (WebUiConfigData.enable2FA && WebUiConfigData.totpSecret) {
    // 如果没有提供验证码，返回要求验证码
    if (!totpCode) {
      return sendSuccess(res, {
        require2FA: true,
        message: 'Please enter your authenticator code',
      });
    }

    // 验证TOTP验证码
    if (!TotpHelper.verifyTotp(WebUiConfigData.totpSecret, totpCode)) {
      return sendError(res, 'Invalid or expired code');
    }

    // 2FA验证成功，签发凭证
    const signCredential = Buffer.from(JSON.stringify(AuthHelper.signCredential(hash))).toString('base64');
    return sendSuccess(res, {
      Credential: signCredential,
      require2FA: false,
      passwordChangeRequired: getWebUiPasswordChangeRequired(),
    });
  }

  // 未启用2FA，直接签发凭证
  const signCredential = Buffer.from(JSON.stringify(AuthHelper.signCredential(hash))).toString('base64');
  return sendSuccess(res, {
    Credential: signCredential,
    passwordChangeRequired: getWebUiPasswordChangeRequired(),
  });
};

// 退出登录
export const LogoutHandler: RequestHandler = async (req, res) => {
  const authorization = req.headers.authorization;
  try {
    const CredentialBase64: string = authorization?.split(' ')[1] as string;
    const Credential = JSON.parse(Buffer.from(CredentialBase64, 'base64').toString());
    AuthHelper.revokeCredential(Credential);
    return sendSuccess(res, 'Logged out successfully');
  } catch (_e) {
    return sendError(res, 'Logout failed');
  }
};

// 检查登录状态
export const checkHandler: RequestHandler = async (req, res) => {
  // 获取请求头中的Authorization
  const authorization = req.headers.authorization;
  // 检查凭证
  try {
    // 从Authorization中获取凭证
    const CredentialBase64: string = authorization?.split(' ')[1] as string;
    // 解析凭证
    const Credential = JSON.parse(Buffer.from(CredentialBase64, 'base64').toString());

    // 检查凭证是否已被注销
    if (AuthHelper.isCredentialRevoked(Credential)) {
      return sendError(res, 'Token has been revoked');
    }

    // 使用启动时缓存的密码进行验证
    const initialPassword = getInitialWebUiPassword();
    if (!initialPassword) {
      return sendError(res, 'Server password not initialized');
    }
    // 验证凭证是否在一小时内有效
    const valid = AuthHelper.validateCredentialWithinOneHour(initialPassword, Credential);
    // 返回成功信息
    if (valid) return sendSuccess(res, null);
    // 返回错误信息
    return sendError(res, 'Authorization Failed');
  } catch (_e) {
    // 返回错误信息
    return sendError(res, 'Authorization Failed');
  }
};

// 修改密码（账户密码登录）
export const UpdatePasswordHandler: RequestHandler = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const authorization = req.headers.authorization;

  // 共用密码模式：密码以 AstrBot 控制台为准，不在本面板修改
  if (isSharedPasswordMode()) {
    return sendError(res, '密码已与 AstrBot 控制台共用，请在 AstrBot 控制台（统一网关首页 /）修改');
  }

  if (isEmpty(newPassword)) {
    return sendError(res, 'newPassword is empty');
  }

  // 强制要求旧密码
  if (isEmpty(oldPassword)) {
    return sendError(res, 'oldPassword is required');
  }

  // 检查新旧密码是否相同
  if (oldPassword === newPassword) {
    return sendError(res, '新密码不能与旧密码相同');
  }

  // 检查新密码复杂度（必须包含英文和数字，长度 6-12 位）
  const validationError = validateWebUiPassword(newPassword);
  if (validationError) {
    return sendError(res, validationError);
  }

  try {
    // 使用启动时缓存的密码进行验证
    const initialPassword = getInitialWebUiPassword();
    if (!initialPassword) {
      return sendError(res, 'Server password not initialized');
    }
    // 校验必须全部通过、且新密码更新成功之后才能吊销当前凭证，
    // 否则旧密码输错一次就会把当前会话踢下线
    if (!AuthHelper.timingSafeEqualString(oldPassword, initialPassword)) {
      return sendError(res, '旧密码不匹配');
    }
    // 更新配置文件中的密码并清除强制改密标记
    await WebUiConfig.UpdateWebUIConfig({
      password: newPassword,
      passwordChangeRequired: false,
    });
    // 更新内存中的缓存密码与标记，使新密码立即生效
    setInitialWebUiPassword(newPassword);
    setWebUiPasswordChangeRequired(false);

    // 注销当前的凭证（此时已确认更新成功）
    if (authorization) {
      const CredentialBase64: string = authorization.split(' ')[1] as string;
      const Credential = JSON.parse(Buffer.from(CredentialBase64, 'base64').toString());
      AuthHelper.revokeCredential(Credential);
    }

    // 重新签发与新密码绑定的凭证，用户无需重新登录
    const signCredential = Buffer.from(
      JSON.stringify(AuthHelper.signCredential(AuthHelper.generatePasswordHash(newPassword)))
    ).toString('base64');
    return sendSuccess(res, {
      Credential: signCredential,
    });
  } catch (e: any) {
    return sendError(res, `Failed to update password: ${e.message}`);
  }
};

// 生成Passkey注册选项
export const GeneratePasskeyRegistrationOptionsHandler: RequestHandler = async (_req, res) => {
  try {
    // 使用固定用户ID，因为WebUI只有一个用户
    const userId = 'napcat-user';
    const userName = 'NapCat User';

    // 从请求头获取host来确定RP_ID
    const host = _req.get('host') || 'localhost';
    const hostname = host.split(':')[0] || 'localhost'; // 移除端口
    // 对于本地开发，使用localhost而不是IP地址
    const rpId = (hostname === '127.0.0.1' || hostname === 'localhost') ? 'localhost' : hostname;

    const options = await PasskeyHelper.generateRegistrationOptions(userId, userName, rpId);
    return sendSuccess(res, options);
  } catch (error) {
    return sendError(res, `Failed to generate registration options: ${(error as Error).message}`);
  }
};

// 验证Passkey注册
export const VerifyPasskeyRegistrationHandler: RequestHandler = async (req, res) => {
  try {
    const { response } = req.body;
    if (!response) {
      return sendError(res, 'Response is required');
    }

    const origin = req.get('origin') || req.protocol + '://' + req.get('host');
    const host = req.get('host') || 'localhost';
    const hostname = host.split(':')[0] || 'localhost'; // 移除端口
    // 对于本地开发，使用localhost而不是IP地址
    const rpId = (hostname === '127.0.0.1' || hostname === 'localhost') ? 'localhost' : hostname;
    const userId = 'napcat-user';
    const verification = await PasskeyHelper.verifyRegistration(userId, response, origin, rpId);

    if (verification.verified) {
      return sendSuccess(res, { verified: true });
    } else {
      return sendError(res, 'Registration failed');
    }
  } catch (error) {
    return sendError(res, `Registration verification failed: ${(error as Error).message}`);
  }
};

// 生成Passkey认证选项
export const GeneratePasskeyAuthenticationOptionsHandler: RequestHandler = async (_req, res) => {
  try {
    const userId = 'napcat-user';

    if (!(await PasskeyHelper.hasPasskeys(userId))) {
      return sendError(res, 'No passkeys registered');
    }

    // 从请求头获取host来确定RP_ID
    const host = _req.get('host') || 'localhost';
    const hostname = host.split(':')[0] || 'localhost'; // 移除端口
    // 对于本地开发，使用localhost而不是IP地址
    const rpId = (hostname === '127.0.0.1' || hostname === 'localhost') ? 'localhost' : hostname;

    const options = await PasskeyHelper.generateAuthenticationOptions(userId, rpId);
    return sendSuccess(res, options);
  } catch (error) {
    return sendError(res, `Failed to generate authentication options: ${(error as Error).message}`);
  }
};

// 验证Passkey认证
export const VerifyPasskeyAuthenticationHandler: RequestHandler = async (req, res) => {
  try {
    const { response } = req.body;
    if (!response) {
      return sendError(res, 'Response is required');
    }

    // 获取WebUI配置用于限速检查
    const WebUiConfigData = await WebUiConfig.GetWebUIConfig();
    // 获取客户端IP
    const clientIP = req.ip || req.socket.remoteAddress || '';

    // 检查登录频率
    if (!WebUiDataRuntime.checkLoginRate(clientIP, WebUiConfigData.loginRate)) {
      return sendError(res, 'login rate limit');
    }

    const origin = req.get('origin') || req.protocol + '://' + req.get('host');
    const host = req.get('host') || 'localhost';
    const hostname = host.split(':')[0] || 'localhost'; // 移除端口
    // 对于本地开发，使用localhost而不是IP地址
    const rpId = (hostname === '127.0.0.1' || hostname === 'localhost') ? 'localhost' : hostname;
    const userId = 'napcat-user';
    const verification = await PasskeyHelper.verifyAuthentication(userId, response, origin, rpId);

    if (verification.verified) {
      // 使用与普通登录相同的凭证签发（与当前密码绑定的 hash）
      const initialPassword = getInitialWebUiPassword();
      if (!initialPassword) {
        return sendError(res, 'Server password not initialized');
      }
      const signCredential = Buffer.from(JSON.stringify(AuthHelper.signCredential(AuthHelper.generatePasswordHash(initialPassword)))).toString('base64');
      return sendSuccess(res, {
        Credential: signCredential,
        passwordChangeRequired: getWebUiPasswordChangeRequired(),
      });
    } else {
      return sendError(res, 'Authentication failed');
    }
  } catch (error) {
    return sendError(res, `Authentication verification failed: ${(error as Error).message}`);
  }
};

// 获取2FA状态
export const Get2FAStatusHandler: RequestHandler = async (_req, res) => {
  try {
    const WebUiConfigData = await WebUiConfig.GetWebUIConfig();
    return sendSuccess(res, {
      enable2FA: WebUiConfigData.enable2FA || false,
      hasSecret: !!WebUiConfigData.totpSecret,
    });
  } catch (error) {
    return sendError(res, `获取2FA状态失败: ${(error as Error).message}`);
  }
};

// 生成2FA密钥
export const Generate2FASecretHandler: RequestHandler = async (_req, res) => {
  try {
    const secret = TotpHelper.generateSecret();
    const qrCodeUrl = TotpHelper.generateQrCodeUrl(secret, 'NapCat WebUI', 'NapCat');

    return sendSuccess(res, {
      secret,
      qrCodeUrl,
    });
  } catch (error) {
    return sendError(res, `Failed to generate 2FA secret: ${(error as Error).message}`);
  }
};

// 启用2FA
export const Enable2FAHandler: RequestHandler = async (req, res) => {
  try {
    const { secret, totpCode } = req.body;

    if (!secret || !totpCode) {
      return sendError(res, 'secret and totpCode are required');
    }

    if (!TotpHelper.verifyTotp(secret, totpCode)) {
      return sendError(res, 'Invalid code');
    }

    await WebUiConfig.UpdateWebUIConfig({
      enable2FA: true,
      totpSecret: secret,
    });

    return sendSuccess(res, { message: '2FA enabled' });
  } catch (error) {
    return sendError(res, `Failed to enable 2FA: ${(error as Error).message}`);
  }
};

// 禁用2FA - 需要验证当前TOTP代码
export const Disable2FAHandler: RequestHandler = async (req, res) => {
  try {
    const { totpCode } = req.body;

    if (!totpCode) {
      return sendError(res, 'totpCode is required to disable 2FA');
    }

    const WebUiConfigData = await WebUiConfig.GetWebUIConfig();
    if (!WebUiConfigData.totpSecret) {
      return sendError(res, '2FA is not enabled');
    }

    // 验证当前TOTP代码
    if (!TotpHelper.verifyTotp(WebUiConfigData.totpSecret, totpCode)) {
      return sendError(res, 'Invalid code');
    }

    await WebUiConfig.UpdateWebUIConfig({
      enable2FA: false,
      totpSecret: '',
    });

    return sendSuccess(res, { message: '2FA disabled' });
  } catch (error) {
    return sendError(res, `Failed to disable 2FA: ${(error as Error).message}`);
  }
};
