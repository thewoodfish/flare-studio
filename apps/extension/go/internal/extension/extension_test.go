package extension

import (
	"bytes"
	"encoding/json"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"policy-extension/internal/config"
	"policy-extension/pkg/types"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

// toHash mirrors teeutils.ToHash for clarity: left-pads a string into a 32-byte hash.
func toHash(s string) common.Hash { return teeutils.ToHash(s) }

// buildTestAction constructs a teetypes.Action whose Data.Message is the
// JSON-encoded DataFixed payload. This is what processAction expects to parse.
func buildTestAction(opType, opCommand common.Hash, originalMessage []byte) teetypes.Action {
	// DataFixed is the structure that processorutils.Parse extracts from Data.Message.
	type dataFixed struct {
		InstructionID      common.Hash    `json:"instructionId"`
		TeeID              common.Address `json:"teeId"`
		Timestamp          uint64         `json:"timestamp"`
		RewardEpochID      uint32         `json:"rewardEpochId"`
		OPType             common.Hash    `json:"opType"`
		OPCommand          common.Hash    `json:"opCommand"`
		Cosigners          []string       `json:"cosigners"`
		CosignersThreshold uint64         `json:"cosignersThreshold"`
		OriginalMessage    hexutil.Bytes  `json:"originalMessage"`
	}

	df := dataFixed{
		OPType:          opType,
		OPCommand:       opCommand,
		OriginalMessage: originalMessage,
	}
	msg, _ := json.Marshal(df)

	return teetypes.Action{
		Data: teetypes.ActionData{
			ID:            common.HexToHash("0x1234"),
			SubmissionTag: "submit",
			Message:       msg,
		},
	}
}

func abiEncodeStore(policy common.Address, ciphertext []byte) []byte {
	args := abi.Arguments{types.StorePolicyMessageArg}
	type store struct {
		Policy     common.Address
		Ciphertext []byte
	}
	encoded, _ := args.Pack(store{Policy: policy, Ciphertext: ciphertext})
	return encoded
}

func abiEncodeEvaluate(policy common.Address, triggeredAt *big.Int) []byte {
	args := abi.Arguments{types.EvaluatePolicyMessageArg}
	type evaluate struct {
		Policy      common.Address
		TriggeredAt *big.Int
	}
	encoded, _ := args.Pack(evaluate{Policy: policy, TriggeredAt: triggeredAt})
	return encoded
}

func newTestExtension() *Extension {
	return &Extension{policies: make(map[common.Address]types.PrivateConfig)}
}

// --- The cross-language commitment check ---

// TestComputeCommitment_MatchesSharedVectors is the reason this package can be
// trusted. The same vectors are asserted by packages/policy (TypeScript) and
// packages/contracts (Solidity); if this Go encoding ever drifts from either, the
// failure shows up here instead of as an unexplainable revert inside execute()
// at the one moment the policy is supposed to fire.
func TestComputeCommitment_MatchesSharedVectors(t *testing.T) {
	type vector struct {
		Name          string `json:"name"`
		Distributions []struct {
			Recipient string `json:"recipient"`
			Amount    string `json:"amount"`
		} `json:"distributions"`
		Salt     string `json:"salt"`
		Expected string `json:"expected"`
	}

	path := filepath.Join("..", "..", "..", "..", "..",
		"packages", "policy", "fixtures", "commitment-vectors.json")

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading shared vectors at %s: %v", path, err)
	}

	var vectors []vector
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("parsing shared vectors: %v", err)
	}
	if len(vectors) == 0 {
		t.Fatal("no vectors found; the shared fixture must not be empty")
	}

	for _, v := range vectors {
		t.Run(v.Name, func(t *testing.T) {
			shares := make([]types.Share, 0, len(v.Distributions))
			for _, d := range v.Distributions {
				amount, ok := new(big.Int).SetString(d.Amount, 10)
				if !ok {
					t.Fatalf("bad amount %q", d.Amount)
				}
				if !amount.IsUint64() || amount.Uint64() > 65535 {
					t.Fatalf("amount %s exceeds uint16; Share.shareBps cannot express it", d.Amount)
				}
				shares = append(shares, types.Share{
					Recipient: common.HexToAddress(d.Recipient),
					ShareBps:  uint16(amount.Uint64()),
				})
			}

			got := computeCommitment(shares, common.HexToHash(v.Salt))
			if got.Hex() != strings.ToLower(v.Expected) {
				t.Errorf("commitment mismatch\n  got:      %s\n  expected: %s", got.Hex(), v.Expected)
			}
		})
	}
}

