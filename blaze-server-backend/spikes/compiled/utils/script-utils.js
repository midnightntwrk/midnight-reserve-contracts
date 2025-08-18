"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HELLO_WORLD_COMPILED_CODE = void 0;
exports.computeScriptInfo = computeScriptInfo;
const uplc_1 = require("@blaze-cardano/uplc");
const Core = __importStar(require("@blaze-cardano/core"));
const contracts_1 = require("./contracts");
// Export the compiled code constant for tests to use
// This is the CBOR hex of the HelloWorldHelloWorldSpend contract
exports.HELLO_WORLD_COMPILED_CODE = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";
// Blueprint-based script registry for performance optimization
// Avoids recompiling scripts that are already known from the blueprint
const BLUEPRINT_SCRIPTS = {
    [exports.HELLO_WORLD_COMPILED_CODE]: {
        script: new contracts_1.HelloWorldHelloWorldSpend().Script,
        hash: "5b7e059453488d25906a7920dfe4b750ff4bd8c0afb6fecf8721b050",
        address: "addr_test1wpdhupv52dyg6fvsdfujphlykag07j7cczhmdlk0susmq5qkvz5qs"
    }
};
/**
 * Compute script hash and address directly from compiled code
 * Uses blueprint cache for known scripts to avoid recompilation
 * This replaces the need for the deprecated /api/contract/deploy endpoint
 */
function computeScriptInfo(compiledCode) {
    // Check if we have blueprint info for this script (performance optimization)
    const blueprintInfo = BLUEPRINT_SCRIPTS[compiledCode];
    if (blueprintInfo) {
        return {
            scriptHash: blueprintInfo.hash,
            contractAddress: blueprintInfo.address,
            script: blueprintInfo.script
        };
    }
    // Fallback to runtime compilation for unknown scripts
    const script = (0, uplc_1.cborToScript)(compiledCode, "PlutusV3");
    const scriptHash = script.hash();
    const scriptAddress = Core.addressFromValidator(Core.NetworkId.Testnet, script);
    return {
        scriptHash: scriptHash,
        contractAddress: scriptAddress.toBech32(),
        script: script
    };
}
