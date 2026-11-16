'use strict';

const readline = require('readline');
const { GoExecutorClient } = require('./go-client');
const { WriteGuard } = require('./write-guard');

let rlInstance = null;

function getReadline() {
    if (!rlInstance) {
        rlInstance = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: process.stdin.isTTY,
        });
        rlInstance.on('SIGINT', () => {});
    }
    return rlInstance;
}

function question(prompt) {
    const rl = getReadline();
    return new Promise((resolve) => rl.question(prompt, (ans) => resolve(ans)));
}

function closeReadline() {
    if (rlInstance) {
        try { rlInstance.close(); } catch {}
        rlInstance = null;
    }
    try {
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
            process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        if (typeof process.stdin.unref === 'function') process.stdin.unref();
    } catch {}
}

function toCamelResult(goResult, fallbackCallId) {
    if (!goResult) {
        return {
            callId: fallbackCallId,
            toolName: '(unknown)',
            args: '',
            ok: false,
            value: '',
            error: 'empty result from Go',
        };
    }
    return {
        callId: goResult.call_id || fallbackCallId,
        toolName: goResult.tool_name || '(unknown)',
        args: goResult.args || '',
        ok: !!goResult.ok,
        value: goResult.value || '',
        error: goResult.error || '',
    };
}

class ToolExecutor {
    constructor(config, { approvalRequired, logger, excludeTools } = {}) {
        this.config = config;
        this.approvalRequired = approvalRequired !== false;
        this.logger = logger;

        const binPath = config.goBinaryPath || 'C:/Users/39740/go-agent/go-agent.exe';
        this.client = new GoExecutorClient(binPath, logger);

        this.excludeTools = new Set(excludeTools || []);
        this.writeGuard = new WriteGuard(config, logger);
        this.tools = {};
        this._browser = null;
        this._session = null;
        this.highRiskTools = new Set(config.security?.high_risk_tools || []);
    }

    async start() {
        await this.client.start();
        const names = await this.client.listTools();
        this.tools = {};
        for (const n of names) {
            if (this.excludeTools.has(n)) continue;
            this.tools[n] = true;
        }
        this.logger.info('Go sidecar started, tools loaded:', Object.keys(this.tools).length);
    }

    async listTools() {
        return Object.keys(this.tools);
    }

    async execute(command, callId) {
        const cid = callId || `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

        const idx = command.indexOf(':');
        const rawName = idx === -1 ? 'shell' : command.slice(0, idx).trim();
        const baseName = rawName.replace(/@\d+$/, '').toLowerCase();

        // ★ 写入守卫
        if (this.writeGuard) {
            const guard = await this.writeGuard.check(baseName, command.slice(idx + 1), question);
            if (!guard.allowed) {
                return {
                    callId: cid,
                    toolName: baseName,
                    args: command,
                    ok: false,
                    value: '',
                    error: `写入被拒绝: ${guard.reason}`, 
                };
            }
        }

        if (this.excludeTools.has(baseName)) {
            return {
                callId: cid,
                toolName: baseName,
                args: command,
                ok: false,
                    value: '',
                error: `tool '${baseName}' is disabled in this context`,
            };
        }

        if (this.approvalRequired || this.highRiskTools.has(baseName)) {
            const preview = command.length > 120 ? command.slice(0, 120) + '...' : command;
            const decision = (await question(`Execute [${baseName}] ${preview}? (y/n): `))
                .trim().toLowerCase();
            if (decision !== 'y') {
                return {
                    callId: cid,
                    toolName: baseName,
                    args: command,
                    ok: false,
                    value: '',
                    error: 'User rejected execution',
                };
            }
        }

        let goResult;
        try {
            goResult = await this.client.execute(command, cid);
        } catch (e) {
            return {
                callId: cid,
                toolName: baseName,
                args: command,
                ok: false,
                value: '',
                error: `Go call failed: ${e.message}`,
            };
        }

        const result = toCamelResult(goResult, cid);

        if (result.ok && this._browser && typeof result.value === 'string') {
            const uploads = this._extractUploadPaths(result.value);
            if (uploads.length) {
                this.logger.info(`[upload] 检测到 ${uploads.length} 个文件需上传`);
                try {
                    await this._browser.uploadFiles(uploads);
                    result.value += `\n\n[已自动上传 ${uploads.length} 个文件到 DeepSeek]`;
                } catch (e) {
                    result.value += `\n\n[上传失败: ${e.message}]`;
                }
            }
        }

        return result;
    }

    _extractUploadPaths(text) {
        const paths = [];
        const re = /\[(?:large text |image )?queued for upload\]\s+([^\s(]+)/g;
        let m;
        while ((m = re.exec(text)) !== null) paths.push(m[1]);
        return paths;
    }

    async close() {
        await this.client.close();
    }
}

module.exports = { ToolExecutor, question, closeReadline };