// --- EIP-712 domain binding ---

// TestEip712Preimage_IsDomainBound covers the property the whole design leans on:
// a signature authorising one policy must be useless against another, and against
// the same policy on another chain or at another arming.
func TestEip712Preimage_IsDomainBound(t *testing.T) {
	shares := []types.Share{{Recipient: common.HexToAddress("0x1111111111111111111111111111111111111111"), ShareBps: 10000}}
	salt := common.HexToHash("0x22")
	commitment := computeCommitment(shares, salt)

	policyA := common.HexToAddress("0xAAAA000000000000000000000000000000000001")
	policyB := common.HexToAddress("0xBBBB000000000000000000000000000000000002")

	base := eip712Preimage(policyA, 114, commitment, shares, big.NewInt(1000))

	if len(base) != 66 {
		t.Fatalf("expected a 66-byte preimage (0x1901 + 32 + 32), got %d", len(base))
	}
	if base[0] != 0x19 || base[1] != 0x01 {
		t.Errorf("expected the EIP-712 0x1901 prefix, got %#x%#x", base[0], base[1])
	}

	cases := map[string][]byte{
		"different policy":      eip712Preimage(policyB, 114, commitment, shares, big.NewInt(1000)),
		"different chain":       eip712Preimage(policyA, 16, commitment, shares, big.NewInt(1000)),
		"different triggeredAt": eip712Preimage(policyA, 114, commitment, shares, big.NewInt(1001)),
	}

	for name, other := range cases {
		if string(other) == string(base) {
			t.Errorf("%s produced an identical preimage; the signature would be replayable", name)
		}
	}

	// Same inputs must be deterministic, or nothing verifies twice.
	if string(eip712Preimage(policyA, 114, commitment, shares, big.NewInt(1000))) != string(base) {
		t.Error("preimage is not deterministic for identical inputs")
	}
}

// --- Routing ---

func TestProcessAction_UnknownOPType(t *testing.T) {
	e := newTestExtension()
	action := buildTestAction(toHash("UNKNOWN_TYPE"), toHash(config.OPCommandStore), nil)

	status, body := e.processAction(action)

	if status != http.StatusNotImplemented {
		t.Fatalf("expected status %d, got %d", http.StatusNotImplemented, status)
	}

	bodyStr := string(body)
	if !strings.Contains(bodyStr, "unsupported op type") {
		t.Error("expected body to contain 'unsupported op type'")
	}
	if !strings.Contains(bodyStr, toHash("UNKNOWN_TYPE").Hex()) {
		t.Error("expected body to name the received hash")
	}
	if !strings.Contains(bodyStr, config.OPTypePolicy) {
		t.Errorf("expected body to contain %q", config.OPTypePolicy)
	}
}

func TestProcessAction_UnknownOPCommand(t *testing.T) {
	e := newTestExtension()
	action := buildTestAction(toHash(config.OPTypePolicy), toHash("UNKNOWN_COMMAND"), nil)

	status, body := e.processAction(action)

	if status != http.StatusNotImplemented {
		t.Fatalf("expected status %d, got %d", http.StatusNotImplemented, status)
	}

	bodyStr := string(body)
	if !strings.Contains(bodyStr, "unsupported op command") {
		t.Error("expected body to contain 'unsupported op command'")
	}
	for _, cmd := range []string{config.OPCommandStore, config.OPCommandEvaluate} {
		if !strings.Contains(bodyStr, toHash(cmd).Hex()) {
			t.Errorf("expected body to contain hash for %s", cmd)
		}
		if !strings.Contains(bodyStr, cmd) {
			t.Errorf("expected body to contain command name %q", cmd)
		}
	}
}

