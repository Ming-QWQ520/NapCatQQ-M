import axios from 'axios';

import key from '@/const/key';

export const serverRequest = axios.create({
  timeout: 30000, // 30秒，获取版本列表可能较慢
});

export const request = axios.create({
  timeout: 10000,
});

export const requestServerWithFetch = async (
  url: string,
  options: RequestInit
) => {
  const token = localStorage.getItem(key.token);

  if (token) {
    options.headers = {
      ...options.headers,
      Authorization: `Bearer ${JSON.parse(token)}`,
    };
  }

  const baseURL = '/api';

  const response = await fetch(baseURL + url, options);

  return response;
};

serverRequest.interceptors.request.use((config) => {
  const baseURL = '/api';

  config.baseURL = baseURL;

  const token = localStorage.getItem(key.token);

  if (token) {
    config.headers['Authorization'] = `Bearer ${JSON.parse(token)}`;
  }

  return config;
});

serverRequest.interceptors.response.use((response) => {
  // 如果是流式传输的文件
  if (response.headers['content-type'] === 'application/octet-stream') {
    return response;
  }
  if (response.data.code !== 0) {
    if (response.data.message === 'Unauthorized') {
      const token = localStorage.getItem(key.token);
      if (token && JSON.parse(token)) {
        localStorage.removeItem(key.token);
        window.location.reload();
      }
    }
    // 首次登录未完成改密：跳转到强制改密页（保留登录凭证，改完即恢复）
    if (response.data.message === 'password_change_required') {
      const mountIndex = window.location.pathname.indexOf('/webui/');
      const mountBase = mountIndex >= 0 ? window.location.pathname.slice(0, mountIndex + '/webui'.length) : '';
      const target = `${mountBase}/web_change_password`;
      if (!window.location.pathname.startsWith(`${mountBase}/web_change_password`)) {
        window.location.href = target;
      }
      throw new Error('登录后需先修改密码');
    }
    throw new Error(response.data.message);
  }

  return response;
});
