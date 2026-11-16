'use strict';

const { loadConfig } = require('./src/config');
const { setupLogger, getLogger, setEnabled } = require('./src/logger');
const { BrowserController, sleep } = require('./src/browser/browser-controller');
const { ToolExecutor, question, closeReadline } = require('./src/executor/tool-executor');
const { SessionManager } = require('./src/session/session-manager');
const { parseToolCalls, cleanUiNoise } = require('./src/parser');
const { runTraining } = require('./src/trainer');
const { fork } = require('child_process');

const INITIAL_PROMPT = [
  '你好！用户为你接入了可以在电脑本地运行的程序代理，接下来你可以在电脑本地执行操作。',
  '',
  '你拥有调用本地工具的能力。当你需要执行具体操作时，请严格使用以下格式输出工具调用指令：',
  '',
  '格式 1（单工具）：',
  '  工具名:参数',
  '',
  '格式 2（多工具）：每行一个',
  '  工具名:参数',
  '  工具名:参数',
  '',
  '格式 3（多行内容）：',
  '```tool',
  '工具名:参数',
  '```',
  '',
  '=== 工具清单 ===',
  '',
  '【文件操作】',
  'read_files:<路径1>|||<路径2>|||...        读多个文件。图片或 >64KB 文本自动上传 DeepSeek（≤50MB）。',
  'read_file:<路径>                          读单个文本文件。',
  'write_file:<路径>|||<内容>                写单文件，自动创建父目录。',
  'write_files:[{"path":"...","content":"..."},...]  批量写文件（JSON 数组）。',
  'write_files:<路径1>|||<内容1>@@@<路径2>|||<内容2>   批量写文件（分隔符格式）。',
  'edit_file:<路径>|||<旧串>|||<新串>        精确替换文件中唯一的字符串。',
  'create_dir:<路径>                         递归创建目录。',
  'file_exists:<路径>                        判断文件/目录是否存在。',
  'file_tree:<目录>|||<深度>                 显示目录树（默认深度 3）。',
  'list_dir:<目录>                           列出目录内容。',
  'copy_file:<源>|||<目标>                   复制文件/目录。',
  'move_file:<源>|||<目标>                   移动文件/目录。',
  'delete_file:<路径>                        删除文件/目录（高风险）。',
  'search_files:<目录>|||<关键词>|||<模式>   按文件名/内容搜索（模式 name|content）。',
  'get_file_info:<路径>                      文件元信息。',
  'glob:<目录>|||<pattern>                   按 glob 查找（如 .|||**/*.js）。',
  'grep:<目录>|||<正则>|||<file_glob>|||<case>  按内容搜索。',
  '',
  '【Shell / Python】',
  'shell:<命令>                              执行 shell 命令。',
  'python:<代码>                             执行 Python 代码（10 秒超时）。',
  '',
  '【文档】',
  'read_excel:<路径>                         读取 Excel（xlsx）。',
  'write_excel:<路径>|||<JSON 行数组>        写入 Excel。',
  'read_pdf:<路径>                           读取 PDF 文本。',
  'read_docx:<路径>                          读取 Word（docx）。',
  'read_pptx:<路径>                          读取 PowerPoint（pptx）。',
  '',
  '【系统信息】',
  'sys_info                                  系统信息。',
  'cpu_usage                                 CPU 使用率。',
  'mem_usage                                 内存使用。',
  'list_processes:<过滤词>                   列出进程。',
  'kill_process:<PID 或进程名>               结束进程（高风险）。',
  'disk_info                                 磁盘使用。',
  'list_installed_programs                   已安装程序列表（Windows）。',
  'get_env:<变量名>                          获取环境变量。',
  'which:<命令>                              查找命令路径。',
  '',
  '【系统操作】',
  'open_file:<路径>                          用默认程序打开。',
  'set_wallpaper:<路径>                      设置壁纸（高风险）。',
  'sleep:<秒数>                              暂停（≤300 秒）。',
  'screenshot:<输出路径>                     截屏保存。',
  'notify:<标题>|||<消息>                    桌面通知。',
  'list_windows:<过滤词>                     列出可见窗口（Windows）。',
  '',
  '【剪贴板】',
  'clipboard_copy:<文本>                     复制到剪贴板。',
  'clipboard_paste                           读取剪贴板。',
  '',
  '【网络】',
  'fetch:<URL>                               抓网页转 Markdown（推荐）。',
  'web_search:<关键词>                       DuckDuckGo 搜索。',
  'http_get:<URL>                            HTTP GET。',
  'http_post:<URL>|||<JSON>                  HTTP POST。',
  'download_file:<URL>|||<保存路径>          下载文件。',
  'ping_host:<主机>                          Ping。',
  'netstat:<过滤词>                          网络连接列表。',
  'get_public_ip                             公网 IP。',
  '',
  '【编码 / 时间】',
  'base64_encode:<文本> / base64_decode:<文本>',
  'url_encode:<文本> / url_decode:<文本>',
  'hash:<算法>|||<文本>                      如 sha256|||hello。',
  'uuid                                      生成 UUID v4。',
  'current_time                              当前时间。',
  'timestamp_convert:<时间戳或日期>          时间转换。',
  '',
  '【图片】',
  'image_info:<路径>                         图片尺寸和格式。',
  'qrcode_generate:<文本>|||<输出路径>       生成二维码。',
  'upload_image:<路径>                       上传单个文件到 DeepSeek。',
  '',
  '【压缩 / 数据库】',
  'zip_files:<输出>|||<路径1;路径2>          压缩为 zip。',
  'unzip_file:<压缩包>|||<解压目录>          解压 zip。',
  'sqlite_query:<db 路径>|||<SQL>            执行 SQLite 查询。',
  '',
  '【Agent 增强】',
  'ask_ai:<任务>                             调用独立子 AI 服务完成子任务。',
  'ask_ai:<系统提示>|||<任务>                带角色的调用。',
  'ask_ai:{"task":"...","system":"...","session":"s1","model":"...","reset":true}  完整 JSON。',
  'ask_ai:{"task":"...","include_reasoning":true}  拿到子 AI 思考过程（额外消耗 token，默认关闭）。',
  'ai_sessions                               列出子 AI 的所有会话。',
  'ai_session_reset:<会话 id>                重置指定子 AI 会话。',
  'ai_service_status                         查询子 AI 服务健康状态。',
  'batch:<JSON 数组>                         并行调用多个工具。',
  'memory_save:<key>|||<value>               保存跨会话记忆。',
  'memory_load:<key>                         读取记忆。',
  'memory_list                               列出所有记忆。',
  'memory_delete:<key>                       删除记忆。',
  'todo_write:<JSON 数组>                    写入任务清单。',
  'todo_read                                 读取任务清单。',
  'todo_update:<id>|||<状态>                 更新任务状态（pending|in_progress|done）。',
  'todo_clear                                清空任务清单。',
  'export_session:<md|pdf>                   导出会话。',
  '',
  '=== 多行内容（重要）===',
  '',
  '如果你的工具参数含换行（如写 Python 代码、写多行文件），必须用以下两种格式之一：',
  '',
  '格式 A（推荐）：代码块',
  '`	ool',
  'write_file:D:\\a.py|||',
  'def foo():',
  '    return 1',
  '`',
  '',
  '格式 B：显式边界标记',
  '<|tool_call|>',
  'python:',
  'import os',
  'print(os.getcwd())',
  '<|/tool_call|>',
  '',
  '★ 禁止在行首直接写 write_file:path|||多行内容（会被拆成多个调用）。',
  '',
  '=== Windows 环境约定 ===',
  '',
  '- 环境变量设置：set "VAR=value"（引号包住整个赋值，避免尾随空格）',
  '- 含空格路径：用双引号包裹，如 robocopy "D:\\a b" "D:\\c" /E',
  '- shell 工具会自动用 cmd /c 包装，命令里不要重复写 cmd /c',
  '- 后台程序启动：用 shell_detached:命令，会立即返回 PID，不等待、不杀进程',
  '',
  '=== 规则 ===',
  '1. **工具调用必须独占一行**，不要和叙述文字混在一起。',
  '2. **自定义超时**：默认超时 shell=60s、python=30s、http=15s。',
  '   如果命令是 build、安装、下载大文件等已知耗时长的操作，可以在工具名后加 @<秒数>：',
  '',
  '     正确：shell@600:npm run build',
  '     正确：shell@1800:pip install torch',
  '     正确：python@300:import time; time.sleep(200)',
  '     正确：download_file@600:https://example.com/big.zip|||C:\\big.zip',
  '',
  '   上限 3600 秒（1 小时）。普通命令不要加 @，默认值足够。',
  '',
  '   适用场景：',
  '     - 编译 / 构建（npm run build、cargo build、gcc 大项目）',
  '     - 安装依赖（pip install、npm install、pacman -S 大包）',
  '     - 下载大文件、模型、镜像',
  '     - 解压大文件（tar -xf 2GB+ 的 iso）',
  '',
  '   不适用：',
  '     - 普通文件读写（read_file、write_file）',
  '     - 查询类命令（dir、ls、find、grep）',
  '     - 短脚本执行',
  '',
  '3. **不要加"工具名:"前缀**。直接写 `工具名:参数`。',
  '4. **不要用 <tool_call>、<tool_name>、<command> 等 XML 标签**。',
  '5. **shell 工具直接给命令，不要包 cmd /c**。',
  '6. 多行内容（Python 脚本、文件内容）用代码块格式（```tool ... ```）。',
  '7. Windows 路径中包含点号的目录要写完整。',
  '8. 路径含空格用双引号包裹。',
  '9. glob 的 pattern 不要带前导斜杠。',
  '10. 一次可以调用多个工具，每行一个。',
  '11. 工具结果会由系统自动返回。',
  '12. 循环执行直到完成用户任务，无工具调用时给出最终回答。',
  '13. 同一个工具连续失败 3 次就停下，告诉用户当前无法完成。',
  '14. 不要模拟或猜测工具输出，必须等真实结果。',
  '15. 高风险工具需要用户确认。',
  '16. 看图片或大文件用 read_files，会自动上传。',
  '17. 改文件优先用 edit_file。',
  '18. 找文件用 glob，找内容用 grep。',
  '19. 多个独立操作可以 batch 并行。',
  '20. 工具报"not registered"时，根据错误里的可用工具列表换一个。',
  '21. 用户需求模糊时，先执行能做的部分，再问细节。',
  '22. 一次最多调用 5 个工具，超过就分批。',
].join('\n');

