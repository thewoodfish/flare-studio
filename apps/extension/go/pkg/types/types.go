// Package types contains types that could be useful to other apps when interacting with this extension.
package types

import (
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

// StorePolicyRequest is the ABI-decoded payload of a STORE instruction.
//
// Ciphertext is ECIES (secp256k1 / AES-128-CTR / HMAC-SHA-256, the go-ethereum
// crypto/ecies profile) over the canonical privateConfig JSON, encrypted to this
// machine's public key.
type StorePolicyRequest struct {
	Policy     common.Address `json:"policy"`
	Ciphertext []byte         `json:"ciphertext"`
}

// StorePolicyResponse deliberately reports presence, never content.
//
// The sign-extension precedent is the one to follow here: it reports whether a key
// is held without ever echoing key material. A STORE response that returned the
// recipient set -- or any part of it -- would put the private half of the policy
// into an on-chain ActionResult, which is the exact disclosure the whole design
// exists to prevent. ShareCount is the most that leaves the enclave, and even that
// is only a count.
type StorePolicyResponse struct {
	Policy     common.Address `json:"policy"`
	Stored     bool           `json:"stored"`
	ShareCount int            `json:"shareCount"`
}

// EvaluatePolicyRequest is the ABI-decoded payload of an EVALUATE instruction.
type EvaluatePolicyRequest struct {
	Policy      common.Address `json:"policy"`
	TriggeredAt *big.Int       `json:"triggeredAt"`
}

// Share mirrors ConfidentialPolicy.Share. Shares are proportions in basis points,
// never amounts: the balance at execution time is unknowable when the policy is
// written, so the commitment is taken over proportions and the contract does the
// arithmetic. The enclave therefore cannot choose payout amounts at all.
type Share struct {
	Recipient common.Address `json:"recipient"`
	ShareBps  uint16         `json:"shareBps"`
}

// EvaluatePolicyResponse carries everything ConfidentialPolicy.execute needs.
//
// This is the one point where the private half becomes public, and that is by
// design: execute() reveals the split in calldata and checks it against the
// commitment fixed at deploy time. Before this moment no recipient has appeared
// in any on-chain call.
type EvaluatePolicyResponse struct {
	Policy    common.Address `json:"policy"`
	Shares    []Share        `json:"shares"`
	Salt      common.Hash    `json:"salt"`
	Signature []byte         `json:"signature"`
}

// PrivateConfig is the plaintext recovered from the ciphertext. Its canonical JSON
// encoding, together with the salt, is what the on-chain commitment binds.
type PrivateConfig struct {
	Shares []Share     `json:"shares"`
	Salt   common.Hash `json:"salt"`
}

// StorePolicyMessageArg describes the ABI layout of StorePolicyMessage in the
// Solidity contract. Field names and order must match the struct exactly.
var StorePolicyMessageArg abi.Argument

// EvaluatePolicyMessageArg describes the ABI layout of EvaluatePolicyMessage.
var EvaluatePolicyMessageArg abi.Argument

func init() {
	storeTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "policy", Type: "address"},
		{Name: "ciphertext", Type: "bytes"},
	})
	StorePolicyMessageArg = abi.Argument{Type: storeTy}

	evaluateTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "policy", Type: "address"},
		{Name: "triggeredAt", Type: "uint256"},
	})
	EvaluatePolicyMessageArg = abi.Argument{Type: evaluateTy}
}

// State holds the extension's observable state, returned by GET /state.
//
// Every field here is non-sensitive by construction -- counts and addresses the
// chain already knows. The monitor UI renders this, so anything added must pass
// the same test: would it be safe on a public dashboard?
type State struct {
	PoliciesStored  int    `json:"policiesStored"`
	EvaluationCount int    `json:"evaluationCount"`
	LastPolicy      string `json:"lastPolicy"`
}

// --- DO NOT MODIFY below this line. ---

// StateResponse is the envelope returned by GET /state.
type StateResponse struct {
	StateVersion common.Hash `json:"stateVersion"`
	State        State       `json:"state"`
}
