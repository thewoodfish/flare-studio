package extension

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	teetypes "github.com/flare-foundation/tee-node/pkg/types"
)

// RPCs to the local tee-node, which holds this machine's key material.
//
// The enclave key never enters this process. We hand the node ciphertext and get
// plaintext back; we hand it a message and get a signature back. That split is
// what lets the extension be ordinary Go code while the secrets stay with the
// node -- and it is the pattern sign-extension established.

// decryptViaNode forwards ECIES ciphertext to the node's /decrypt endpoint.
func decryptViaNode(signPort int, ciphertext []byte) ([]byte, error) {
	var out teetypes.DecryptResponse
	err := postJSON(
		fmt.Sprintf("http://localhost:%d/decrypt", signPort),
		teetypes.DecryptRequest{EncryptedMessage: ciphertext},
		&out,
	)
	if err != nil {
		return nil, err
	}
	return out.DecryptedMessage, nil
}

// signViaNode signs with this machine's TEE identity key -- the address that
// FlareTeeManager knows and TeeAttestorGate.isAttested() checks.
//
// The node applies two transformations that the caller cannot switch off, and
// both matter for building a signature Solidity will accept:
//
//  1. It keccak256-hashes `message` before signing. So to land on a specific
//     32-byte digest, pass its *preimage* -- see eip712Preimage.
//  2. It then wraps that hash with the EIP-191 personal-sign prefix, via
//     accounts.TextHash. The verifying contract must therefore recover against
//     toEthSignedMessageHash(digest), not the bare digest.
//
// It also returns v in {0,1} (go-ethereum's convention), while OpenZeppelin's
// ECDSA.recover requires {27,28}; normalizeV handles that.
func signViaNode(signPort int, message []byte) ([]byte, error) {
	var out teetypes.SignResponse
	err := postJSON(
		fmt.Sprintf("http://localhost:%d/sign", signPort),
		teetypes.SignRequest{Message: message},
		&out,
	)
	if err != nil {
		return nil, err
	}
	if len(out.Signature) != 65 {
		return nil, fmt.Errorf("expected a 65-byte signature, got %d", len(out.Signature))
	}
	return normalizeV(out.Signature), nil
}

// normalizeV converts a recovery id of 0/1 into the 27/28 that ecrecover expects.
// Signatures already in 27/28 form pass through untouched, so this is safe to
// apply unconditionally if the node's convention ever changes.
func normalizeV(sig []byte) []byte {
	out := make([]byte, 65)
	copy(out, sig)
	if out[64] < 27 {
		out[64] += 27
	}
	return out
}

func postJSON(url string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("encoding request: %w", err)
	}

	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("calling %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%s returned %d: %s", url, resp.StatusCode, bytes.TrimSpace(b))
	}

	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decoding response from %s: %w", url, err)
	}
	return nil
}
