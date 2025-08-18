/* eslint-disable */
// @ts-nocheck
import { applyParamsToScript, cborToScript } from "@blaze-cardano/uplc";
import { type Script } from "@blaze-cardano/core";
import { Type, Exact, TPlutusData } from "@blaze-cardano/data";
import { type PlutusData } from "@blaze-cardano/core";
type Data = PlutusData;
type Int = bigint;
type ByteArray = string;
type OutputReference = { output_index: bigint; transaction_id: string };

const Contracts = Type.Module({
  MyDatum: Type.Object({
    thing: Type.BigInt(),
  }, { ctor: 0n }),
});

export const MyDatum = Contracts.Import("MyDatum");
export type MyDatum = Exact<typeof MyDatum>;

export class HelloWorldHelloWorldSpend {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}
export class HelloWorldHelloWorldElse {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "587c01010029800aba2aba1aab9eaab9dab9a4888896600264646644b30013370e900118031baa00289919912cc004cdc3a400460126ea80062942266e1cdd6980598051baa300b300a37540026eb4c02c01900818048009804980500098039baa0028b200a30063007001300600230060013003375400d149a26cac8009",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}