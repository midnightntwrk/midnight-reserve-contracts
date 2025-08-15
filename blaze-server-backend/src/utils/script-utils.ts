import { cborToScript } from "@blaze-cardano/uplc";
import * as Core from "@blaze-cardano/core";
import { HelloWorldHelloWorldSpend } from "./contracts";

// Export the compiled code constant for tests to use
// This is the CBOR hex of the HelloWorldHelloWorldSpend contract
export const HELLO_WORLD_COMPILED_CODE = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";

// Blueprint-based script registry for performance optimization
// Avoids recompiling scripts that are already known from the blueprint
const BLUEPRINT_SCRIPTS = {
  [HELLO_WORLD_COMPILED_CODE]: {
    script: new HelloWorldHelloWorldSpend().Script,
    hash: "5b7e059453488d25906a7920dfe4b750ff4bd8c0afb6fecf8721b050",
    address: "addr_test1wpdhupv52dyg6fvsdfujphlykag07j7cczhmdlk0susmq5qkvz5qs"
  }
};

/**
 * Compute script hash and address directly from compiled code
 * Uses blueprint cache for known scripts to avoid recompilation
 * This replaces the need for the deprecated /api/contract/deploy endpoint
 */
export function computeScriptInfo(compiledCode: string) {
  // Check if we have blueprint info for this script (performance optimization)
  const blueprintInfo = (BLUEPRINT_SCRIPTS as any)[compiledCode];
  if (blueprintInfo) {
    return {
      scriptHash: blueprintInfo.hash,
      contractAddress: blueprintInfo.address,
      script: blueprintInfo.script
    };
  }
  
  // Fallback to runtime compilation for unknown scripts
  const script = cborToScript(compiledCode, "PlutusV3");
  const scriptHash = script.hash();
  const scriptAddress = Core.addressFromValidator(Core.NetworkId.Testnet, script);
  
  return {
    scriptHash: scriptHash,
    contractAddress: scriptAddress.toBech32(),
    script: script
  };
}