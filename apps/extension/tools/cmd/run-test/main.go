// Package main runs the policy extension end to end against a live chain:
//
//  1. setExtensionId on the deployed InstructionSender (idempotent)
//  2. fetch the TEE public key from the extension proxy
//  3. ECIES-encrypt a policy's private half under that key
//  4. send STORE on-chain, poll for the result, assert it stored
//  5. send EVALUATE on-chain, poll, assert the returned split matches what we
//     encrypted and that the signature recovers to the machine that signed it
//
// Step 5 is the one that matters: it proves the enclave signed with its *TEE
// identity*, which is the address TeeAttestorGate checks. A signature from any
// other key would satisfy every structural assertion here and still be rejected
// on-chain, so recovering the signer is the only assertion worth trusting.
package main

import (
	"crypto/rand"
	"encoding/json"
	"flag"
	"math/big"
	"strings"
	"time"

	"policy-extension/tools/pkg/configs"
	"policy-extension/tools/pkg/fccutils"
	"policy-extension/tools/pkg/support"
	instrutils "policy-extension/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/ecies"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	"github.com/pkg/errors"
)

// Wire shapes, declared locally on purpose: this tool asserts on the wire
// format and must run unchanged against any implementation language. See
// docs/extension-contract.md.

type share struct {
	Recipient common.Address `json:"recipient"`
	ShareBps  uint16         `json:"shareBps"`
}

type privateConfig struct {
	Shares []share     `json:"shares"`
	Salt   common.Hash `json:"salt"`
}

type storePolicyResponse struct {
	Policy     common.Address `json:"policy"`
	Stored     bool           `json:"stored"`
	ShareCount int            `json:"shareCount"`
}

type evaluatePolicyResponse struct {
	Policy    common.Address `json:"policy"`
	Shares    []share        `json:"shares"`
	Salt      common.Hash    `json:"salt"`
	Signature []byte         `json:"signature"`
}

// A stand-in policy address. This test exercises the instruction round trip, not
// the policy contract; the full lifecycle against a real ConfidentialPolicy is
// the separate headless demo.
var testPolicy = common.HexToAddress("0xA11CE00000000000000000000000000000000001")