// TestOPTypePolicy_IsNotReserved guards the trap that costs a day to diagnose:
// an "F_"-prefixed op type is reserved for Flare system operations, and
// op.IsValid() rejects it for a user extension. Instructions would then be
// dropped upstream and this extension would simply never be called.
func TestOPTypePolicy_IsNotReserved(t *testing.T) {
	if strings.HasPrefix(config.OPTypePolicy, "F_") {
		t.Fatalf("op type %q uses the reserved F_ prefix; instructions will never arrive",
			config.OPTypePolicy)
	}
	if len(config.OPTypePolicy) > 32 {
		t.Fatalf("op type %q exceeds 32 bytes", config.OPTypePolicy)
	}
	for _, cmd := range []string{config.OPCommandStore, config.OPCommandEvaluate} {
		if len(cmd) > 32 {
			t.Fatalf("op command %q exceeds 32 bytes", cmd)
		}
	}
}

func TestProcessAction_InvalidDataMessage(t *testing.T) {
	e := newTestExtension()

	action := teetypes.Action{
		Data: teetypes.ActionData{
			ID:      common.HexToHash("0xabcd"),
			Message: []byte(`not json at all`),
		},
	}

	status, body := e.processAction(action)

	if status != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d: %s", http.StatusBadRequest, status, body)
	}
	if !strings.Contains(string(body), "decoding fixed data") {
		t.Errorf("expected body to mention 'decoding fixed data', got %q", body)
	}
}

// --- STORE validation (everything reachable without a live tee-node) ---

func resultOf(t *testing.T, body []byte) teetypes.ActionResult {
	t.Helper()
	var result teetypes.ActionResult
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("unmarshalling ActionResult: %v", err)
	}
	return result
}

func TestProcessStore_ZeroPolicyAddress(t *testing.T) {
	e := newTestExtension()
	action := buildTestAction(
		toHash(config.OPTypePolicy),
		toHash(config.OPCommandStore),
		abiEncodeStore(common.Address{}, []byte{0x01}),
	)

	_, body := e.processAction(action)
	result := resultOf(t, body)

	if result.Status != 0 {
		t.Fatalf("expected error status, got %d", result.Status)
	}
	if !strings.Contains(result.Log, "must not be zero") {
		t.Errorf("expected a zero-address complaint, got %q", result.Log)
	}
}

func TestProcessStore_EmptyCiphertext(t *testing.T) {
	e := newTestExtension()
	action := buildTestAction(
		toHash(config.OPTypePolicy),
		toHash(config.OPCommandStore),
		abiEncodeStore(common.HexToAddress("0xAAAA000000000000000000000000000000000001"), nil),
	)

	_, body := e.processAction(action)
	result := resultOf(t, body)

	if result.Status != 0 {
		t.Fatalf("expected error status, got %d", result.Status)
	}
	if !strings.Contains(result.Log, "ciphertext must not be empty") {
		t.Errorf("expected an empty-ciphertext complaint, got %q", result.Log)
	}
}

// --- EVALUATE validation ---

func TestProcessEvaluate_UnknownPolicy(t *testing.T) {
	config.ChainID = 114
	t.Cleanup(func() { config.ChainID = 0 })

	e := newTestExtension()
	action := buildTestAction(
		toHash(config.OPTypePolicy),
		toHash(config.OPCommandEvaluate),
		abiEncodeEvaluate(common.HexToAddress("0xDEAD000000000000000000000000000000000001"), big.NewInt(1000)),
	)

	_, body := e.processAction(action)
	result := resultOf(t, body)

	if result.Status != 0 {
		t.Fatalf("expected error status, got %d", result.Status)
	}
	if !strings.Contains(result.Log, "no stored policy") {
		t.Errorf("expected an unknown-policy complaint, got %q", result.Log)
	}
}

