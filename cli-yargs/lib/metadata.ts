import {
  Metadata,
  Metadatum,
  MetadatumMap,
  MetadatumList,
} from "@blaze-cardano/core";

const CIP20_LABEL = 674n;

export function createTxMetadata(txType: string): Metadata {
  const msgList = new MetadatumList();
  msgList.add(Metadatum.newText(`midnight-reserve:${txType}`));

  const msgMap = new MetadatumMap();
  msgMap.insert(Metadatum.newText("msg"), Metadatum.newList(msgList));

  const metadata = new Map<bigint, Metadatum>();
  metadata.set(CIP20_LABEL, Metadatum.newMap(msgMap));

  return new Metadata(metadata);
}
