package extension

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"policy-extension/internal/config"
	"policy-extension/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/go-flare-common/pkg/tee/structs"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/flare-foundation/tee-node/pkg/processorutils"
)

type Extension struct {
	mu     sync.RWMutex
	Server *http.Server

	// policies holds the decrypted private half, keyed by policy clone address.
	// It never leaves the enclave: no handler returns it, and GET /state reports
	// only counts. Memory-only is deliberate -- a restarted machine is re-seeded
	// by replaying STORE, and the user's recovery blob is the backstop.
	policies map[common.Address]types.PrivateConfig

	evaluationCount int
	lastPolicy      string
}

// --- DO NOT MODIFY: New(), actionHandler() are boilerplate.
func New(extensionPort, signPort int) *Extension {
	e := &Extension{
		policies: make(map[common.Address]types.PrivateConfig),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)

	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}

// stateHandler() structure is boilerplate but update the State field mapping to match your Extension fields.
func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
	e.mu.RLock()
	stateResponse := types.StateResponse{
		StateVersion: teeutils.ToHash(config.Version),
		State: types.State{
			PoliciesStored:  len(e.policies),
			EvaluationCount: e.evaluationCount,
			LastPolicy:      e.lastPolicy,
		},
	}
	e.mu.RUnlock()

	err := json.NewEncoder(w).Encode(stateResponse)
	if err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
		return
	}
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	dataFixed, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}

	switch {
	case dataFixed.OPType == teeutils.ToHash(config.OPTypePolicy):
		return e.processPolicy(action, dataFixed)

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op type: received %s, expected %s (%s)",
			dataFixed.OPType.Hex(), teeutils.ToHash(config.OPTypePolicy).Hex(), config.OPTypePolicy,
		))
	}
}

// processPolicy routes POLICY instructions by OPCommand.
func (e *Extension) processPolicy(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	switch {
	case df.OPCommand == teeutils.ToHash(config.OPCommandStore):
		ar := e.processStore(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	case df.OPCommand == teeutils.ToHash(config.OPCommandEvaluate):
		ar := e.processEvaluate(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op command: received %s, expected one of [%s (%s), %s (%s)]",
			df.OPCommand.Hex(),
			teeutils.ToHash(config.OPCommandStore).Hex(), config.OPCommandStore,
			teeutils.ToHash(config.OPCommandEvaluate).Hex(), config.OPCommandEvaluate,
		))
	}
}

// processStore decrypts a policy's private half and holds it in the enclave.
//
// The response reports presence only. Echoing any part of the plaintext would put
// the recipient set into an on-chain ActionResult and defeat the entire design.
func (e *Extension) processStore(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var req types.StorePolicyRequest
	if err := structs.DecodeTo(types.StorePolicyMessageArg, df.OriginalMessage, &req); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding request: %w", err))
	}

	if req.Policy == (common.Address{}) {
		return buildResult(action, df, nil, 0, fmt.Errorf("policy address must not be zero"))
	}
	if len(req.Ciphertext) == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("ciphertext must not be empty"))
	}

	plaintext, err := decryptViaNode(config.SignPort, req.Ciphertext)
	if err != nil {
		// Deliberately vague: a decrypt failure is either a wrong key or a
		// malformed payload, and distinguishing them for the caller would leak
		// more than it helps.
		return buildResult(action, df, nil, 0, fmt.Errorf("decrypting policy: %w", err))
	}

	var cfg types.PrivateConfig
	if err := json.Unmarshal(plaintext, &cfg); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("parsing decrypted policy: %w", err))
	}

	if err := validateShares(cfg.Shares); err != nil {
		return buildResult(action, df, nil, 0, err)
	}

	e.mu.Lock()
	e.policies[req.Policy] = cfg
	e.lastPolicy = req.Policy.Hex()
	shareCount := len(cfg.Shares)
	e.mu.Unlock()

	resp := types.StorePolicyResponse{
		Policy:     req.Policy,
		Stored:     true,
		ShareCount: shareCount,
	}
	data, _ := json.Marshal(resp)

	return buildResult(action, df, data, 1, nil)
}

// processEvaluate signs the committed distribution for an armed policy.
//
// The enclave has no discretion over amounts. It re-derives the commitment from
// what it stored and signs a split that was fixed at deploy time; the contract
// re-checks both the commitment and the signer. A compromised enclave still
// cannot redirect funds or change proportions -- only decline to sign.
func (e *Extension) processEvaluate(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var req types.EvaluatePolicyRequest
	if err := structs.DecodeTo(types.EvaluatePolicyMessageArg, df.OriginalMessage, &req); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding request: %w", err))
	}

	if config.ChainID == 0 {
		// Signing against chain 0 would produce a domain separator no deployed
		// policy can match. Fail loudly here rather than emit a useless signature.
		return buildResult(action, df, nil, 0, fmt.Errorf("CHAIN_ID is unset; refusing to sign"))
	}
	if req.TriggeredAt == nil || req.TriggeredAt.Sign() == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("triggeredAt must be set; the policy is not armed"))
	}

	e.mu.RLock()
	cfg, ok := e.policies[req.Policy]
	e.mu.RUnlock()

	if !ok {
		return buildResult(action, df, nil, 0,
			fmt.Errorf("no stored policy for %s; send STORE first", req.Policy.Hex()))
	}

	commitment := computeCommitment(cfg.Shares, cfg.Salt)
	preimage := eip712Preimage(req.Policy, config.ChainID, commitment, cfg.Shares, req.TriggeredAt)

	signature, err := signViaNode(config.SignPort, preimage)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("signing distribution: %w", err))
	}

	e.mu.Lock()
	e.evaluationCount++
	e.lastPolicy = req.Policy.Hex()
	e.mu.Unlock()

	resp := types.EvaluatePolicyResponse{
		Policy:    req.Policy,
		Shares:    cfg.Shares,
		Salt:      cfg.Salt,
		Signature: signature,
	}
	data, _ := json.Marshal(resp)

	return buildResult(action, df, data, 1, nil)
}

// validateShares enforces what ConfidentialPolicy.execute will enforce anyway.
// Catching it here turns a failed on-chain execution -- at the worst possible
// moment, when the owner is by definition unavailable -- into a STORE that is
// rejected while they are still around to fix it.
func validateShares(shares []types.Share) error {
	if len(shares) == 0 {
		return fmt.Errorf("policy has no shares")
	}

	var total uint32
	for _, s := range shares {
		if s.Recipient == (common.Address{}) {
			return fmt.Errorf("share %d has a zero recipient", total)
		}
		total += uint32(s.ShareBps)
	}

	if total != 10_000 {
		return fmt.Errorf("shares sum to %d bps, expected 10000", total)
	}
	return nil
}
