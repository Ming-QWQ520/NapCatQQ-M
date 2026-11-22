enum key {
  // NapCat-M Stack 统一网关会把本 WebUI 与 AstrBot 仪表盘挂到同一端口
  // （同一浏览器源）下。通用键名 "token" 会与 AstrBot 前端的 JWT 存储
  // 键冲突，互相覆盖、导致两边反复要求重新登录，因此改用带命名空间的
  // 键彻底隔离。独立部署不受影响：NapCat 凭证本就一小时过期，升级后
  // 最多重新登录一次。
  token = 'napcat-token',
  theme = 'theme',
  backgroundImage = 'background-image',
  musicID = 'music-id',
  showMusicTip = 'show-music-tip',
  autoPlay = 'auto-play',
  customIcons = 'custom-icons',
  isCollapsedMusicPlayer = 'is-collapsed-music-player',
  sideBarOpen = 'side-bar-open',
  httpDebugConfig = 'http-debug-config',
  wsDebugConfig = 'ws-debug-config',
}

export default key;
