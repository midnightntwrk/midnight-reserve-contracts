"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HelloWorldHelloWorldElse = exports.HelloWorldHelloWorldSpend = exports.MyDatum = void 0;
/* eslint-disable */
// @ts-nocheck
const uplc_1 = require("@blaze-cardano/uplc");
const data_1 = require("@blaze-cardano/data");
const Contracts = data_1.Type.Module({
    MyDatum: data_1.Type.Object({
        thing: data_1.Type.BigInt(),
    }, { ctor: 0n }),
});
exports.MyDatum = Contracts.Import("MyDatum");
class HelloWorldHelloWorldSpend {
    constructor() {
        this.Script = (0, uplc_1.cborToScript)((0, uplc_1.applyParamsToScript)("587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009", data_1.Type.Tuple([]), []), "PlutusV3");
    }
}
exports.HelloWorldHelloWorldSpend = HelloWorldHelloWorldSpend;
class HelloWorldHelloWorldElse {
    constructor() {
        this.Script = (0, uplc_1.cborToScript)((0, uplc_1.applyParamsToScript)("587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009", data_1.Type.Tuple([]), []), "PlutusV3");
    }
}
exports.HelloWorldHelloWorldElse = HelloWorldHelloWorldElse;