function parseArgs(argv) {
  const args = {
    config: 'config.yaml',
    auto: false,
    web: false,
    noPrompt: false,
    forcePrompt: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') args.config = argv[++i];
    else if (a === '--auto') args.auto = true;
    else if (a === '--web') args.web = true;
    else if (a === '--no-prompt') args.noPrompt = true;
    else if (a === '--force-prompt') args.forcePrompt = true;
    else if (a === '--no-write-confirm') args.noWriteConfirm = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  let config, logger;

  try {
    config = loadConfig(args.config);
    logger = setupLogger(config.log_file);
  } catch (e) {
    process.stderr.write(`启动失败: ${e.message}\n`);
    process.exit(1);
  }

  logger.info('========= DeepSeek Agent CJS 启动 =========');
  logger.info('config file:', args.config);
  logger.info('auto mode:', args.auto);
  logger.info('user_data_dir:', config.user_data_dir);
  if (config.chromium_executable_path) {
    logger.info('chromium:', config.chromium_executable_path);
  }

  // ---------- Ctrl+C ----------
  let interruptCount = 0;
  let browserRef = null;
  process.on('SIGINT', () => {
    interruptCount++;
    if (interruptCount === 1 && browserRef) {
      process.stdout.write(
        '\n\x1b[33m[中断] 已取消当前等待，再按一次 Ctrl+C 退出\x1b[0m\n'
      );
      browserRef.abort();
    } else {
      process.stdout.write('\n');
      closeReadline();
      process.exit(0);
    }
  });

  // ---------- 审批模式 ----------
  let approvalRequired = true;
  if (args.auto) {
    approvalRequired = false;
  } else if (process.stdin.isTTY) {
    console.log('\n请选择工具执行模式：');
    console.log('1. 审批模式（每条命令需人工确认）');
    console.log('2. 自动模式（AI 输出命令后自动执行）');
    const choice = (await question('输入 1 或 2: ')).trim();
    if (choice === '2') approvalRequired = false;
  }

  // ---------- 初始化 ----------
  const session = new SessionManager();
  const browser = new BrowserController(config, logger);
  browserRef = global._browser = browser;

  // 启动子 AI 服务（独立进程）
  startAiAssistant(config, logger);
  await sleep(1000); // 给子服务一点启动时间

  // 启动 API 网关（独立进程，独立 browser_data_gateway）
  startApiGateway(config, logger);
  await sleep(500);

  const toolExecutor = new ToolExecutor(config, { approvalRequired, logger });
  toolExecutor._browser = browser;
  await toolExecutor.start();
  if (args.noWriteConfirm && toolExecutor.writeGuard) {
    toolExecutor.writeGuard.sessionSkipAll = true;
    logger.info('写入确认: 已禁用（--no-write-confirm）');
  }
  logger.info('写入确认模式:', toolExecutor.writeGuard ? toolExecutor.writeGuard.mode : 'n/a');

  try {
    await browser.start();

    const loggedIn = await browser.waitForLogin();
    if (!loggedIn) {
      logger.error('login timeout, exiting');
      return;
    }

    // ---------- 会话选择 ----------
    let useCurrentSession = false;
    if (process.stdin.isTTY) {
      console.log('\n' + '='.repeat(50));
      console.log('对话选择');
      console.log('='.repeat(50));
      console.log('当前浏览器已打开，请决定使用哪个会话：');
      console.log('  - 如果要使用当前显示的会话，请输入 y');
      console.log('  - 如果要新建对话，请先在浏览器中点击"新对话"按钮');
      console.log('  - 如果要选择历史对话，请先在浏览器中点击左侧的历史对话');
      const choice = (
        await question('完成手动操作后，按回车继续（y=使用当前会话）: ')
      )
        .trim()
        .toLowerCase();
      if (choice === 'y') {
        useCurrentSession = true;
      } else {
        await question('请确认已在浏览器中完成操作，然后按回车...');
        await browser.page.waitForSelector(config.selectors.message_input, {
          timeout: config.timeouts.login,
        });
      }
      logger.info('会话已确认', useCurrentSession ? '(使用当前会话)' : '(手动切换/新建)');
    }

    // ---------- 决定是否发初始提示词 ----------
    let shouldSendPrompt = true;

    if (args.noPrompt) {
      shouldSendPrompt = false;
      logger.info('初始提示词: 跳过（--no-prompt）');
    } else if (args.forcePrompt) {
      shouldSendPrompt = true;
      logger.info('初始提示词: 强制发送（--force-prompt）');
    } else if (config.initial_prompt_enabled === false) {
      shouldSendPrompt = false;
      logger.info('初始提示词: 跳过（config 禁用）');
    } else if (useCurrentSession && config.initial_prompt_on_current_session === false) {
      shouldSendPrompt = false;
      logger.info('初始提示词: 跳过（使用当前会话，避免污染历史对话）');
    }

    if (shouldSendPrompt) {
      logger.info('发送初始提示词...');
      const textBeforeInit = await browser.getLastResponseText();
      logger.info('发送前最后回复长度:', textBeforeInit ? textBeforeInit.length : 0);
      const okInit = await browser.sendMessage(INITIAL_PROMPT);
      logger.info('初始提示词发送', okInit ? '成功' : '失败');
      session.addMessage('system', INITIAL_PROMPT);

      try {
        logger.info('等待 AI 初始确认（最多 15 秒）...');
        const init = await Promise.race([
          browser.waitForNewResponse(textBeforeInit),
          sleep(15000).then(() => '__TIMEOUT__'),
        ]);
        if (init === '__TIMEOUT__') {
          logger.warn('AI 初始确认超时，继续');
        } else {
          logger.info('AI 初始确认长度:', (init || '').length);
        }
      } catch (e) {
        logger.warn('AI 初始确认异常:', e.message);
      }
    } else {
      logger.info('跳过初始提示词，直接进入主循环');
    }

    // ---------- 主循环 ----------
    while (true) {
      const userInput = (
        await question(
          '\n\x1b[36m请输入你的要求（exit 退出 / history 历史 / export 导出）:\x1b[0m '
        )
      ).trim();

      if (!userInput) continue;

      const lower = userInput.toLowerCase();
      if (lower === 'exit' || lower === 'quit') break;

      if (lower === 'train' || lower === '训练') {
        await runTraining(browser, session, config, logger);
        continue;
      }
      if (lower.startsWith('write-mode') || lower.startsWith('allow-write') || lower.startsWith('deny-write')) {
        if (!toolExecutor.writeGuard) { console.log('写入守卫未启用'); continue; }
        const parts = userInput.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const arg = parts.slice(1).join(' ').trim();
        if (cmd === 'write-mode') {
          if (arg) {
            console.log(toolExecutor.writeGuard.setMode(arg));
          } else {
            console.log(toolExecutor.writeGuard.status());
          }
        } else if (cmd === 'allow-write') {
          if (!arg) { console.log('用法: allow-write <目录>'); continue; }
          console.log(toolExecutor.writeGuard.allowDir(arg));
        } else if (cmd === 'deny-write') {
          if (!arg) { console.log('用法: deny-write <目录>'); continue; }
          console.log(toolExecutor.writeGuard.denyDir(arg));
        }
        continue;
      }
      if (lower === 'history') {
        console.log('\n===== 最近对话 =====');
        for (const msg of session.getRecent(20)) {
          console.log(`${msg.role}: ${msg.content.slice(0, 100)}`);
        }
        console.log('=====================\n');
        continue;
      }

      if (lower === 'export') {
        session.exportMarkdown('session.md');
        console.log('已导出到 session.md');
        continue;
      }

      browser.resetAbort();

      const lastText = await browser.getLastResponseText();
      logger.info('发送前最后回复长度:', lastText ? lastText.length : 0);
      const okSend = await browser.sendMessage(userInput);
      logger.info('发送用户消息', okSend ? '成功' : '失败');
      if (!okSend) {
        logger.error('消息发送失败，跳过本轮');
        continue;
      }
      session.addMessage('user', userInput);

      let toolLoopActive = true;
      let lastResponse = '';
      let prevText = lastText;
      let safetyRetryCount = 0;

      while (toolLoopActive) {
        const aiResponse = await browser.waitForNewResponse(prevText);

        if (browser.isAborted()) {
          console.log('\x1b[33m[已中断]\x1b[0m');
          break;
        }

        if (aiResponse === null || aiResponse === '') {
          console.log('\x1b[33m警告：AI 回复为空，等待下一次输入\x1b[0m');
          break;
        }

        // ★ 安全标记检测：不显示、不解析，提醒 AI 重试
        if (browser.consumeSafetyFlag && browser.consumeSafetyFlag()) {
          safetyRetryCount++;
          logger.warn(`AI 回复被安全标记污染（第 ${safetyRetryCount} 次），不发用户，提醒重试`);
          if (safetyRetryCount >= 3) {
            console.log('\n\x1b[31m[安全标记] AI 连续 3 次回复被系统安全标记污染，可能 DeepSeek 侧异常，请稍后重试\x1b[0m\n');
            safetyRetryCount = 0;
            break;
          }
          const reminder = '【系统提示】上一条回复被系统安全标记污染，未能显示。请重新回答上一条请求，严格遵循工具调用格式。';
          const cntB = await browser.getLastResponseText();
          const okR = await browser.sendMessage(reminder);
          if (okR) {
            session.addMessage('system', reminder);
            prevText = cntB;
            await sleep(800);
            continue;
          } else {
            logger.error('安全标记提醒发送失败');
            break;
          }
        }
        safetyRetryCount = 0;

        lastResponse = aiResponse;
        session.addMessage('assistant', aiResponse);

        const toolNames = new Set(Object.keys(toolExecutor.tools));

        const MAX_AI_RESPONSE_FOR_TOOL_PARSING = 12000;
        let commands = [];
        if (aiResponse.length > MAX_AI_RESPONSE_FOR_TOOL_PARSING) {
          logger.warn(`AI 回复超长（${aiResponse.length} 字符），视为分析报告，跳过工具解析`);
        } else {
          commands = parseToolCalls(aiResponse, config, toolNames);
        }

        if (commands.length) {
          // ★ 为每个调用生成唯一 callId
          const callIds = commands.map((_, i) => `c${i}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

          // ★ 串行执行：保证前一个工具完成后环境已刷新（文件写入、shell 状态等）
          const results = [];
          for (let i = 0; i < commands.length; i++) {
            try {
              const r = await toolExecutor.execute(commands[i], callIds[i]);
              results.push({ status: 'fulfilled', value: r });
            } catch (e) {
              results.push({ status: 'rejected', reason: e });
            }
          }

          const maxLen = config.limits?.tool_result_max_chars || 8000;

          const feedbackParts = commands.map((cmd, i) => {
            const r = results[i];
            const expectedCallId = callIds[i];

            if (r.status !== 'fulfilled') {
              logger.error(`[反馈] ${expectedCallId} 执行异常: ${r.reason}`);
              return `工具${i + 1} 失败: ${r.reason?.message || r.reason}`;
            }

            const resultObj = r.value;
            if (!resultObj || resultObj.callId !== expectedCallId) {
              logger.error(`[反馈] call_id 不匹配: 期望 ${expectedCallId}，实际 ${resultObj?.callId}`);
              return `工具${i + 1} 失败: call_id 不匹配`;
            }

            let s = resultObj.ok ? resultObj.value : `Error: ${resultObj.error}`;
            if (!s || !String(s).trim()) {
              s = '(empty)';
            }

            const originalLen = String(s).length;
            if (originalLen > maxLen) {
              s = String(s).slice(0, maxLen) +
                  `\n...[已截断：原 ${originalLen} 字符，只显示前 ${maxLen} 字符]`;
            }

            logger.info(`[反馈] ${expectedCallId} ${resultObj.ok ? '✓' : '✗'} ${resultObj.toolName} (${originalLen})`);

            return resultObj.ok ? `工具${i + 1}: ${s}` : `工具${i + 1} 失败: ${s}`;
          });

          const feedback = feedbackParts.join('\n\n');

          // 更新 prevText 为当前最后一条 AI 回复，用于下一轮判断新回复
          prevText = aiResponse;

          await sleep(800);

          const okFb = await browser.sendMessage(feedback);
          logger.info('发送工具反馈', okFb ? '成功' : '失败');

          if (!okFb) {
            logger.error('工具反馈发送失败，本轮中止，回到用户输入');
            toolLoopActive = false;
            break;
          }

          session.addMessage('system', feedback);
          await sleep(800);
          continue;
        }

        logger.info('AI 无工具调用，输出最终回答');
        const cleanAnswer = cleanUiNoise(lastResponse, config);
        console.log('\n\x1b[32m===== AI 最终回答 =====\x1b[0m');
        console.log(cleanAnswer);
        console.log('\x1b[32m========================\x1b[0m\n');
        toolLoopActive = false;
      }
    }
  } catch (e) {
    logger.error({ err: e.message, stack: e.stack }, 'fatal error');
    console.error('程序异常：', e.message);
  } finally {
    logger.info('清理中...');
    stopApiGateway();
    stopAiAssistant();
    closeReadline();
    try { await toolExecutor.close(); } catch {}
    logger.info('已退出');
    // 强制退出：防止残留 handle（stdin、Playwright driver 等）让 Node 事件循环不空
    setTimeout(() => process.exit(0), 300).unref();
  }
}

let aiAssistantProcess = null;

function startAiAssistant(config, logger) {
  const aiCfg = config.ai_assistant || {};
  if (aiCfg.enabled === false) {
    logger.info('子 AI 服务: 已禁用');
    return;
  }
  if (aiCfg.auto_start === false) {
    logger.info('子 AI 服务: 未自动启动（auto_start=false）');
    return;
  }

  const scriptPath = require('path').join(__dirname, 'ai-assistant.js');
  if (!require('fs').existsSync(scriptPath)) {
    logger.warn('子 AI 服务脚本不存在:', scriptPath);
    return;
  }

  const port = aiCfg.service_port || 15722;
  logger.info(`启动子 AI 服务 (端口 ${port})...`);

  aiAssistantProcess = fork(scriptPath, [], {
    stdio: 'inherit',
    env: {
      ...process.env,
      AI_ASSISTANT_PORT: String(port),
      AI_ASSISTANT_UPSTREAM: aiCfg.proxy_url || 'http://127.0.0.1:15721/v1',
      AI_ASSISTANT_MODEL: aiCfg.default_model || '',
      AI_ASSISTANT_TIMEOUT: String(aiCfg.timeout_ms || 180000),
      AI_ASSISTANT_MAX_ROUNDS: String(aiCfg.max_tool_rounds || 25),
    },
  });

  aiAssistantProcess.on('exit', (code, signal) => {
    logger.warn(`子 AI 服务退出: code=${code} signal=${signal}`);
    aiAssistantProcess = null;
  });

  aiAssistantProcess.on('error', (e) => {
    logger.error('子 AI 服务启动失败:', e.message);
  });
}

function stopAiAssistant() {
  if (aiAssistantProcess) {
    try { aiAssistantProcess.kill('SIGINT'); } catch {}
    setTimeout(() => {
      if (aiAssistantProcess) {
        try { aiAssistantProcess.kill('SIGKILL'); } catch {}
      }
    }, 3000);
  }
}

// ==================== API 网关 ====================
let apiGatewayProcess = null;

function startApiGateway(config, logger) {
  const cfg = config.api_gateway || {};
  if (cfg.enabled === false) {
    logger.info('API 网关: 已禁用（config.api_gateway.enabled=false）');
    return;
  }

  const scriptPath = require('path').join(__dirname, 'deepseek-api-gateway.js');
  if (!require('fs').existsSync(scriptPath)) {
    logger.warn('API 网关脚本不存在:', scriptPath);
    return;
  }

  const port = cfg.port || 8080;
  const userDataDir = cfg.user_data_dir || 'browser_data_gateway';

  logger.info(`启动 API 网关 (端口 ${port}, 数据目录 ${userDataDir})...`);

  apiGatewayProcess = fork(scriptPath, [], {
    stdio: 'inherit',
    env: {
      ...process.env,
      API_GATEWAY_PORT: String(port),
      GATEWAY_USER_DATA_DIR: userDataDir,
    },
  });

  apiGatewayProcess.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGINT' && signal !== 'SIGTERM') {
      logger.warn(`API 网关异常退出: code=${code} signal=${signal}`);
    } else {
      logger.info(`API 网关退出: code=${code} signal=${signal}`);
    }
    apiGatewayProcess = null;
  });

  apiGatewayProcess.on('error', (e) => {
    logger.error('API 网关启动失败:', e.message);
  });
}

function stopApiGateway() {
  if (apiGatewayProcess) {
    try { apiGatewayProcess.kill('SIGINT'); } catch {}
    setTimeout(() => {
      if (apiGatewayProcess) {
        try { apiGatewayProcess.kill('SIGKILL'); } catch {}
      }
    }, 3000);
  }
}

main().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