const testTriggeredAt = 1_700_000_000

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	instructionSenderF := flag.String("instructionSender", "", "instructionSender address")
	chainIDF := flag.Int64("chainId", 114, "chain id for the EIP-712 domain")
	flag.Parse()

	instructionSenderAddress := common.HexToAddress(*instructionSenderF)

	testSupport, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	// --- Step 1: configure the contract --------------------------------------
	logger.Infof("Step 1: setting extension ID on the instruction sender...")
	err = instrutils.SetExtensionId(testSupport, instructionSenderAddress)
	if err != nil {
		if strings.Contains(err.Error(), "already set") {
			logger.Infof("  Extension ID already set, continuing")
		} else {
			fccutils.FatalWithCause(errors.Errorf(
				"setExtensionId failed — is the extension registered? Check that pre-build.sh completed. Error: %s", err))
		}
	}

	// --- Step 2: fetch the TEE public key ------------------------------------
	logger.Infof("Step 2: fetching the TEE public key from the extension proxy...")
	teeInfo, err := fccutils.TeeInfo(*pf)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("fetch TEE info: %s", err))
	}

	ecdsaPub, err := teetypes.ParsePubKey(teeInfo.MachineData.PublicKey)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("parse TEE public key: %s", err))
	}
	logger.Infof("  TEE machine: %s", crypto.PubkeyToAddress(*ecdsaPub).Hex())

	// --- Step 3: encrypt a policy's private half -----------------------------
	logger.Infof("Step 3: ECIES-encrypting the policy config...")

	cfg := privateConfig{
		Shares: []share{
			{Recipient: common.HexToAddress("0x1111111111111111111111111111111111111111"), ShareBps: 6000},
			{Recipient: common.HexToAddress("0x2222222222222222222222222222222222222222"), ShareBps: 4000},
		},
		Salt: common.HexToHash("0xabababababababababababababababababababababababababababababababab"),
	}

	plaintext, err := json.Marshal(cfg)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	eciesPub := &ecies.PublicKey{
		X:      ecdsaPub.X,
		Y:      ecdsaPub.Y,
		Curve:  ecies.DefaultCurve,
		Params: ecies.ECIES_AES128_SHA256,
	}
	ciphertext, err := ecies.Encrypt(rand.Reader, eciesPub, plaintext, nil, nil)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ECIES encrypt: %s", err))
	}
	logger.Infof("  Ciphertext: %d bytes", len(ciphertext))

	// --- Step 4: STORE -------------------------------------------------------
	logger.Infof("Step 4: sending STORE...")
	storeID, _, err := instrutils.SendStorePolicy(testSupport, instructionSenderAddress, testPolicy, ciphertext)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	logger.Infof("  Instruction ID: %s", storeID.Hex())

	time.Sleep(5 * time.Second)

	var stored storePolicyResponse
	if err := fetchResult(*pf, storeID, &stored); err != nil {
		fccutils.FatalWithCause(errors.Errorf("STORE: %s", err))
	}
	if !stored.Stored {
		fccutils.FatalWithCause(errors.New("STORE reported stored=false"))
	}
	if stored.ShareCount != len(cfg.Shares) {
		fccutils.FatalWithCause(errors.Errorf(
			"STORE reported %d shares, expected %d", stored.ShareCount, len(cfg.Shares)))
	}
	logger.Infof("  Stored, %d shares. Test passed: STORE", stored.ShareCount)

	// --- Step 5: EVALUATE ----------------------------------------------------
	logger.Infof("Step 5: sending EVALUATE...")
	evalID, _, err := instrutils.SendEvaluatePolicy(
		testSupport, instructionSenderAddress, testPolicy, big.NewInt(testTriggeredAt))
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	logger.Infof("  Instruction ID: %s", evalID.Hex())

	time.Sleep(5 * time.Second)

	var evaluated evaluatePolicyResponse
	if err := fetchResult(*pf, evalID, &evaluated); err != nil {
		fccutils.FatalWithCause(errors.Errorf("EVALUATE: %s", err))
	}

	if err := checkEvaluation(evaluated, cfg, *chainIDF, crypto.PubkeyToAddress(*ecdsaPub)); err != nil {
		fccutils.FatalWithCause(errors.Errorf("EVALUATE: %s", err))
	}
	logger.Infof("  Test passed: EVALUATE, signature recovers to the TEE machine")

	logger.Infof("All tests passed.")
}

func fetchResult(proxyURL string, instructionID common.Hash, out any) error {
	actionResponse, err := fccutils.ActionResult(proxyURL, instructionID)
	if err != nil {
		return err
	}
	result := actionResponse.Result

	switch result.Status {
	case 0:
		return errors.Errorf("instruction processing failed: %s", result.Log)
	case 2:
		return errors.New("instruction still pending after polling")
	}

	if len(result.Data) == 0 {
		return errors.New("expected response data but got none")
	}

	if err := json.Unmarshal(result.Data, out); err != nil {
		return errors.Errorf("failed to unmarshal response: %s", err)
	}
	return nil
}

