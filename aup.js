/**
 * app-updater.js - 应用版本更新检测与美化提示模块
 */
(function(window) {
  'use strict';

  // 1. 默认更新配置项（可自由修改或在外部覆盖）
  const UpdaterConfig = {
    checkUrl: 'https://jatosi.github.io/version.json',            // 更新检查接口地址 (如 'https://example.com/api/version.json')
    currentVersion: '1.1.0', // 当前应用版本号
    autoCheck: true,         // 是否在 DOMReady 后自动检测更新
    i18n: {                  // 文本配置
      title: '发现新版本',
      versionBadge: 'v{v}',
      updateBtn: '立即更新',
      cancelBtn: '稍后再说',
      closeTitle: '关闭提示'
    }
  };

  let fetchedUpdateData = null; // 缓存拉取的更新数据
  let isUserClosed = false;     // 标记用户是否主动关闭过提示框
  let resizeTimer = null;       // resize 防抖定时器

  /**
   * 辅助工具：版本号对比 (Remote > Current 返回 true)
   */
  function isNewerVersion(remote, current) {
    const a = String(remote).split('.').map(n => parseInt(n, 10) || 0);
    const b = String(current).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  /**
   * 辅助工具：设备检测
   */
  function detectDevice() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobileByUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    const isMobileByScreen = window.innerWidth <= 768;
    
    const isMobile = isMobileByUA || isMobileByScreen;
    return { isMobile, deviceType: isMobile ? 'mobile' : 'desktop' };
  }

  /**
   * 动态注入更新弹窗专属 CSS 样式
   */
  function injectStyles() {
    if (document.getElementById('app-updater-styles')) return;
    const style = document.createElement('style');
    style.id = 'app-updater-styles';
    style.textContent = `
      /* 遮罩背景 */
      .app-updater-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        opacity: 0;
        transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        padding: 20px;
        box-sizing: border-box;
      }
      .app-updater-backdrop.show {
        opacity: 1;
      }

      /* 弹窗主容器 */
      .app-updater-card {
        position: relative;
        background: linear-gradient(145deg, #1e2238, #141727);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 20px;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(99, 102, 241, 0.2);
        width: 100%;
        max-width: 400px;
        padding: 28px 24px 20px;
        box-sizing: border-box;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        transform: scale(0.85);
        transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .app-updater-backdrop.show .app-updater-card {
        transform: scale(1);
      }

      /* 顶部图标徽章 */
      .app-updater-icon {
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        border-radius: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 16px;
        box-shadow: 0 10px 20px rgba(99, 102, 241, 0.4);
      }
      .app-updater-icon svg {
        width: 32px;
        height: 32px;
        fill: #ffffff;
      }

      /* 标题与版本号 */
      .app-updater-title {
        font-size: 20px;
        font-weight: 700;
        margin: 0 0 8px 0;
        color: #ffffff;
        letter-spacing: 0.5px;
      }
      .app-updater-badge {
        display: inline-block;
        background: rgba(99, 102, 241, 0.15);
        border: 1px solid rgba(99, 102, 241, 0.3);
        color: #818cf8;
        font-size: 13px;
        font-weight: 600;
        padding: 3px 12px;
        border-radius: 999px;
        margin-bottom: 16px;
      }

      /* 更新日志文本区 */
      .app-updater-changelog {
        font-size: 14px;
        line-height: 1.6;
        color: rgba(255, 255, 255, 0.75);
        background: rgba(0, 0, 0, 0.2);
        border-radius: 12px;
        padding: 12px 16px;
        width: 100%;
        margin-bottom: 24px;
        max-height: 120px;
        overflow-y: auto;
        text-align: left;
        box-sizing: border-box;
      }

      /* 操作按钮组 */
      .app-updater-actions {
        display: flex;
        gap: 12px;
        width: 100%;
      }
      .app-updater-btn {
        flex: 1;
        padding: 12px 16px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .app-updater-btn-primary {
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
      }
      .app-updater-btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 18px rgba(99, 102, 241, 0.5);
      }
      .app-updater-btn-ghost {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .app-updater-btn-ghost:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
      }

      /* 右上角叉号关闭按钮 */
      .app-updater-close {
        position: absolute;
        top: 14px;
        right: 14px;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.2s;
      }
      .app-updater-close:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #ffffff;
      }

      .is-hidden {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 渲染/重绘美化后的更新提示弹窗
   */
  function renderUpdateBanner(data) {
    if (isUserClosed) return;

    injectStyles();

    let backdrop = document.getElementById('app-updater-backdrop');

    // 结构不存在时，动态创建
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'app-updater-backdrop';
      backdrop.className = 'app-updater-backdrop';

      const card = document.createElement('div');
      card.className = 'app-updater-card';

      // 右上角 X
      const closeX = document.createElement('div');
      closeX.className = 'app-updater-close';
      closeX.innerHTML = '&#10005;';
      closeX.title = UpdaterConfig.i18n.closeTitle;

      // 顶部 Rocket 图标
      const icon = document.createElement('div');
      icon.className = 'app-updater-icon';
      icon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M13.13 2.21a1 1 0 0 0-1.26 0l-4.3 3.44a1 1 0 0 0-.37.78V10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.43a1 1 0 0 0-.37-.78l-4.3-3.44zm6.66 10.66a1 1 0 0 0-1.21-.21L16 14.17V11a1 1 0 0 0-2 0v5a1 1 0 0 0 1 1h4a1 1 0 0 0 .79-1.61l-1-1.33zm-15.58-.21a1 1 0 0 0-1.21.21l-1 1.33A1 1 0 0 0 3 17h4a1 1 0 0 0 1-1v-5a1 1 0 0 0-2 0v3.17l-2.58-1.51zM12 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 8c-2.67 0-8 1.34-8 4v1h16v-1c0-2.66-5.33-4-8-4z"/></svg>`;

      // 标题
      const title = document.createElement('h3');
      title.className = 'app-updater-title';
      title.textContent = UpdaterConfig.i18n.title;

      // 版本号 Badge
      const badge = document.createElement('div');
      badge.className = 'app-updater-badge';
      badge.textContent = UpdaterConfig.i18n.versionBadge.replace('{v}', data.latestVersion || '');

      // 内容日志 (可选)
      const changelog = document.createElement('div');
      changelog.className = 'app-updater-changelog';
      changelog.textContent = data.changelog || '检测到新版本可用，建议立即更新以体验最新功能。';

      // 底部按钮组
      const actions = document.createElement('div');
      actions.className = 'app-updater-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'app-updater-btn app-updater-btn-ghost';
      cancelBtn.textContent = UpdaterConfig.i18n.cancelBtn;

      const updateBtn = document.createElement('button');
      updateBtn.className = 'app-updater-btn app-updater-btn-primary';
      updateBtn.textContent = UpdaterConfig.i18n.updateBtn;

      // 关闭逻辑
      const closeDialog = () => {
        isUserClosed = true;
        backdrop.classList.remove('show');
        setTimeout(() => backdrop.remove(), 300);
      };

      closeX.addEventListener('click', closeDialog);
      cancelBtn.addEventListener('click', closeDialog);

      // 跳转更新逻辑
      updateBtn.addEventListener('click', () => {
        if (data.apkUrl || data.updateUrl) {
          window.open(data.apkUrl || data.updateUrl, '_blank');
        }
      });

      actions.appendChild(cancelBtn);
      actions.appendChild(updateBtn);

      card.appendChild(closeX);
      card.appendChild(icon);
      card.appendChild(title);
      card.appendChild(badge);
      card.appendChild(changelog);
      card.appendChild(actions);

      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      // 显示进场动画
      requestAnimationFrame(() => {
        backdrop.classList.add('show');
      });
    }

    // 根据设备检测显示控制
    const { isMobile } = detectDevice();
    if (isMobile && !isUserClosed) {
      backdrop.classList.remove('is-hidden');
    } else {
      backdrop.classList.add('is-hidden');
    }
  }

  /**
   * 检查网络更新入口
   */
  async function checkForUpdate() {
    const url = UpdaterConfig.checkUrl;
    if (!url || url.indexOf('YOUR_') === 0) return;

    if (!fetchedUpdateData) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        
        if (data && data.latestVersion && isNewerVersion(data.latestVersion, UpdaterConfig.currentVersion)) {
          fetchedUpdateData = data;
        }
      } catch (e) {
        console.warn('App check update failed:', e);
        return;
      }
    }

    if (fetchedUpdateData) {
      renderUpdateBanner(fetchedUpdateData);
    }
  }

  // 监听窗口缩放改变（防抖）
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (fetchedUpdateData && !isUserClosed) {
        renderUpdateBanner(fetchedUpdateData);
      }
    }, 200);
  });

  // DOM 载入就绪后自动启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (UpdaterConfig.autoCheck) checkForUpdate();
    });
  } else {
    if (UpdaterConfig.autoCheck) checkForUpdate();
  }

  // 暴露 API 给全局调用
  window.AppUpdater = {
    config: UpdaterConfig,
    check: checkForUpdate,
    // 允许初始化参数配置
    init: function(options) {
      Object.assign(UpdaterConfig, options || {});
      if (UpdaterConfig.autoCheck) checkForUpdate();
    }
  };

})(window);