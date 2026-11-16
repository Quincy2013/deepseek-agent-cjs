'use strict';

const { spawn } = require('child_process');
const path = require('path');

class GoExecutorClient {
    constructor(binaryPath, logger) {
        this.binaryPath = binaryPath;
        this.logger = logger;
        this.process = null;
        this.pending = new Map();
        this.idCounter = 0;
        this.buffer = '';
        this.ready = false;
    }

    async start() {
        if (this.process) return;
        const abs = path.isAbsolute(this.binaryPath)
            ? this.binaryPath
            : path.resolve(this.binaryPath);

        this.logger.info('spawning Go sidecar:', abs);
        this.process = spawn(abs, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });

        this.process.stdout.on('data', (data) => {
            this.buffer += data.toString('utf8');
            let idx;
            while ((idx = this.buffer.indexOf('\n')) !== -1) {
                const line = this.buffer.slice(0, idx).trim();
                this.buffer = this.buffer.slice(idx + 1);
                if (!line) continue;
                this._handleLine(line);
            }
        });

        this.process.stderr.on('data', (data) => {
            const s = data.toString('utf8').trim();
            if (s) this.logger.warn('[go-stderr]', s);
        });

        this.process.on('exit', (code, signal) => {
            this.logger.warn(`Go sidecar exited: code=${code} signal=${signal}`);
            for (const { reject, timer } of this.pending.values()) {
                clearTimeout(timer);
                reject(new Error(`Go sidecar exited (code=${code})`));
            }
            this.pending.clear();
            this.process = null;
            this.ready = false;
        });

        await this._call('ping', {}, 5000);
        this.ready = true;
    }

    _handleLine(line) {
        let resp;
        try {
            resp = JSON.parse(line);
        } catch (e) {
            this.logger.warn('invalid JSON from Go:', line.slice(0, 200));
            return;
        }
        const id = String(resp.id);
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        if (resp.error) {
            entry.reject(new Error(resp.error.message || 'rpc error'));
        } else {
            entry.resolve(resp.result);
        }
    }

    _call(method, params, timeoutMs = 300000) {
        if (!this.process) {
            return Promise.reject(new Error('Go sidecar not started'));
        }
        const id = String(++this.idCounter);
        const req = JSON.stringify({ id, method, params }) + '\n';
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`timeout waiting for ${method}`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.process.stdin.write(req);
        });
    }

    async execute(command, callId) {
        if (!this.ready) await this.start();
        return await this._call('execute', { call_id: callId, command }, 300000);
    }

    async listTools() {
        if (!this.ready) await this.start();
        const result = await this._call('list_tools', {}, 5000);
        return result.tools || [];
    }

    async close() {
        if (!this.process) return;
        try {
            await this._call('shutdown', {}, 3000);
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
        if (this.process) {
            try { this.process.kill('SIGKILL'); } catch {}
            this.process = null;
        }
        this.ready = false;
    }
}

module.exports = { GoExecutorClient };