// checkEvaluation asserts the enclave returned our split unchanged and signed it
// with the machine identity.
func checkEvaluation(
	got evaluatePolicyResponse,
	want privateConfig,
	chainID int64,
	expectedSigner common.Address,
) error {
	if got.Salt != want.Salt {
		return errors.Errorf("salt mismatch: got %s, want %s", got.Salt.Hex(), want.Salt.Hex())
	}
	if len(got.Shares) != len(want.Shares) {
		return errors.Errorf("share count mismatch: got %d, want %d", len(got.Shares), len(want.Shares))
	}
	for i, s := range got.Shares {
		if s != want.Shares[i] {
			return errors.Errorf("share %d mismatch: got %+v, want %+v", i, s, want.Shares[i])
		}
	}
	if len(got.Signature) != 65 {
		return errors.Errorf("expected a 65-byte signature, got %d", len(got.Signature))
	}

	// ecrecover wants the recovery id as 0/1; ConfidentialPolicy receives 27/28.
	sig := make([]byte, 65)
	copy(sig, got.Signature)
	if sig[64] >= 27 {
		sig[64] -= 27
	}

	digest := executionDigest(got, chainID)
	pub, err := crypto.SigToPub(digest, sig)
	if err != nil {
		return errors.Errorf("recovering signer: %s", err)
	}

	if signer := crypto.PubkeyToAddress(*pub); signer != expectedSigner {
		return errors.Errorf(
			"signature recovers to %s, but the proxy reports the machine as %s -- "+
				"the enclave signed with the wrong key, and execute() would revert with SignerNotAttested",
			signer.Hex(), expectedSigner.Hex())
	}
	return nil
}

// executionDigest rebuilds what ConfidentialPolicy.execute recovers against:
// the EIP-712 digest, wrapped in the EIP-191 prefix that tee-node's signer adds.
//
// Re-derived here rather than imported, per the tools/ independence rule. The
// authoritative version of this math lives in ConfidentialPolicy.t.sol; if the
// two ever disagree, that test is right and this is wrong.
func executionDigest(r evaluatePolicyResponse, chainID int64) []byte {
	pad := func(v *big.Int) []byte { return common.LeftPadBytes(v.Bytes(), 32) }

	// commitment = keccak256(abi.encode(Share[], bytes32))
	var enc []byte
	enc = append(enc, pad(big.NewInt(0x40))...)
	enc = append(enc, r.Salt.Bytes()...)
	enc = append(enc, pad(big.NewInt(int64(len(r.Shares))))...)
	for _, s := range r.Shares {
		enc = append(enc, common.LeftPadBytes(s.Recipient.Bytes(), 32)...)
		enc = append(enc, pad(new(big.Int).SetUint64(uint64(s.ShareBps)))...)
	}
	commitment := crypto.Keccak256(enc)

	shareTypehash := crypto.Keccak256([]byte("Share(address recipient,uint16 shareBps)"))
	var packed []byte
	for _, s := range r.Shares {
		var el []byte
		el = append(el, shareTypehash...)
		el = append(el, common.LeftPadBytes(s.Recipient.Bytes(), 32)...)
		el = append(el, pad(new(big.Int).SetUint64(uint64(s.ShareBps)))...)
		packed = append(packed, crypto.Keccak256(el)...)
	}
	sharesHash := crypto.Keccak256(packed)

	var structBuf []byte
	structBuf = append(structBuf, crypto.Keccak256(
		[]byte("Execution(bytes32 commitment,bytes32 sharesHash,uint256 triggeredAt)"))...)
	structBuf = append(structBuf, commitment...)
	structBuf = append(structBuf, sharesHash...)
	structBuf = append(structBuf, pad(big.NewInt(testTriggeredAt))...)
	structHash := crypto.Keccak256(structBuf)

	var domainBuf []byte
	domainBuf = append(domainBuf, crypto.Keccak256(
		[]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))...)
	domainBuf = append(domainBuf, crypto.Keccak256([]byte("FlareStudioPolicy"))...)
	domainBuf = append(domainBuf, crypto.Keccak256([]byte("1"))...)
	domainBuf = append(domainBuf, pad(big.NewInt(chainID))...)
	domainBuf = append(domainBuf, common.LeftPadBytes(r.Policy.Bytes(), 32)...)
	domainSeparator := crypto.Keccak256(domainBuf)

	preimage := append([]byte{0x19, 0x01}, append(domainSeparator, structHash...)...)

	// The node keccaks the message, then personal-signs the result.
	return accountsTextHash(crypto.Keccak256(preimage))
}

func accountsTextHash(data []byte) []byte {
	msg := []byte("\x19Ethereum Signed Message:\n32")
	return crypto.Keccak256(append(msg, data...))
}
