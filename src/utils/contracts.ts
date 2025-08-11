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
export class PlaceholderPlaceholderMint {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "58d001010029800aba2aba1aab9eaab9dab9a48888966002646465300130053754003300700398038012444b30013370e9000001c4c98dd7180518049baa0048acc004cdc3a400400713233226300b001300b300c0013009375400915980099b874801000e264c601460126ea80122b30013370e9003001c4c8cc898dd698058009805980600098049baa0048acc004cdc3a40100071326300a3009375400913233226375a60160026016601800260126ea8011007200e401c80390070c018c01c004c018004c00cdd5003452689b2b20021",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}
export class PlaceholderPlaceholderSpend {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "58d001010029800aba2aba1aab9eaab9dab9a48888966002646465300130053754003300700398038012444b30013370e9000001c4c98dd7180518049baa0048acc004cdc3a400400713233226300b001300b300c0013009375400915980099b874801000e264c601460126ea80122b30013370e9003001c4c8cc898dd698058009805980600098049baa0048acc004cdc3a40100071326300a3009375400913233226375a60160026016601800260126ea8011007200e401c80390070c018c01c004c018004c00cdd5003452689b2b20021",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}
export class PlaceholderPlaceholderWithdraw {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "58d001010029800aba2aba1aab9eaab9dab9a48888966002646465300130053754003300700398038012444b30013370e9000001c4c98dd7180518049baa0048acc004cdc3a400400713233226300b001300b300c0013009375400915980099b874801000e264c601460126ea80122b30013370e9003001c4c8cc898dd698058009805980600098049baa0048acc004cdc3a40100071326300a3009375400913233226375a60160026016601800260126ea8011007200e401c80390070c018c01c004c018004c00cdd5003452689b2b20021",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}
export class PlaceholderPlaceholderPublish {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "58d001010029800aba2aba1aab9eaab9dab9a48888966002646465300130053754003300700398038012444b30013370e9000001c4c98dd7180518049baa0048acc004cdc3a400400713233226300b001300b300c0013009375400915980099b874801000e264c601460126ea80122b30013370e9003001c4c8cc898dd698058009805980600098049baa0048acc004cdc3a40100071326300a3009375400913233226375a60160026016601800260126ea8011007200e401c80390070c018c01c004c018004c00cdd5003452689b2b20021",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}
export class PlaceholderPlaceholderVote {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "58d001010029800aba2aba1aab9eaab9dab9a48888966002646465300130053754003300700398038012444b30013370e9000001c4c98dd7180518049baa0048acc004cdc3a400400713233226300b001300b300c0013009375400915980099b874801000e264c601460126ea80122b30013370e9003001c4c8cc898dd698058009805980600098049baa0048acc004cdc3a40100071326300a3009375400913233226375a60160026016601800260126ea8011007200e401c80390070c018c01c004c018004c00cdd5003452689b2b20021",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}
export class PlaceholderPlaceholderPropose {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "58d001010029800aba2aba1aab9eaab9dab9a48888966002646465300130053754003300700398038012444b30013370e9000001c4c98dd7180518049baa0048acc004cdc3a400400713233226300b001300b300c0013009375400915980099b874801000e264c601460126ea80122b30013370e9003001c4c8cc898dd698058009805980600098049baa0048acc004cdc3a40100071326300a3009375400913233226375a60160026016601800260126ea8011007200e401c80390070c018c01c004c018004c00cdd5003452689b2b20021",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}
export class PlaceholderPlaceholderElse {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "58d001010029800aba2aba1aab9eaab9dab9a48888966002646465300130053754003300700398038012444b30013370e9000001c4c98dd7180518049baa0048acc004cdc3a400400713233226300b001300b300c0013009375400915980099b874801000e264c601460126ea80122b30013370e9003001c4c8cc898dd698058009805980600098049baa0048acc004cdc3a40100071326300a3009375400913233226375a60160026016601800260126ea8011007200e401c80390070c018c01c004c018004c00cdd5003452689b2b20021",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}