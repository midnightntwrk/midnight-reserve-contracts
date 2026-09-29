/**
 * A Lace wallet's first address and keys from its recovery phrase, as CIP-1852
 * derives them (account `account`, payment key 0/0, stake key 2/0), printed as
 * .env lines: PAYMENT_KEY and STAKE_KEY as 128-hex extended keys for the CLI,
 * PAYMENT_XSK and STAKE_XSK as cardano-cli extended signing key CBOR,
 * ADDRESS (base, testnet), STAKE_ADDRESS and STAKE_KEY_HASH.
 * Usage: bun demo/wallet-keys.ts <account> (phrase on stdin)
 */
import {
  addressFromCredentials,
  Bip32PrivateKey,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  initCrypto,
  mnemonicToEntropy,
  NetworkId,
  RewardAccount,
  wordlist,
} from "@blaze-cardano/core";

await initCrypto();
const phrase = (await Bun.stdin.text()).trim();
const hard = (index: number) => index + 0x80000000;
const account = Bip32PrivateKey.fromBip39Entropy(
  Buffer.from(mnemonicToEntropy(phrase, wordlist)),
  "",
).derive([hard(1852), hard(1815), hard(Number(Bun.argv[2]))]);
const paymentXprv = account.derive([0, 0]);
const stakeXprv = account.derive([2, 0]);
const payment = paymentXprv.toRawKey();
const stake = stakeXprv.toRawKey();
// cardano-cli's extended key: the 64-byte key, its public key, then the chain code.
const xsk = (xprv: typeof stakeXprv) =>
  `5880${xprv.toRawKey().hex()}${xprv.toRawKey().toPublic().hex()}${Buffer.from(xprv.bytes().slice(64)).toString("hex")}`;
const keyHash = (key: typeof stake) =>
  Hash28ByteBase16(key.toPublic().hash().hex());
const stakeCredential = {
  type: CredentialType.KeyHash,
  hash: keyHash(stake),
};
const address = addressFromCredentials(
  NetworkId.Testnet,
  Credential.fromCore({ type: CredentialType.KeyHash, hash: keyHash(payment) }),
  Credential.fromCore(stakeCredential),
);
console.log(`PAYMENT_KEY=${payment.hex()}`);
console.log(`STAKE_KEY=${stake.hex()}`);
console.log(`PAYMENT_XSK=${xsk(paymentXprv)}`);
console.log(`STAKE_XSK=${xsk(stakeXprv)}`);
console.log(`ADDRESS=${address.toBech32()}`);
console.log(
  `STAKE_ADDRESS=${RewardAccount.fromCredential(stakeCredential, NetworkId.Testnet)}`,
);
console.log(`STAKE_KEY_HASH=${stakeCredential.hash}`);
