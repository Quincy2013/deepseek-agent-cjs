'use strict';

const { chromium } = require('playwright');
const { cleanForStreaming } = require('../parser');
const { filterHtml } = require('../html-filter');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BrowserController {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.context = null;
    this.page = null;
    this._aborted = false;
    this._hadSafetyTag = false;
  }

  abort() { this._aborted = true; }
  resetAbort() { this._aborted = false;
    this._hadSafetyTag = false; }
  isAborted() { return this._aborted; }

  async start() {
    this.logger.info('启动持久化浏览器...');
    const launchOptions = {
      headless: false,
      userAgent: this.config.user_agent,
      viewport: null,
      args: ['--start-maximized'],
    };
    if (this.config.chromium_executable_path) {
      launchOptions.executablePath = this.config.chromium_executable_path;
      this.logger.info('使用自定义 Chromium:', this.config.chromium_executable_path);
    }
    this.context = await chromium.launchPersistentContext(
      this.config.user_data_dir,
      launchOptions
    );
    this.page = this.context.pages()[0] || (await this.context.newPage());
    await this.page.goto(this.config.chat_url, { waitUntil: 'domcontentloaded' });
    this.context.on('page', (p) => this._handleNewPage(p));

    // 监听所有网络请求以捕获文件上传接口
    this.page.on('request', request => {
      const url = request.url();
      const method = request.method();

      // 过滤文件上传请求（通常包含 'file'、'upload' 等关键词）
      if (method === 'POST' && (url.includes('/file') || url.includes('/upload'))) {
        this.logger.info(`[文件上传接口] ${method} ${url}`);
        this.logger.info(`[请求头] ${JSON.stringify(request.headers())}`);
        // 如果是 multipart/form-data，记录内容类型
        if (request.headers()['content-type']?.includes('multipart/form-data')) {
          this.logger.info(`[上传负载] 包含文件数据`);
        }
      }
    });

    this.logger.info('浏览器已启动');
  }

  async _handleNewPage(newPage) {
    this.logger.info('检测到新标签页，切换焦点');
    this.page = newPage;
  }

  async close() {
    if (this.context) {
      try { await this.context.close(); } catch {}
    }
  }

  async waitForLogin() {
    const timeout = this.config.timeouts.login;
    this.logger.info('等待输入框（登录状态）...');
    try {
      await this.page.waitForSelector(this.config.selectors.message_input, { timeout });
      this.logger.info('检测到输入框，已登录');
      return true;
    } catch (e) {
      this.logger.error('登录超时');
      return false;
    }
  }

  // ---------- 读取元素文本（HTML 过滤后返回纯文本）----------
  async _getText(el) {
    try {
      const html = await el.evaluate((node) => node.innerHTML || '');
      const result = filterHtml(html);
      if (result && result.hadSafetyTag) this._hadSafetyTag = true;
      return result && result.text !== undefined ? result.text : String(result || '');
    } catch {
      return '';
    }
  }

  // ---------- 安全标记消费 ----------
  consumeSafetyFlag() {
    const v = this._hadSafetyTag;
    this._hadSafetyTag = false;
    return v;
  }

  // ---------- 读取最后一条 AI 回复 ----------
  async getLastResponseText() {
    const responses = await this.page.$$(this.config.selectors.ai_response);
    if (!responses.length) return null;

    // ★ 虚拟列表校验：只取"可见且在 DOM 中"的最后一个
    // 不可见的元素（被回收）innerText 为空或异常
    for (let i = responses.length - 1; i >= Math.max(0, responses.length - 3); i--) {
      const el = responses[i];
      try {
        const visible = await el.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 &&
                 style.display !== 'none' && style.visibility !== 'hidden';
        });
        if (!visible) continue;
        const text = await this._getText(el);
        if (text && text.trim().length > 0) {
          return text;
        }
      } catch {}
    }

    // 全都拿不到，返回 null
    return null;
  }

  // ---------- 是否在生成 ----------
  async _isGenerating() {
    const stopSel = this.config.selectors.stop_button;
    if (!stopSel) return false;
    try {
      const el = await this.page.$(stopSel);
      return !!el;
    } catch {
      return false;
    }
  }

  // ---------- 发送消息（含真实发送验证）----------
  async sendMessage(message, retry = 3) {
    const beforeText = await this.getLastResponseText();

    for (let attempt = 0; attempt < retry; attempt++) {
      try {
        const inputBox = await this.page.waitForSelector(
          this.config.selectors.message_input,
          { timeout: 5000 }
        );
        await inputBox.fill('');
        await inputBox.fill(message);

        const filledValue = await inputBox.inputValue();
        if (!filledValue || filledValue.length < message.length * 0.8) {
          throw new Error(`fill 失败: 输入框只有 ${filledValue?.length || 0} 字符`);
        }

        const sendSel = this.config.selectors.send_button;
        const sendBtn = await this.page.waitForSelector(sendSel, { timeout: 8000 });

        try {
          await this.page.waitForFunction(
            (sel) => {
              const el = document.querySelector(sel);
              return el && !el.classList.contains('ds-button--disabled');
            },
            sendSel,
            { timeout: 5000 }
          );
        } catch {}

        await sleep(200);
        await sendBtn.click();

        try {
          await this.page.waitForFunction(
            (sel) => {
              const el = document.querySelector(sel);
              return el && el.value === '';
            },
            this.config.selectors.message_input,
            { timeout: 5000 }
          );
        } catch {}

        // 真实发送验证
        const startWait = Date.now();
        const maxWait = 10000;
        let confirmed = false;

        while (Date.now() - startWait < maxWait) {
          if (await this._isGenerating()) {
            confirmed = true;
            break;
          }
          const currentText = await this.getLastResponseText();
          if (currentText && currentText !== beforeText) {
            confirmed = true;
            break;
          }
          await sleep(200);
        }

        if (confirmed) {
          this.logger.info('消息已发送并确认:', message.slice(0, 50));
          return true;
        }

        this.logger.warn(`发送后 10 秒内未检测到 AI 响应（第 ${attempt + 1} 次）`);
      } catch (e) {
        this.logger.warn(`发送失败 (第 ${attempt + 1} 次):`, e.message);
      }

      if (attempt < retry - 1) {
        try {
          await this.page.reload({ waitUntil: 'domcontentloaded' });
        } catch {}
        await sleep(2000);
      }
    }

    this.logger.error('发送消息最终失败');
    return false;
  }

  // ---------- 等待新回复 ----------
  async waitForNewResponse(previousText) {
    const timeoutMs = this.config.timeouts.ai_response;
    const stopSelectors = [
      this.config.selectors.stop_button,
      ...(this.config.stop_button_fallbacks || []),
    ].filter(Boolean);

    this.logger.info('waitForNewResponse 开始, previousText 长度 =', previousText ? previousText.length : 0);

    const start = Date.now();
    let lastPrinted = '';
    let pollCount = 0;
    let seenNew = false;
    let stableText = '';
    let stableSince = 0;

    // ★ B16 修复：稳定判定从 800ms 提升到 1500ms
    const STREAM_STABLE_MS = 1500;
    // ★ B16 修复：单次等待最长 5 分钟
    const MAX_STREAM_WAIT_MS = 300000;
    // ★ B17 修复：30 秒未检测到新回复直接返回 null
    const NO_NEW_REPLY_TIMEOUT_MS = 30000;
    // ★ B16 修复：绝对时间上限
    const hardDeadline = start + MAX_STREAM_WAIT_MS;

    while (Date.now() - start < timeoutMs && Date.now() < hardDeadline) {
      if (this._aborted) {
        if (process.stdout.isTTY) process.stdout.write('\n');
        this.logger.warn('waitForNewResponse 被中断');
        return null;
      }

      pollCount++;

      // 生成中：停止按钮存在 → 继续等
      const generating = await this._isGenerating();

      const responses = await this.page.$$(this.config.selectors.ai_response);
      if (!responses.length) {
        if (pollCount % 10 === 1) {
          this.logger.info(`轮询 ${pollCount}: 页面上还没有 AI 回复`);
        }
        await sleep(300);
        continue;
      }

      const last = responses[responses.length - 1];
      const text = await this._getText(last);

      if (!text) {
        await sleep(300);
        continue;
      }

      // 判断是否新回复
      let isNew = previousText === null || text !== previousText;

      // ★ B17 修复：30 秒没检测到新回复 → 返回 null（不返回旧文本）
      if (!isNew && Date.now() - start > NO_NEW_REPLY_TIMEOUT_MS) {
        try {
          const inputVal = await this.page.$eval(
            this.config.selectors.message_input,
            (el) => el.value
          );
          if (inputVal === '') {
            this.logger.warn('30 秒未检测到新回复，返回 null（防止重复执行）');
            if (process.stdout.isTTY) process.stdout.write('\n');
            return null;
          }
        } catch {}
      }

      if (!isNew) {
        if (pollCount % 10 === 1) {
          this.logger.info(`轮询 ${pollCount}: 最后一条回复未变，长度 = ${text.length}`);
        }
        await sleep(300);
        continue;
      }

      if (!seenNew) {
        seenNew = true;
        this.logger.info(`轮询 ${pollCount}: 检测到新回复，初始长度 = ${text.length}`);

        for (const sel of stopSelectors) {
          try {
            await this.page.waitForSelector(sel, {
              state: 'detached',
              timeout: Math.min(timeoutMs, 10000),
            });
            break;
          } catch {}
        }
      }

      // 流式打印
      if (process.stdout.isTTY) {
        try {
          const cleaned = cleanForStreaming(text, this.config);
          if (cleaned.length > lastPrinted.length) {
            process.stdout.write(cleaned.slice(lastPrinted.length));
            lastPrinted = cleaned;
          }
        } catch {}
      }

      // ★ B16 修复：稳定判定
      // - 文本变了 → 重置 stableSince
      // - 文本没变 + 停止按钮不存在 → 累计稳定时长
      // - 稳定超过 STREAM_STABLE_MS 才返回
      if (stableText && text === stableText) {
        if (!stableSince) stableSince = Date.now();

        const stableFor = Date.now() - stableSince;
        const buttonGone = !generating;

        if (stableFor >= STREAM_STABLE_MS && buttonGone) {
          if (process.stdout.isTTY) {
            try {
              const lastNl = text.lastIndexOf('\n');
              const pending = lastNl === -1 ? text : text.slice(lastNl + 1);
              if (pending.trim() && !lastPrinted.endsWith(pending)) {
                process.stdout.write(pending);
              }
            } catch {}
            process.stdout.write('\n');
          }
          this.logger.info(`文本稳定 (${stableFor}ms)，返回长度:`, text.length);
          return text;
        }

        if (pollCount % 5 === 1) {
          this.logger.info(
            `轮询 ${pollCount}: 文本未变 (stable ${stableFor}ms, generating=${generating})`
          );
        }
      } else {
        stableText = text;
        stableSince = 0;
      }

      await sleep(300);
    }

    // 超时兜底：如果从未见到新回复，返回 null
    if (!seenNew) {
      this.logger.warn('等待 AI 回复超时（从未见到新回复），返回 null');
      return null;
    }

    this.logger.warn('等待 AI 回复超时，已轮询', pollCount, '次，返回最后一条');
    const responses = await this.page.$$(this.config.selectors.ai_response);
    if (responses.length) {
      const text = await this._getText(responses[responses.length - 1]);
      if (process.stdout.isTTY) process.stdout.write('\n');
      this.logger.info('超时后返回最后一条，长度:', text.length);
      return text;
    }
    return null;
  }

  // ---------- 上传文件 ----------
  async uploadFiles(filePaths) {
    const sel = this.config.selectors.file_input;
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    if (!paths.length) return { success: false, error: 'no files' };

    try {
      const input = await this.page.waitForSelector(sel, { state: 'attached', timeout: 5000 });
      await input.setInputFiles(paths);

      // 关键：等待上传预览出现（确认上传完成）
      // 根据快照，上传后输入框附近会出现缩略图或文件名标签
      const previewSelector = '.file-preview, .attachment-item, [class*="upload"]';
      try {
        await this.page.waitForSelector(previewSelector, { timeout: 15000 });
        this.logger.info(`✅ 文件上传预览已出现: ${paths.length} 个文件`);
      } catch {
        this.logger.warn('⚠️ 未检测到上传预览，但文件可能已注入');
      }

      // 可选：提取 file_id（如果页面暴露了）
      const fileIds = await this.page.evaluate(() => {
        const ids = [];
        document.querySelectorAll('[data-file-id]').forEach(el => {
          const id = el.getAttribute('data-file-id');
          if (id) ids.push(id);
        });
        return ids;
      });
      if (fileIds.length) this.logger.info(`提取到 file_id: ${fileIds.join(', ')}`);

      return { success: true, fileIds, previewShown: true };
    } catch (e) {
      this.logger.error('上传失败:', e.message);
      return { success: false, error: e.message };
    }
  }

  async uploadFile(filePath) {
    return this.uploadFiles([filePath]);
  }

  // ---------- 获取原始 Markdown ----------
  async getRawMarkdown() {
    const responses = await this.page.$$(this.config.selectors.ai_response);
    if (!responses.length) return null;
    const lastResponse = responses[responses.length - 1];

    return await lastResponse.evaluate(el => {
      // 尝试从 React fiber 节点中提取原始 markdown 内容
      // 参考 deepseek-web-bridge 的实现思路
      const fiberKey = Object.keys(el).find(key =>
        key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
      );
      if (fiberKey) {
        let fiber = el[fiberKey];
        // 向上查找，找到包含 markdown 属性的节点
        while (fiber) {
          if (fiber.memoizedProps && fiber.memoizedProps.markdown) {
            return fiber.memoizedProps.markdown;
          }
          fiber = fiber.return;
        }
      }
      // 降级方案：返回 innerText
      return el.innerText;
    });
  }
}

module.exports = { BrowserController, sleep };
