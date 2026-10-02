/*
 * config.js - Configuration loader for Amiga AI Shell
 */

var fs = require('fs');

var defaultConfig = {
    // In WinUAE with bsdsocket_emu=true, localhost 127.0.0.1 connects to PC
    // On real Amiga, change this to your PC LAN IP (e.g. 192.168.1.100)
    host: "127.0.0.1",
    port: 11435,
    model: "qwen3.8:latest",
    approvalMode: "smart", // 'smart' (auto-approve safe reads, prompt on dangerous writes/commands), 'manual' (prompt for all), 'auto' (unrestricted)
    autoExecute: false,    // legacy alias for approvalMode: "auto"
    debug: false,
    encoding: "ascii", // 'ascii' (safest for standard Topaz font), 'amigapl', 'iso-8859-2'
    timeout: 60000, // 60s socket timeout
    systemPrompt: null
};

function loadConfig(customFile) {
    var cfg = {};
    // Clone default config
    var k;
    for (k in defaultConfig) {
        if (defaultConfig.hasOwnProperty(k)) {
            cfg[k] = defaultConfig[k];
        }
    }

    var searchPaths = [
        customFile,
        "ai.json",
        "PROGDIR:ai.json",
        "ENV:ai.json"
    ];

    var i;
    for (i = 0; i < searchPaths.length; i++) {
        var p = searchPaths[i];
        if (p && fs.existsSync(p)) {
            try {
                var content = fs.readFileSync(p, 'utf8');
                var parsed = JSON.parse(content);
                for (var key in parsed) {
                    if (parsed.hasOwnProperty(key)) {
                        cfg[key] = parsed[key];
                    }
                }
                break;
            } catch (e) {
                // Ignore parse errors on secondary configs
            }
        }
    }

    // Normalize approvalMode & autoExecute
    if (cfg.autoExecute === true && (!cfg.approvalMode || cfg.approvalMode === 'manual')) {
        cfg.approvalMode = 'auto';
    }
    if (!cfg.approvalMode) {
        cfg.approvalMode = 'smart';
    }
    cfg.approvalMode = String(cfg.approvalMode).toLowerCase();
    if (cfg.approvalMode !== 'smart' && cfg.approvalMode !== 'manual' && cfg.approvalMode !== 'auto') {
        cfg.approvalMode = 'smart';
    }

    return cfg;
}

module.exports = {
    defaultConfig: defaultConfig,
    loadConfig: loadConfig
};
