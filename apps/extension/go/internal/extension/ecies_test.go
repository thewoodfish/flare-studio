package extension

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"policy-extension/pkg/types"

	"github.com/ethereum/go-ethereum/crypto"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

// TestEciesVectors_DecryptBrowserCiphertext is the proof that the browser can
// talk to the enclave at all.
//
// The ciphertexts in the fixture were produced by packages/policy/src/ecies.ts,
// the same code path the web app uses. Here they are opened with the *same call
// tee-node makes* -- teeutils.Decrypt, which is go-ethereum's crypto/ecies. If
// the TypeScript profile ever drifts from ECIES_AES128_SHA256, this fails here,
// at build time, instead of as an opaque "decrypting policy" error from a STORE
// instruction that has already cost gas.
//
// ECIES is randomised, so there is no fixed ciphertext to compare against. The
// assertion is the one that matters operationally: our sealed bytes open, and
// the plaintext is byte-identical.
func TestEciesVectors_DecryptBrowserCiphertext(t *testing.T) {
	type vector struct {
		Name       string `json:"name"`
		PrivateKey string `json:"privateKey"`
		Plaintext  string `json:"plaintext"`
		Ciphertext string `json:"ciphertext"`
	}

	path := filepath.Join("..", "..", "..", "..", "..",
		"packages", "policy", "fixtures", "ecies-vectors.json")

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading ECIES vectors at %s: %v", path, err)
	}

	var vectors []vector
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("parsing ECIES vectors: %v", err)
	}
	if len(vectors) == 0 {
		t.Fatal("no ECIES vectors found; the fixture must not be empty")
	}

	for _, v := range vectors {
		t.Run(v.Name, func(t *testing.T) {
			privateKey, err := crypto.HexToECDSA(strings.TrimPrefix(v.PrivateKey, "0x"))
			if err != nil {
				t.Fatalf("parsing private key: %v", err)
			}

			ciphertext, err := hex.DecodeString(strings.TrimPrefix(v.Ciphertext, "0x"))
			if err != nil {
				t.Fatalf("decoding ciphertext: %v", err)
			}

			plaintext, err := teeutils.Decrypt(ciphertext, privateKey)
			if err != nil {
				t.Fatalf("tee-node could not decrypt browser ciphertext: %v", err)
			}

			if string(plaintext) != v.Plaintext {
				t.Errorf("plaintext mismatch\n  got:      %s\n  expected: %s", plaintext, v.Plaintext)
			}

			// The recovered bytes must also parse as the config the STORE handler
			// expects -- decrypting to garbage that happens to match would still
			// break the handler.
			var cfg types.PrivateConfig
			if err := json.Unmarshal(plaintext, &cfg); err != nil {
				t.Fatalf("decrypted payload is not a PrivateConfig: %v", err)
			}
			if len(cfg.Shares) == 0 {
				t.Error("decrypted config has no shares")
			}
			if err := validateShares(cfg.Shares); err != nil {
				t.Errorf("decrypted config fails share validation: %v", err)
			}
		})
	}
}

// TestEciesVectors_WrongKeyIsRejected confirms the tag is actually checked, so a
// passing decrypt in the test above means something.
func TestEciesVectors_WrongKeyIsRejected(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "..",
		"packages", "policy", "fixtures", "ecies-vectors.json")

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading ECIES vectors: %v", err)
	}

	var vectors []struct {
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("parsing ECIES vectors: %v", err)
	}

	wrongKey, err := crypto.HexToECDSA(strings.Repeat("11", 32))
	if err != nil {
		t.Fatalf("building wrong key: %v", err)
	}

	ciphertext, err := hex.DecodeString(strings.TrimPrefix(vectors[0].Ciphertext, "0x"))
	if err != nil {
		t.Fatalf("decoding ciphertext: %v", err)
	}

	if _, err := teeutils.Decrypt(ciphertext, wrongKey); err == nil {
		t.Fatal("expected decryption under the wrong key to fail")
	}
}