// TestProcessEvaluate_RefusesUnsetChainID covers the documented failure where an
// unset CHAIN_ID yields chainID=0 and signatures that can never verify. Better to
// refuse than to emit one.
func TestProcessEvaluate_RefusesUnsetChainID(t *testing.T) {
	config.ChainID = 0

	e := newTestExtension()
	policy := common.HexToAddress("0xAAAA000000000000000000000000000000000001")
	e.policies[policy] = types.PrivateConfig{
		Shares: []types.Share{{Recipient: common.HexToAddress("0x11"), ShareBps: 10000}},
		Salt:   common.HexToHash("0x22"),
	}

	action := buildTestAction(
		toHash(config.OPTypePolicy),
		toHash(config.OPCommandEvaluate),
		abiEncodeEvaluate(policy, big.NewInt(1000)),
	)

	_, body := e.processAction(action)
	result := resultOf(t, body)

	if result.Status != 0 {
		t.Fatalf("expected error status, got %d", result.Status)
	}
	if !strings.Contains(result.Log, "CHAIN_ID") {
		t.Errorf("expected a CHAIN_ID complaint, got %q", result.Log)
	}
}

func TestProcessEvaluate_RefusesUnarmedPolicy(t *testing.T) {
	config.ChainID = 114
	t.Cleanup(func() { config.ChainID = 0 })

	e := newTestExtension()
	policy := common.HexToAddress("0xAAAA000000000000000000000000000000000001")

	action := buildTestAction(
		toHash(config.OPTypePolicy),
		toHash(config.OPCommandEvaluate),
		abiEncodeEvaluate(policy, big.NewInt(0)),
	)

	_, body := e.processAction(action)
	result := resultOf(t, body)

	if result.Status != 0 {
		t.Fatalf("expected error status, got %d", result.Status)
	}
	if !strings.Contains(result.Log, "not armed") {
		t.Errorf("expected an unarmed-policy complaint, got %q", result.Log)
	}
}

// --- Share validation ---

func TestValidateShares(t *testing.T) {
	addr := common.HexToAddress("0x1111111111111111111111111111111111111111")

	cases := []struct {
		name    string
		shares  []types.Share
		wantErr string
	}{
		{"empty", nil, "no shares"},
		{"sums low", []types.Share{{Recipient: addr, ShareBps: 9999}}, "9999 bps"},
		{"sums high", []types.Share{{Recipient: addr, ShareBps: 10000}, {Recipient: addr, ShareBps: 1}}, "10001 bps"},
		{"zero recipient", []types.Share{{Recipient: common.Address{}, ShareBps: 10000}}, "zero recipient"},
		{"valid", []types.Share{{Recipient: addr, ShareBps: 6000}, {Recipient: addr, ShareBps: 4000}}, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateShares(tc.shares)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected an error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("expected error containing %q, got %q", tc.wantErr, err)
			}
		})
	}
}

// --- State never leaks policy contents ---

// TestStateHandler_LeaksNothing is a standing guard on the confidentiality claim:
// GET /state is rendered by the monitor UI, so anything that appears here is
// effectively public. Recipients and salts must never be among it.
func TestStateHandler_LeaksNothing(t *testing.T) {
	e := newTestExtension()
	secret := common.HexToAddress("0xC0FFEE0000000000000000000000000000BEEF01")
	salt := common.HexToHash("0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface")

	policy := common.HexToAddress("0xAAAA000000000000000000000000000000000001")
	e.policies[policy] = types.PrivateConfig{
		Shares: []types.Share{{Recipient: secret, ShareBps: 10000}},
		Salt:   salt,
	}

	rec := &captureWriter{}
	e.stateHandler(rec, nil)

	body := strings.ToLower(rec.body.String())
	for _, forbidden := range []string{
		strings.ToLower(secret.Hex()[2:]),
		strings.ToLower(salt.Hex()[2:]),
	} {
		if strings.Contains(body, forbidden) {
			t.Errorf("GET /state leaked confidential material: %s", rec.body.String())
		}
	}

	var resp types.StateResponse
	if err := json.Unmarshal(rec.body.Bytes(), &resp); err != nil {
		t.Fatalf("state response is not valid JSON: %v", err)
	}
	if resp.State.PoliciesStored != 1 {
		t.Errorf("expected PoliciesStored=1, got %d", resp.State.PoliciesStored)
	}
}

// captureWriter is a minimal http.ResponseWriter that records the body, so the
// state handler can be exercised without standing up a server.
type captureWriter struct {
	body   bytes.Buffer
	status int
	header http.Header
}

func (w *captureWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *captureWriter) Write(b []byte) (int, error) { return w.body.Write(b) }
func (w *captureWriter) WriteHeader(status int)      { w.status = status }
