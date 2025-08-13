/* eslint-disable */
// @ts-nocheck
// TypeScript bindings for double_value_checker contract (UNUSED - in exploration)

import { applyParamsToScript, cborToScript } from "@blaze-cardano/uplc";
import { type Script } from "@blaze-cardano/core";
import { Type, Exact, TPlutusData } from "@blaze-cardano/data";
import { type PlutusData } from "@blaze-cardano/core";

const DoubleValueCheckerTypes = Type.Module({
  DoubleValueCheckerDatum: Type.Object({
    placeholder: Type.BigInt(),
  }, { ctor: 0n }),
  DoubleValueCheckerRedeemer: Type.Object({
    placeholder: Type.BigInt(),
  }, { ctor: 0n }),
});

export const DoubleValueCheckerDatum = DoubleValueCheckerTypes.Import("DoubleValueCheckerDatum");
export type DoubleValueCheckerDatum = Exact<typeof DoubleValueCheckerDatum>;

export const DoubleValueCheckerRedeemer = DoubleValueCheckerTypes.Import("DoubleValueCheckerRedeemer");
export type DoubleValueCheckerRedeemer = Exact<typeof DoubleValueCheckerRedeemer>;

export class DoubleValueCheckerDoubleValueCheckerSpend {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "5901d001010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cdc3a40049112cc004c004c01cdd500144c8cc896600266e1d2000300a375400d1323259800980880144cc89660020030028992cc004006007159800980a000c4c8c8cc896600266e1c008cdc1000a400914a313370e00266e08009200440486002602a0086002602a006464b3001300c3012375400314800226eb4c058c04cdd5000a0223259800980618091baa0018a6103d87a8000899198008009bab30173014375400444b30010018a6103d87a8000899192cc004cdc8a45000018acc004cdc7a44100001899ba548000cc064c05c0092f5c114c0103d87a80004055133004004301b00340546eb8c054004c060005016202232330010013756600660266ea8c00cc04cdd5001112cc004006298103d87a8000899192cc004cdc8a45000018acc004cdc7a44100001899ba548000cc060c0580092f5c114c0103d87a80004051133004004301a00340506eb8c050004c05c0050151180a180a800c00d0112022301300140402940dd6180818069baa301000a8b201c375a601e00260166ea801a2c8048c030004c030c034004c020dd50014590060c020004c00cdd5004452689b2b200201",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}

export class DoubleValueCheckerDoubleValueCheckerElse {
  public Script: Script
  constructor() {
    this.Script = cborToScript(
      applyParamsToScript(
        "5901d001010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cdc3a40049112cc004c004c01cdd500144c8cc896600266e1d2000300a375400d1323259800980880144cc89660020030028992cc004006007159800980a000c4c8c8cc896600266e1c008cdc1000a400914a313370e00266e08009200440486002602a0086002602a006464b3001300c3012375400314800226eb4c058c04cdd5000a0223259800980618091baa0018a6103d87a8000899198008009bab30173014375400444b30010018a6103d87a8000899192cc004cdc8a45000018acc004cdc7a44100001899ba548000cc064c05c0092f5c114c0103d87a80004055133004004301b00340546eb8c054004c060005016202232330010013756600660266ea8c00cc04cdd5001112cc004006298103d87a8000899192cc004cdc8a45000018acc004cdc7a44100001899ba548000cc060c0580092f5c114c0103d87a80004051133004004301a00340506eb8c050004c05c0050151180a180a800c00d0112022301300140402940dd6180818069baa301000a8b201c375a601e00260166ea801a2c8048c030004c030c034004c020dd50014590060c020004c00cdd5004452689b2b200201",
        Type.Tuple([
        ]),
        [
        ],
      ),
      "PlutusV3"
    );
  }
}