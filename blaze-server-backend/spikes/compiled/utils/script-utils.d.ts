export declare const HELLO_WORLD_COMPILED_CODE = "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009";
/**
 * Compute script hash and address directly from compiled code
 * Uses blueprint cache for known scripts to avoid recompilation
 * This replaces the need for the deprecated /api/contract/deploy endpoint
 */
export declare function computeScriptInfo(compiledCode: string): {
    scriptHash: any;
    contractAddress: any;
    script: any;
};
//# sourceMappingURL=script-utils.d.ts.map